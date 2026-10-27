import { z } from 'zod';
import type { Actor } from '../auth/auth';
import { CoreStore } from './store';
import { ensure, missing } from './errors';
import { date,purchaseLine,purchaseLines as linesSchema,version,today,uuid } from './validation';
import { decimal } from './money';
import { orderView,summary,comparison,draftView } from './read-model';
import {resolveLineOrigin} from './line-origin';
export class PurchaseService {
 constructor(readonly store:CoreStore){}
 async bootstrap(actor:Actor) {
  const hospitals=(await this.store.db.query('SELECT id,name,payment_term_days FROM hospitals WHERE sales_user_id=$1 AND active ORDER BY name',[actor.id])).rows;
  const purchasers=(await this.store.db.query('SELECT p.user_id AS id,u.name,p.hospital_id FROM hospital_purchasers p JOIN users u ON u.id=p.user_id JOIN hospitals h ON h.id=p.hospital_id WHERE p.active AND u.active AND h.sales_user_id=$1',[actor.id])).rows;
  return {hospitals:hospitals.map(h=>({id:h.id,name:h.name,paymentTermDays:h.payment_term_days,purchasers:purchasers.filter(p=>p.hospital_id===h.id).map(p=>({id:p.id,name:p.name}))})),manufacturers:(await this.store.db.query('SELECT id,name FROM manufacturers WHERE active ORDER BY name')).rows};
 }
 async list(actor:Actor){
  const rows=(await this.store.db.query("SELECT o.*,h.name AS hospital_name,r.id AS revision_id,r.revision_no FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no WHERE (o.sales_user_id=$1 OR h.sales_user_id=$1) AND o.entry_mode='normal' AND (o.submission_source<>'hospital_self' OR o.hospital_submitted_at IS NOT NULL) ORDER BY o.created_at DESC,o.id DESC LIMIT 100",[actor.id])).rows;
  return {items:rows.map(r=>summary(r,actor))};
 }
 async get(actor:Actor,id:string,mode:'order'|'comparison'|'draft'='order'){
  uuid.parse(id);return this.store.db.transaction(async c=>{const root=await this.store.root(c,actor,id);return mode==='comparison'?comparison(c,root,this.store.clock()):mode==='draft'?draftView(c,root,this.store.clock()):orderView(c,root,actor);});
 }
 async create(actor:Actor,key:string,input:unknown){
  const value=z.object({hospitalId:uuid,purchaserUserId:uuid,receivedDate:date,lines:z.array(purchaseLine).max(200)}).strict().parse(input);
  ensure(value.receivedDate<=today(this.store.clock()),400,'VALIDATION_FAILED','实际接收日期不能在未来');
  return this.store.mutate(actor,key,'purchase.create',value,null,async c=>{
   const hospital=(await c.query('SELECT * FROM hospitals WHERE id=$1 FOR SHARE',[value.hospitalId])).rows[0];ensure(hospital?.active&&hospital.sales_user_id===actor.id,403,'HOSPITAL_FORBIDDEN','只能为当前负责且启用的医院创建订单');
   const purchaser=(await c.query('SELECT p.* FROM hospital_purchasers p JOIN users u ON u.id=p.user_id WHERE p.user_id=$1 AND p.hospital_id=$2 AND p.active AND u.active FOR SHARE OF p,u',[value.purchaserUserId,hospital.id])).rows[0];ensure(purchaser,400,'PURCHASER_MISMATCH','采购员须属于所选医院且有效');
   const day=today(this.store.clock()),counter=(await c.query('INSERT INTO document_number_counters(business_date,value) VALUES($1,1) ON CONFLICT(business_date) DO UPDATE SET value=document_number_counters.value+1 RETURNING value',[day])).rows[0].value;
   const number='CG-'+day.replaceAll('-','')+'-'+String(counter).padStart(4,'0');
   const root=(await c.query('INSERT INTO purchase_orders(order_no,hospital_id,purchaser_user_id,sales_user_id,original_sales_user_id,received_date,payment_term_days,created_at) VALUES($1,$2,$3,$4,$4,$5,$6,$7) RETURNING *',[number,hospital.id,value.purchaserUserId,actor.id,value.receivedDate,hospital.payment_term_days,this.store.clock()])).rows[0];
   const revision=(await c.query('INSERT INTO purchase_order_revisions(purchase_order_id) VALUES($1) RETURNING id',[root.id])).rows[0];
   for(const [position,line] of value.lines.entries()){const origin=await resolveLineOrigin(c,line,{orderId:root.id,revisionId:revision.id});await c.query('INSERT INTO purchase_order_lines(revision_id,position,name,spec,quantity,checked,purchase_remark,source_type,item_id,item_variant_id,source_file_id,parsing_job_id,source_row_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[revision.id,position,line.name,line.spec,decimal(line.quantity,true).toFixed(2),line.checked,line.remark||'',origin.sourceType,origin.itemId,origin.itemVariantId,origin.sourceFileId,origin.parsingJobId,origin.sourceRowNumber]);}
   await this.store.audit(c,root.id,actor.id,'purchase.create',{source:'sales_entry'});return orderView(c,await this.store.root(c,actor,root.id),actor);
  });
 }
 async saveLines(actor:Actor,key:string,id:string,revisionId:string,input:unknown){
  uuid.parse(id);uuid.parse(revisionId);const value=z.object({expectedVersion:version,receivedDate:date.optional(),lines:linesSchema}).strict().parse(input);if(value.receivedDate)ensure(value.receivedDate<=today(this.store.clock()),400,'VALIDATION_FAILED','实际接收日期不能在未来');
  return this.store.mutate(actor,key,'purchase.save-lines',{...value,revisionId},id,async(c,r)=>{
   this.store.checkVersion(r.row_version,value.expectedVersion);ensure(r.revision_id===revisionId,409,'REVISION_CHANGED','当前采购修订已变化');ensure(r.status==='draft'&&r.revision_status==='draft',409,'FROZEN_READ_ONLY','冻结采购行不可修改');
   if(value.receivedDate&&value.receivedDate!==r.received_date){ensure(r.revision_no===1&&!(await c.query("SELECT id FROM purchase_order_revisions WHERE purchase_order_id=$1 AND frozen_at IS NOT NULL",[id])).rowCount,409,'RECEIVED_DATE_FROZEN','首次冻结后实际接收日期已封存，不能通过采购修订覆盖');await c.query('UPDATE purchase_orders SET received_date=$2 WHERE id=$1',[id,value.receivedDate]);}
   const originalRows=(await c.query('SELECT * FROM purchase_order_lines WHERE revision_id=$1',[revisionId])).rows,old=originalRows.map(x=>x.id);
   const ids=value.lines.flatMap(l=>l.id?[l.id]:[]);ensure(new Set(ids).size===ids.length&&ids.every(id=>old.includes(id)),400,'LINE_MISMATCH','包含重复或不属于本修订的行');
   await c.query('DELETE FROM purchase_order_lines WHERE revision_id=$1',[revisionId]);
   for(const [position,line] of value.lines.entries()){const original=originalRows.find(x=>x.id===line.id),origin=await resolveLineOrigin(c,line,{orderId:id,revisionId,previous:original});await c.query('INSERT INTO purchase_order_lines(id,revision_id,position,name,spec,quantity,checked,purchase_remark,source_file_id,parsing_job_id,source_row_number,source_type,item_id,item_variant_id) VALUES(COALESCE($1,gen_random_uuid()),$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[line.id||null,revisionId,position,line.name,line.spec,decimal(line.quantity,true).toFixed(2),line.checked,line.remark||'',origin.sourceFileId,origin.parsingJobId,origin.sourceRowNumber,origin.sourceType,origin.itemId,origin.itemVariantId]);}
   await this.store.bump(c,id);await this.store.audit(c,id,actor.id,'purchase.save-lines',{lineCount:value.lines.length,beforeReceivedDate:r.received_date,afterReceivedDate:value.receivedDate??r.received_date});return orderView(c,await this.store.root(c,actor,id),actor);
  });
 }
 async freeze(actor:Actor,key:string,id:string,revisionId:string,input:unknown){
  uuid.parse(id);uuid.parse(revisionId);const value=z.object({expectedVersion:version}).strict().parse(input);
  return this.store.mutate(actor,key,'purchase.freeze',{...value,revisionId},id,async(c,r)=>{
   this.store.checkVersion(r.row_version,value.expectedVersion);ensure(r.revision_id===revisionId&&r.status==='draft',409,'STATE_CONFLICT','当前修订不是可冻结草稿');
   const lines=(await c.query('SELECT checked FROM purchase_order_lines WHERE revision_id=$1',[revisionId])).rows;ensure(lines.length>0&&lines.every(l=>l.checked),400,'LINES_UNCHECKED','请逐行校对并确认全部采购明细');
   await c.query("UPDATE purchase_order_revisions SET status='frozen',frozen_at=$2 WHERE id=$1",[revisionId,this.store.clock()]);await c.query("UPDATE purchase_orders SET status='frozen',row_version=row_version+1 WHERE id=$1",[id]);
   await this.store.audit(c,id,actor.id,'purchase.freeze',{revisionId});return orderView(c,await this.store.root(c,actor,id),actor);
  });
 }
 async orderIdForRevision(revisionId:string){uuid.parse(revisionId);const r=(await this.store.db.query('SELECT purchase_order_id FROM purchase_order_revisions WHERE id=$1',[revisionId])).rows[0];if(!r)throw missing();return r.purchase_order_id as string;}
}
