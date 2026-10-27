import { z } from 'zod';
import type { Actor } from '../auth/auth';
import { CoreStore } from './store';
import { ensure,missing } from './errors';
import { uuid,version,date,draftLine,today } from './validation';
import { comparison,draftView } from './read-model';
import { decimal,recommend,lineAmount } from './money';
export class PricingService {
 constructor(readonly store:CoreStore){}
 async enter(actor:Actor,key:string,orderId:string,input:unknown){
  uuid.parse(orderId);const value=z.object({expectedVersion:version,allowEarly:z.boolean()}).strict().parse(input);
  return this.store.mutate(actor,key,'pricing.enter',value,orderId,async(c,r)=>{
   this.store.checkVersion(r.row_version,value.expectedVersion);ensure(r.revision_status==='frozen'&&r.status!=='draft',409,'NOT_FROZEN','请先冻结采购修订');
   if((await c.query('SELECT id FROM quotes WHERE revision_id=$1',[r.revision_id])).rowCount)return draftView(c,r,this.store.clock());
   const live=await comparison(c,r,this.store.clock());ensure(live.submittedCount>0,409,'SUPPLIER_REQUIRED','至少一家有效完整提交后才能进入计价');ensure(live.submittedCount===2||value.allowEarly,409,'EARLY_CONFIRMATION_REQUIRED','另一家未完整报价，请明确确认提前计价');
   const quote=(await c.query('INSERT INTO quotes(purchase_order_id,revision_id,created_by) VALUES($1,$2,$3) RETURNING id',[orderId,r.revision_id,actor.id])).rows[0];
   const day=today(this.store.clock()),number=(await c.query('INSERT INTO quote_number_counters(business_date,hospital_id,value) VALUES($1,$2,1) ON CONFLICT(business_date,hospital_id) DO UPDATE SET value=quote_number_counters.value+1 RETURNING value',[day,r.hospital_id])).rows[0].value;
   await c.query('UPDATE quotes SET quote_no=$2 WHERE id=$1',[quote.id,'BJ-'+day.replaceAll('-','')+'-'+r.hospital_id.slice(-6)+'-'+String(number).padStart(3,'0')]);
   const v=(await c.query('INSERT INTO quote_versions(quote_id,revision_id) VALUES($1,$2) RETURNING id',[quote.id,r.revision_id])).rows[0];
   const dates:string[]=[];
   for(const line of live.lines){const base=line.cells.filter(x=>x.state==='quoted').sort((a,b)=>decimal(a.price!).comparedTo(decimal(b.price!)))[0];if(base?.validUntil)dates.push(base.validUntil);await c.query('INSERT INTO quote_lines(version_id,revision_id,purchase_line_id,base_supplier_quote_line_id,base_price,adopted_kind,adopted_supplier_snapshot,adopted_lowest_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[v.id,r.revision_id,line.purchaseLineId,base?.supplierQuoteLineId||null,base?.price||null,line.kind,JSON.stringify(line.cells),line.lowestPrice]);}
   await c.query('UPDATE quote_versions SET hospital_valid_until=$2 WHERE id=$1',[v.id,dates.sort()[0]||null]);await c.query("UPDATE purchase_orders SET status='quote_draft',row_version=row_version+1 WHERE id=$1",[orderId]);await this.store.audit(c,orderId,actor.id,'pricing.enter',{draftId:v.id,early:live.submittedCount===1});return draftView(c,r,this.store.clock());
  });
 }
 private async reference(quoteId:string,draftId:string){uuid.parse(quoteId);uuid.parse(draftId);const r=(await this.store.db.query('SELECT q.purchase_order_id FROM quote_versions v JOIN quotes q ON q.id=v.quote_id WHERE q.id=$1 AND v.id=$2',[quoteId,draftId])).rows[0];if(!r)throw missing();return r.purchase_order_id as string;}
 async save(actor:Actor,key:string,quoteId:string,draftId:string,input:unknown){
  const value=z.object({expectedVersion:version,hospitalValidUntil:date.nullable(),lines:z.array(draftLine).min(1).max(100)}).strict().parse(input),orderId=await this.reference(quoteId,draftId);
  return this.store.mutate(actor,key,'pricing.save',{...value,quoteId,draftId},orderId,async(c,r)=>{
   const current=await draftView(c,r,this.store.clock());ensure(!(await c.query('SELECT active_export_id FROM quote_versions WHERE id=$1',[current.id])).rows[0].active_export_id,409,'EXPORT_OCCUPIED','报价正在导出，请等待完成或失败回收');ensure(current.id===draftId,409,'DRAFT_READ_ONLY','该报价不是当前可编辑草稿');this.store.checkVersion(current.version,value.expectedVersion);
   const ids=value.lines.map(l=>l.purchaseLineId);ensure(new Set(ids).size===ids.length&&ids.length===current.lines.length&&current.lines.every(l=>ids.includes(l.purchaseLineId)),400,'LINES_INCOMPLETE','计价须保留当前全部采购行');
   const live=await comparison(c,r,this.store.clock());
   for(const item of value.lines){
    const old=current.lines.find(l=>l.purchaseLineId===item.purchaseLineId)!,row=live.lines.find(l=>l.purchaseLineId===item.purchaseLineId)!;
    const base=row.cells.find(c=>c.supplierQuoteLineId===item.baseSupplierQuoteLineId&&c.state==='quoted');
    const retained=!!item.baseSupplierQuoteLineId&&old.baseSupplierQuoteLineId===item.baseSupplierQuoteLineId;
    ensure(!item.baseSupplierQuoteLineId||base||retained,400,'BASE_PRICE_INVALID','基准必须是本采购行当前有效厂家报价');
    const price=base?.price||(retained?old.basePrice:null),baseValid=!!base;
    ensure((item.markupMethod===null)===(item.parameterValue===null),400,'MARKUP_INCOMPLETE','加价方式和参数须同时填写或留空');
    ensure(price||(!item.finalPrice&&!item.finalConfirmed&&!item.markupMethod),400,'BASE_REQUIRED','缺少有效基准时不可填最终价或加价');
    ensure(!item.finalConfirmed||baseValid&&!!item.finalPrice,400,'FINAL_CONFIRMATION_INVALID','确认前须选择有效基准并填写最终价');
    if(item.finalPrice&&price){lineAmount(row.quantity,item.finalPrice);ensure(decimal(item.finalPrice).gte(decimal(price))||item.lossReason.trim(),400,'LOSS_REASON_REQUIRED','最终价低于基准，必须填写原因');}
    const recommended=baseValid&&price&&item.markupMethod&&item.parameterValue!==null?recommend(price,item.markupMethod,item.parameterValue):null;
    await c.query('UPDATE quote_lines SET base_supplier_quote_line_id=$3,base_price=$4,selection_mode=$5,markup_method=$6,parameter_value=$7,recommended_price=$8,final_price=$9,final_confirmed=$10,loss_reason=$11 WHERE version_id=$1 AND purchase_line_id=$2',[draftId,item.purchaseLineId,item.baseSupplierQuoteLineId,price,item.selectionMode,item.markupMethod,item.parameterValue,recommended,item.finalPrice,item.finalConfirmed,item.lossReason]);
    if(item.publicRemark!==undefined)await c.query('UPDATE quote_lines SET public_remark=$3 WHERE version_id=$1 AND purchase_line_id=$2',[draftId,item.purchaseLineId,item.publicRemark]);
    if(item.baseSupplierQuoteLineId!==old.baseSupplierQuoteLineId)await c.query('UPDATE quote_lines SET adopted_kind=$3,adopted_supplier_snapshot=$4,adopted_lowest_price=$5 WHERE version_id=$1 AND purchase_line_id=$2',[draftId,item.purchaseLineId,base?'priced':row.kind,JSON.stringify(row.cells),row.lowestPrice]);
   }
   const changed=await draftView(c,r,this.store.clock()),anyPrice=changed.lines.some(l=>l.baseSupplierQuoteLineId);
   if(!anyPrice)ensure(value.hospitalValidUntil===null,400,'VALID_UNTIL_NOT_APPLICABLE','全缺货单不设价格有效期');
   if(value.hospitalValidUntil!==null){ensure(value.hospitalValidUntil>=today(this.store.clock()),400,'VALID_UNTIL_EXPIRED','医院报价有效期不可早于今天');ensure(changed.maxValidUntil?value.hospitalValidUntil<=changed.maxValidUntil:value.hospitalValidUntil===current.hospitalValidUntil,400,'VALID_UNTIL_EXCEEDED','医院有效期不得晚于所选基准最早到期日');}
   await c.query('UPDATE quote_versions SET hospital_valid_until=$2,row_version=row_version+1 WHERE id=$1',[draftId,value.hospitalValidUntil]);await this.store.bump(c,orderId);await this.store.audit(c,orderId,actor.id,'pricing.save',{draftId,lines:value.lines});return draftView(c,r,this.store.clock());
  });
 }
 async adopt(actor:Actor,key:string,quoteId:string,draftId:string,input:unknown){
  const value=z.object({expectedVersion:version,lineIds:z.array(uuid).min(1).max(100).optional()}).strict().parse(input),orderId=await this.reference(quoteId,draftId);
  return this.store.mutate(actor,key,'pricing.adopt',{...value,quoteId,draftId},orderId,async(c,r)=>{
   const current=await draftView(c,r,this.store.clock());ensure(!(await c.query('SELECT active_export_id FROM quote_versions WHERE id=$1',[current.id])).rows[0].active_export_id,409,'EXPORT_OCCUPIED','报价正在导出，请等待完成或失败回收');ensure(current.id===draftId,409,'DRAFT_READ_ONLY','仅当前草稿可主动采用报价');this.store.checkVersion(current.version,value.expectedVersion);
   ensure(!value.lineIds||new Set(value.lineIds).size===value.lineIds.length&&value.lineIds.every(id=>current.lines.some(l=>l.purchaseLineId===id)),400,'LINE_MISMATCH','采用范围不属于当前采购行');
   const live=await comparison(c,r,this.store.clock());
   for(const line of current.lines){
    if(value.lineIds&&!value.lineIds.includes(line.purchaseLineId))continue;
    const row=live.lines.find(r=>r.purchaseLineId===line.purchaseLineId)!,base=row.cells.filter(x=>x.state==='quoted').sort((a,b)=>decimal(a.price!).comparedTo(decimal(b.price!)))[0];
    await c.query('UPDATE quote_lines SET adopted_supplier_snapshot=$3,adopted_lowest_price=$4,adopted_kind=$5 WHERE version_id=$1 AND purchase_line_id=$2',[draftId,line.purchaseLineId,JSON.stringify(row.cells),row.lowestPrice,line.baseSupplierQuoteLineId?line.kind:row.kind]);
    if(line.selectionMode==='manual'||!base||base.supplierQuoteLineId===line.baseSupplierQuoteLineId)continue;
    const recommended=line.markupMethod&&line.parameterValue!==null?recommend(base.price!,line.markupMethod,line.parameterValue):null;
    await c.query("UPDATE quote_lines SET base_supplier_quote_line_id=$3,base_price=$4,recommended_price=$5,final_confirmed=false,adopted_kind='priced' WHERE version_id=$1 AND purchase_line_id=$2",[draftId,line.purchaseLineId,base.supplierQuoteLineId,base.price,recommended]);
   }
   const changed=await draftView(c,r,this.store.clock()),until=changed.maxValidUntil?current.hospitalValidUntil&&current.hospitalValidUntil<changed.maxValidUntil?current.hospitalValidUntil:changed.maxValidUntil:current.hospitalValidUntil;
   await c.query('UPDATE quote_versions SET hospital_valid_until=$2,row_version=row_version+1 WHERE id=$1',[draftId,until]);await this.store.bump(c,orderId);await this.store.audit(c,orderId,actor.id,'pricing.adopt',{draftId,lineIds:value.lineIds||null});return draftView(c,r,this.store.clock());
  });
 }
}
