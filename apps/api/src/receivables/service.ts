import {z} from 'zod';
import type {Actor} from '../auth/auth';
import {CoreStore,type Client} from '../core/store';
import {date,uuid,today,positive,reason} from '../core/validation';
import {decimal,bounded} from '../core/money';
import {ensure,missing} from '../core/errors';
import type {Receivable,ReceivablePage,ReceivableDetail,PaymentRecord,PaymentMutationResult} from '../../../../packages/contracts/src';
import {effectivePaidSql,receivableRows,receivablePageSql} from './queries';
const integer=(fallback:number,max:number)=>z.coerce.number().int().min(1).max(max).default(fallback);
const filters=z.object({hospitalId:uuid.optional(),receivedFrom:date.optional(),receivedTo:date.optional(),keyword:z.string().trim().max(100).optional(),ownership:z.enum(['mine','readonly']).optional(),paymentState:z.enum(['unpaid','partial','settled','outstanding']).optional(),dueState:z.enum(['upcoming','due','overdue']).optional(),page:integer(1,100000000),pageSize:integer(20,50)}).strict().refine(v=>!v.receivedFrom||!v.receivedTo||v.receivedFrom<=v.receivedTo,{message:'结束日期不能早于开始日期',path:['receivedTo']});
const addInput=z.object({amount:positive,paidDate:date.nullable(),remark:z.string().trim().max(500).optional(),correctsPaymentRecordId:uuid.optional()}).strict();
const voidInput=z.object({reason}).strict();
const iso=(v:Date|string|null)=>v?new Date(v).toISOString():null;
export function paymentDto(row:any):PaymentRecord{return {id:row.id,receivableId:row.receivable_id,recordType:row.record_type,amount:row.amount,paidDate:row.paid_date,remark:row.remark,recordedBy:row.recorded_by,recordedByName:row.recorded_by_name_snapshot,recordedAt:iso(row.recorded_at)!,status:row.status,voidReason:row.void_reason,voidedBy:row.voided_by,voidedByName:row.voided_by_name_snapshot,voidedAt:iso(row.voided_at),correctsPaymentRecordId:row.corrects_payment_record_id};}
export async function paymentRecords(c:Client,id:string):Promise<PaymentRecord[]>{return (await c.query('SELECT * FROM payment_records WHERE receivable_id=$1 ORDER BY recorded_at,id',[id])).rows.map(paymentDto);}
function receivableDto(row:any,actor:Actor,now:Date):Receivable{const amount=bounded(decimal(row.amount)),paid=bounded(decimal(row.paid)),balance=bounded(decimal(amount).minus(decimal(paid)));return {id:row.id,orderId:row.purchase_order_id,orderNo:row.order_no,hospitalId:row.hospital_id,hospitalName:row.hospital_name,owner:{id:row.sales_user_id,name:row.owner_name},receivedDate:row.received_date,paymentTermDays:row.payment_term_days,dueDate:row.due_date,amount,paid,balance,paymentState:decimal(balance).isZero()?'settled':decimal(paid).isZero()?'unpaid':'partial',dueState:row.due_date<today(now)?'overdue':row.due_date===today(now)?'due':'upcoming',writable:actor.role==='salesperson'&&row.sales_user_id===actor.id&&row.order_status!=='voided',orderVersion:row.row_version};}
export class ReceivableService{
 constructor(readonly store:CoreStore){}
 async list(actor:Actor,input:unknown):Promise<ReceivablePage>{const v=filters.parse(input);return this.store.db.transaction(async c=>{await this.store.active(c,actor);const now=this.store.clock(),p=(await c.query(receivablePageSql,[actor.id,actor.role==='admin'&&actor.channel==='pc',today(now),v.hospitalId||null,v.receivedFrom||null,v.receivedTo||null,v.keyword||'',v.ownership||null,v.paymentState||null,v.dueState||null,v.pageSize,(v.page-1)*v.pageSize])).rows[0];return {items:p.items.map((r:any)=>receivableDto(r,actor,now)),total:p.total,page:v.page,pageSize:v.pageSize,asOf:now.toISOString()};});}
 private async reference(id:string){uuid.parse(id);const row=(await this.store.db.query('SELECT purchase_order_id FROM receivables WHERE id=$1',[id])).rows[0];if(!row)throw missing();return row.purchase_order_id as string;}
 private async view(c:Client,actor:Actor,id:string,now:Date){const row=(await c.query(receivableRows+' WHERE ar.id=$1',[id])).rows[0];if(!row)throw missing();return receivableDto(row,actor,now);}
 async detail(actor:Actor,id:string):Promise<ReceivableDetail>{const orderId=await this.reference(id);return this.store.db.transaction(async c=>{await this.store.root(c,actor,orderId);const now=this.store.clock(),receivable=await this.view(c,actor,id,now);return {receivable,payments:await paymentRecords(c,id),asOf:now.toISOString(),originalOrder:{id:orderId,orderNo:receivable.orderNo}};});}
 private async locked(c:Client,id:string,orderId:string){const row=(await c.query('SELECT * FROM receivables WHERE id=$1 AND purchase_order_id=$2 FOR UPDATE',[id,orderId])).rows[0];if(!row)throw missing();const paid=(await c.query(effectivePaidSql,[id])).rows[0].paid;return {...row,paid,balance:bounded(decimal(row.amount).minus(decimal(paid)))};}
 async add(actor:Actor,key:string,id:string,input:unknown):Promise<PaymentMutationResult>{const v=addInput.parse(input),orderId=await this.reference(id);return this.store.mutate(actor,key,'receivables.payment-add',v,orderId,async(c,root)=>{
  const ar=await this.locked(c,id,orderId),now=this.store.clock();
  ensure(decimal(ar.balance).gt(0),409,'RECEIVABLE_SETTLED','应收已结清，不能追加回款');ensure(decimal(v.amount).lte(decimal(ar.balance)),400,'PAYMENT_EXCEEDS_BALANCE','本次回款不能超过未收余额');
  let recordType='regular',unknownHistoricalDate=false;if(v.correctsPaymentRecordId){const prior=(await c.query('SELECT * FROM payment_records WHERE id=$1 AND receivable_id=$2',[v.correctsPaymentRecordId,id])).rows[0];if(!prior)throw missing();ensure(prior.status==='void',409,'CORRECTION_REQUIRES_VOID','请先作废原错误回款记录');recordType=prior.record_type;unknownHistoricalDate=recordType==='historical_opening'&&prior.paid_date===null;}
  if(unknownHistoricalDate)ensure(v.paidDate===null,400,'HISTORICAL_PAYMENT_DATE_UNKNOWN','原历史累计的实际回款日期未知，更正须保留未知日期');
  else{ensure(v.paidDate!==null,400,'PAYMENT_DATE_REQUIRED','本次回款必须填写实际回款日期');ensure(v.paidDate<=today(now),400,'PAYMENT_DATE_IN_FUTURE','实际回款日期不能晚于北京时间今天');}
  const p=(await c.query(`INSERT INTO payment_records(receivable_id,record_type,amount,paid_date,remark,recorded_by,recorded_by_name_snapshot,recorded_at,corrects_payment_record_id) VALUES($1,$2,$3,$4,$5,$6,(SELECT name FROM users WHERE id=$6),$7,$8) RETURNING *`,[id,recordType,bounded(decimal(v.amount)),v.paidDate,v.remark||'',actor.id,now,v.correctsPaymentRecordId||null])).rows[0];
  await this.store.audit(c,orderId,actor.id,'receivables.payment-add',{paymentId:p.id,amount:p.amount,paidDate:p.paid_date,remark:p.remark,correctsPaymentRecordId:p.corrects_payment_record_id});await this.store.bump(c,root.id);
  return {orderId,receivable:await this.view(c,actor,id,now),payment:paymentDto(p)};
 });}
 async void(actor:Actor,key:string,id:string,paymentId:string,input:unknown):Promise<PaymentMutationResult>{uuid.parse(paymentId);const v=voidInput.parse(input),orderId=await this.reference(id);return this.store.mutate(actor,key,'receivables.payment-void',{...v,paymentId},orderId,async(c,root)=>{
  await this.locked(c,id,orderId);const now=this.store.clock(),p=(await c.query('SELECT * FROM payment_records WHERE id=$1 AND receivable_id=$2',[paymentId,id])).rows[0];if(!p)throw missing();ensure(p.status==='active',409,'PAYMENT_ALREADY_VOID','该回款已作废');
  const changed=(await c.query("UPDATE payment_records SET status='void',void_reason=$3,voided_by=$4,voided_by_name_snapshot=(SELECT name FROM users WHERE id=$4),voided_at=$5 WHERE id=$1 AND receivable_id=$2 RETURNING *",[paymentId,id,v.reason,actor.id,now])).rows[0];
  await this.store.audit(c,orderId,actor.id,'receivables.payment-void',{paymentId,amount:p.amount,paidDate:p.paid_date,reason:v.reason});await this.store.bump(c,root.id);return {orderId,receivable:await this.view(c,actor,id,now),payment:paymentDto(changed)};
 });}
}
