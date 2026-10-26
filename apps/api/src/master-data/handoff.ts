import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {CoreStore,stable,type Client} from '../core/store';
import type {Actor} from '../auth/auth';
import {ensure} from '../core/errors';
import {reason,uuid} from '../core/validation';
import {admin,adminMutation,audited,camel,pendingWork,PreviewTokens,revoke} from './common';
const scope=z.object({fromSalesUserId:uuid,toSalesUserId:uuid,orderIds:z.array(uuid).max(10000),hospitalIds:z.array(uuid).max(10000),reason}).strict().refine(v=>v.fromSalesUserId!==v.toSalesUserId,'交出人与接手人不能相同').refine(v=>new Set(v.orderIds).size===v.orderIds.length&&new Set(v.hospitalIds).size===v.hospitalIds.length,'交接范围不能重复');
export class HandoffService {
 private readonly previews:PreviewTokens;
 constructor(readonly store:CoreStore){this.previews=new PreviewTokens(store,'sales-handoff');}
 private async snapshot(c:Client,v:z.infer<typeof scope>,lock=false){
  const users=(await c.query(`SELECT id,name,role,active,row_version,auth_version FROM users WHERE id=ANY($1::uuid[]) ORDER BY id ${lock?'FOR UPDATE':'FOR SHARE'}`,[[v.fromSalesUserId,v.toSalesUserId]])).rows,from=users.find(u=>u.id===v.fromSalesUserId),to=users.find(u=>u.id===v.toSalesUserId);ensure(from?.active&&from.role==='salesperson'&&to?.active&&to.role==='salesperson',400,'INVALID_ASSIGNEE','交接双方必须是启用销售账号');
  // Blocking the outgoing owner prevents new creates; hospitals then roots follow CoreStore's lock order.
  const hospitals=(await c.query(`SELECT id,name,sales_user_id,row_version,active FROM hospitals WHERE sales_user_id=$1 OR id=ANY($2::uuid[]) ORDER BY id ${lock?'FOR UPDATE':'FOR SHARE'}`,[from.id,v.hospitalIds])).rows;
  for(const id of v.hospitalIds)ensure(hospitals.some(h=>h.id===id&&h.sales_user_id===from.id),409,'HANDOFF_SCOPE_CHANGED','所选医院已不属于原销售');
  // Lock every outgoing order hospital, including hospitals already assigned to someone else.
  if(lock)await c.query('SELECT h.id FROM hospitals h WHERE h.id IN(SELECT hospital_id FROM purchase_orders WHERE sales_user_id=$1) ORDER BY h.id FOR SHARE',[from.id]);
  let orders=await pendingWork(c,from.id,lock);for(const id of v.orderIds)ensure(orders.some(o=>o.id===id),409,'HANDOFF_SCOPE_CHANGED','所选订单已完成、失效或不再属于原销售');
  if(lock){const ids=orders.flatMap(o=>o.receivable_id?[o.receivable_id]:[]);if(ids.length)await c.query('SELECT id FROM receivables WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[ids]);orders=await pendingWork(c,from.id);}
  return {from,to,hospitals,orders};
 }
 async preview(actor:Actor,input:unknown){const v=scope.parse(input);return this.store.db.transaction(async c=>{await admin(this.store,c,actor);const snapshot=await this.snapshot(c,v);return {from:camel(snapshot.from),to:camel(snapshot.to),orders:snapshot.orders.map(camel),hospitals:snapshot.hospitals.map(camel),selectedOrderIds:v.orderIds,selectedHospitalIds:v.hospitalIds,orderCount:snapshot.orders.length,receivableCount:snapshot.orders.filter(o=>o.receivable_id).length,exceptionCount:snapshot.orders.filter(o=>o.pending_exception).length,previewToken:await this.previews.issue(c,actor,{scope:v,snapshot})};});}
 async execute(actor:Actor,key:string,input:unknown){const value=z.object({previewToken:z.string().min(1).max(200)}).strict().parse(input);return adminMutation(this.store,actor,key,'admin.sales-handoff',value,async c=>{
   const preview=await this.previews.read(c,actor,value.previewToken),v=scope.parse(preview.scope),snapshot=await this.snapshot(c,v,true);
   ensure(stable(snapshot)===stable(preview.snapshot),409,'VERSION_CONFLICT','交接预览后资料或待办已变化，请重新预览');ensure(snapshot.orders.every(o=>v.orderIds.includes(o.id))&&snapshot.hospitals.every(h=>h.sales_user_id!==v.fromSalesUserId||v.hospitalIds.includes(h.id)),409,'HANDOFF_INCOMPLETE','仍有未明确交接的订单或医院，请完整选择交接范围');
   const id=randomUUID(),result={id,fromSalesUserId:v.fromSalesUserId,toSalesUserId:v.toSalesUserId,orderIds:v.orderIds,hospitalIds:v.hospitalIds,deactivated:true};await c.query('INSERT INTO sales_handoff_batches(id,from_sales_user_id,to_sales_user_id,reason,performed_by,performed_at,scope,result) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,v.fromSalesUserId,v.toSalesUserId,v.reason,actor.id,this.store.clock(),JSON.stringify(v),JSON.stringify(result)]);
   for(const o of snapshot.orders){await c.query('UPDATE purchase_orders SET sales_user_id=$2,row_version=row_version+1 WHERE id=$1',[o.id,v.toSalesUserId]);const after={...o,sales_user_id:v.toSalesUserId,row_version:o.row_version+1};await c.query('INSERT INTO sales_handoff_records(batch_id,purchase_order_id,from_sales_user_id,to_sales_user_id,before_snapshot,after_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[id,o.id,v.fromSalesUserId,v.toSalesUserId,JSON.stringify(o),JSON.stringify(after)]);await audited(this.store,c,actor,'admin.sales-handoff',{batchId:id,fromSalesUserId:v.fromSalesUserId,toSalesUserId:v.toSalesUserId,reason:v.reason},o.id);}
   for(const hospitalId of v.hospitalIds)await c.query('UPDATE hospitals SET sales_user_id=$2,row_version=row_version+1 WHERE id=$1',[hospitalId,v.toSalesUserId]);
   const remaining=await pendingWork(c,v.fromSalesUserId);ensure(!remaining.length&&!(await c.query('SELECT id FROM hospitals WHERE sales_user_id=$1',[v.fromSalesUserId])).rowCount,409,'HANDOFF_INCOMPLETE','仍有未交接事项，账号未停用');await c.query('UPDATE users SET active=false,row_version=row_version+1,access_scope_version=access_scope_version+1 WHERE id=$1',[v.fromSalesUserId]);await c.query('UPDATE users SET access_scope_version=access_scope_version+1 WHERE id=$1',[v.toSalesUserId]);await revoke(this.store,c,v.fromSalesUserId);await audited(this.store,c,actor,'admin.sales-handoff-complete',{...result,reason:v.reason});return result;
  });}
}
