import { z } from 'zod';
import { createHash } from 'node:crypto';
import type { Actor } from '../auth/auth';
import { secretHash,newSecret } from '../auth/auth';
import type { Config } from '../config';
import { CoreStore,stable,type Client } from './store';
import { PurchaseService } from './purchases';
import { uuid,version,reason,supplierInput,today } from './validation';
import { ensure,missing } from './errors';
import { orderView,purchaseLines } from './read-model';
import { decimal } from './money';
export class SupplierService {
 constructor(readonly store:CoreStore,readonly config:Config){}
 private frozen(r:any){ensure(r.revision_status==='frozen'&&['frozen','quote_draft','quote_exported','quote_sent'].includes(r.status),409,'STATE_CONFLICT','须使用当前已冻结采购修订');}
 async createTask(actor:Actor,key:string,revisionId:string,input:unknown){
  const value=z.object({expectedVersion:version,slotNo:z.union([z.literal(1),z.literal(2)]),manufacturerId:uuid}).strict().parse(input);
  const orderId=await new PurchaseService(this.store).orderIdForRevision(revisionId);
  return this.store.mutate(actor,key,'supplier.task-create',{...value,revisionId},orderId,async(c,r)=>{
   this.store.checkVersion(r.row_version,value.expectedVersion);this.frozen(r);ensure(r.revision_id===revisionId,409,'REVISION_CHANGED','当前采购修订已变化');
   ensure((await c.query('SELECT id FROM manufacturers WHERE id=$1 AND active',[value.manufacturerId])).rowCount,400,'MANUFACTURER_UNAVAILABLE','厂家不存在或已停用');
   await c.query('INSERT INTO supplier_tasks(revision_id,manufacturer_id,slot_no) VALUES($1,$2,$3)',[revisionId,value.manufacturerId,value.slotNo]);await this.store.bump(c,orderId);await this.store.audit(c,orderId,actor.id,'supplier.task-create',{slot:value.slotNo,manufacturerId:value.manufacturerId});return orderView(c,await this.store.root(c,actor,orderId),actor);
  });
 }
 private async taskOrder(taskId:string){uuid.parse(taskId);const t=(await this.store.db.query('SELECT r.purchase_order_id FROM supplier_tasks t JOIN purchase_order_revisions r ON r.id=t.revision_id WHERE t.id=$1',[taskId])).rows[0];if(!t)throw missing();return t.purchase_order_id as string;}
 private async invalidate(c:Client,taskId:string){
  const submissions=(await c.query("SELECT id FROM supplier_quote_submissions WHERE task_id=$1 AND status='current'",[taskId])).rows.map(s=>s.id);
  if(!submissions.length)return;
  const affected=`SELECT ql.version_id FROM quote_lines ql WHERE (ql.adopted_kind='priced' AND ql.base_supplier_quote_line_id IN(SELECT id FROM supplier_quote_lines WHERE submission_id=ANY($1::uuid[]))) OR (ql.adopted_kind='missing' AND EXISTS(SELECT 1 FROM jsonb_array_elements(ql.adopted_supplier_snapshot) snapshot WHERE snapshot->>'supplierQuoteLineId' IN(SELECT id::text FROM supplier_quote_lines WHERE submission_id=ANY($1::uuid[]))))`;
  await c.query("UPDATE quote_versions SET use_invalidated_at=COALESCE(use_invalidated_at,$2),row_version=row_version+1 WHERE first_exported_at IS NOT NULL AND status IN('exported','sent') AND id IN("+affected+")",[submissions,this.store.clock()]);
  await c.query("UPDATE quote_versions SET row_version=row_version+1 WHERE status='draft' AND id IN("+affected+")",[submissions]);
  await c.query("UPDATE quote_lines SET final_confirmed=false,recommended_price=NULL WHERE version_id IN(SELECT id FROM quote_versions WHERE status='draft') AND base_supplier_quote_line_id IN(SELECT id FROM supplier_quote_lines WHERE submission_id=ANY($1::uuid[]))",[submissions]);
  await c.query("UPDATE supplier_quote_submissions SET status='superseded' WHERE task_id=$1 AND status='current'",[taskId]);
 }
 async link(actor:Actor,key:string,taskId:string,mode:'generate'|'regenerate'|'requote',input:unknown){
  const schema=mode==='generate'?z.object({expectedVersion:version}).strict():mode==='regenerate'?z.object({expectedVersion:version,expectedLinkId:uuid,reason}).strict():z.object({expectedVersion:version,expectedSubmissionId:uuid,reason}).strict();
  const value=schema.parse(input) as {expectedVersion:number;expectedLinkId?:string;expectedSubmissionId?:string;reason?:string};
  const orderId=await this.taskOrder(taskId);
  return this.store.mutate(actor,key,'supplier.link-'+mode,{...value,taskId},orderId,async(c,r)=>{
   this.store.checkVersion(r.row_version,value.expectedVersion);this.frozen(r);
   const task=(await c.query('SELECT * FROM supplier_tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];ensure(task&&task.revision_id===r.revision_id&&task.status!=='cancelled',409,'TASK_UNAVAILABLE','任务已取消或不属于当前修订');
   const submitted=(await c.query("SELECT id FROM supplier_quote_submissions WHERE task_id=$1 AND status='current'",[taskId])).rows[0];
   const currentLink=(await c.query("SELECT id FROM supplier_links WHERE task_id=$1 AND status IN('active','used')",[taskId])).rows[0];
   if(mode==='requote'){ensure(submitted?.id===value.expectedSubmissionId,409,'STATE_CONFLICT','厂家当前提交已变化，请核对后重新询价');await this.invalidate(c,taskId);}
   else {ensure(!submitted,409,'STATE_CONFLICT','厂家已经提交，须明确重新询价');ensure(mode==='generate'?!currentLink:currentLink?.id===value.expectedLinkId,409,'STATE_CONFLICT','链接已变化，请刷新核对');}
   await c.query("UPDATE supplier_links SET status='revoked' WHERE task_id=$1 AND status<>'revoked'",[taskId]);
   const token=newSecret(),expiresAt=new Date(this.store.clock().getTime()+48*3600000);
   const link=(await c.query('INSERT INTO supplier_links(task_id,token_hash,expires_at,created_at) VALUES($1,$2,$3,$4) RETURNING id',[taskId,secretHash(token),expiresAt,this.store.clock()])).rows[0];
   if(mode==='requote')await c.query("UPDATE supplier_tasks SET status='requote' WHERE id=$1",[taskId]);
   await this.store.bump(c,orderId);await this.store.audit(c,orderId,actor.id,'supplier.link-'+mode,{taskId,linkId:link.id,reason:value.reason||null});
   return {linkId:link.id,url:this.config.supplierWebUrl.replace(/\/$/,'')+'/#token='+encodeURIComponent(token),expiresAt:expiresAt.toISOString(),orderVersion:r.row_version+1};
  });
 }
 async cancel(actor:Actor,key:string,taskId:string,input:unknown){
  const value=z.object({expectedVersion:version,reason}).strict().parse(input),orderId=await this.taskOrder(taskId);
  return this.store.mutate(actor,key,'supplier.cancel',{...value,taskId},orderId,async(c,r)=>{
   this.store.checkVersion(r.row_version,value.expectedVersion);this.frozen(r);const task=(await c.query('SELECT * FROM supplier_tasks WHERE id=$1 FOR UPDATE',[taskId])).rows[0];ensure(task?.revision_id===r.revision_id&&task.status!=='cancelled',409,'TASK_UNAVAILABLE','任务状态已变化');
   await this.invalidate(c,taskId);await c.query("UPDATE supplier_links SET status='revoked' WHERE task_id=$1",[taskId]);await c.query("UPDATE supplier_tasks SET status='cancelled' WHERE id=$1",[taskId]);await this.store.bump(c,orderId);await this.store.audit(c,orderId,actor.id,'supplier.cancel',{taskId,reason:value.reason});return orderView(c,await this.store.root(c,actor,orderId),actor);
  });
 }
 async exchange(input:unknown){
  const {token}=z.object({token:z.string().min(32).max(128)}).strict().parse(input);
  return this.store.db.transaction(async c=>{
   const ref=(await c.query('SELECT r.purchase_order_id FROM supplier_links l JOIN supplier_tasks t ON t.id=l.task_id JOIN purchase_order_revisions r ON r.id=t.revision_id WHERE l.token_hash=$1',[secretHash(token)])).rows[0];ensure(ref,410,'LINK_INVALID','填写链接无效');
   await c.query('SELECT id FROM purchase_orders WHERE id=$1 FOR SHARE',[ref.purchase_order_id]);
   const link=(await c.query("SELECT l.*,t.revision_id,t.status AS task_status,r.purchase_order_id,r.revision_no,r.status AS revision_status,o.current_revision_no FROM supplier_links l JOIN supplier_tasks t ON t.id=l.task_id JOIN purchase_order_revisions r ON r.id=t.revision_id JOIN purchase_orders o ON o.id=r.purchase_order_id WHERE l.token_hash=$1",[secretHash(token)])).rows[0];
   ensure(link&&link.status==='active'&&link.expires_at>this.store.clock()&&link.task_status!=='cancelled'&&link.revision_status==='frozen'&&link.current_revision_no===link.revision_no,410,'LINK_INVALID','填写链接已失效或已提交，请联系销售核对');
   const sessionToken=newSecret();await c.query('INSERT INTO supplier_sessions(token_hash,link_id,expires_at) VALUES($1,$2,$3)',[secretHash(sessionToken),link.id,link.expires_at]);return {sessionToken,expiresAt:link.expires_at.toISOString()};
  });
 }
 async capability(c:Client,token:string){
  const ref=(await c.query('SELECT r.purchase_order_id FROM supplier_sessions ss JOIN supplier_links l ON l.id=ss.link_id JOIN supplier_tasks t ON t.id=l.task_id JOIN purchase_order_revisions r ON r.id=t.revision_id WHERE ss.token_hash=$1',[secretHash(token||'')])).rows[0];ensure(ref,410,'LINK_INVALID','填写会话无效');
  await c.query('SELECT id FROM purchase_orders WHERE id=$1 FOR SHARE',[ref.purchase_order_id]);
  const r=(await c.query('SELECT ss.link_id,ss.expires_at AS session_expires,l.status AS link_status,l.expires_at AS link_expires,l.task_id,t.revision_id,t.manufacturer_id,t.status AS task_status,m.name AS manufacturer_name,r.purchase_order_id,r.revision_no,r.status AS revision_status,o.received_date,o.current_revision_no,o.status AS order_status FROM supplier_sessions ss JOIN supplier_links l ON l.id=ss.link_id JOIN supplier_tasks t ON t.id=l.task_id JOIN manufacturers m ON m.id=t.manufacturer_id JOIN purchase_order_revisions r ON r.id=t.revision_id JOIN purchase_orders o ON o.id=r.purchase_order_id WHERE ss.token_hash=$1',[secretHash(token||'')])).rows[0];
  ensure(r&&r.link_status!=='revoked'&&r.session_expires>this.store.clock()&&r.link_expires>this.store.clock()&&r.task_status!=='cancelled'&&r.revision_status==='frozen'&&r.revision_no===r.current_revision_no,410,'LINK_INVALID','填写入口已过期或被重新生成，请联系销售');return r;
 }
 private async form(c:Client,r:any){
  const submission=(await c.query("SELECT * FROM supplier_quote_submissions WHERE task_id=$1 AND status='current'",[r.task_id])).rows[0];
  const submitted=submission?{id:submission.id,validUntil:submission.valid_until,lines:(await c.query('SELECT purchase_line_id AS "purchaseLineId",status,unit_price AS "unitPrice" FROM supplier_quote_lines WHERE submission_id=$1 ORDER BY purchase_line_id',[submission.id])).rows}:null;
  return {manufacturerName:r.manufacturer_name,revisionNo:r.revision_no,receivedDate:r.received_date,linkExpiresAt:r.link_expires.toISOString(),lines:(await purchaseLines(c,r.revision_id)).map(({id,name,spec,quantity,unit,checked,remark})=>({id,name,spec,quantity,unit,checked,remark})),submitted};
 }
 get(token:string){return this.store.db.transaction(async c=>this.form(c,await this.capability(c,token)));}
 async submit(token:string,key:string,input:unknown){
  uuid.parse(key);const value=supplierInput.parse(input);
  const ref=(await this.store.db.query('SELECT r.purchase_order_id FROM supplier_sessions ss JOIN supplier_links l ON l.id=ss.link_id JOIN supplier_tasks t ON t.id=l.task_id JOIN purchase_order_revisions r ON r.id=t.revision_id WHERE ss.token_hash=$1',[secretHash(token||'')])).rows[0];ensure(ref,410,'LINK_INVALID','填写会话无效');
  return this.store.db.transaction(async c=>{
   await c.query('SELECT id FROM purchase_orders WHERE id=$1 FOR UPDATE',[ref.purchase_order_id]);const cap=await this.capability(c,token);
   const digest=createHash('sha256').update(stable({operation:'supplier.submit',input:value})).digest('hex');
   const old=(await c.query("SELECT * FROM operation_requests WHERE actor_type='supplier' AND actor_id=$1 AND idempotency_key=$2",[cap.link_id,key])).rows[0];
   if(old){ensure(old.content_hash===digest,409,'IDEMPOTENCY_KEY_REUSED','请求标识已用于不同报价');return old.result;}
   ensure(!['completed','voided'].includes(cap.order_status),409,'ORDER_COMPLETED','订单已完成或作废，不再接受厂家提交');
   ensure(value.validUntil>=today(this.store.clock()),400,'VALIDATION_FAILED','报价有效至日不可早于今天');
   ensure(cap.link_status==='active'&&cap.task_status!=='submitted',409,'ALREADY_SUBMITTED','已提交，请查看回执或联系销售重新询价');
   const frozen=await purchaseLines(c,cap.revision_id),ids=value.lines.map(l=>l.purchaseLineId);
   ensure(ids.length===frozen.length&&new Set(ids).size===ids.length&&frozen.every(l=>ids.includes(l.id)),400,'LINES_INCOMPLETE','必须完整填写本次全部采购行，不能增加、遗漏或重复');
   const submission=(await c.query("INSERT INTO supplier_quote_submissions(task_id,revision_id,submission_no,valid_until,created_at) SELECT $1,$2,COALESCE(MAX(submission_no),0)+1,$3,$4 FROM supplier_quote_submissions WHERE task_id=$1 RETURNING id",[cap.task_id,cap.revision_id,value.validUntil,this.store.clock()])).rows[0];
   for(const line of value.lines)await c.query('INSERT INTO supplier_quote_lines(submission_id,revision_id,purchase_line_id,status,unit_price) VALUES($1,$2,$3,$4,$5)',[submission.id,cap.revision_id,line.purchaseLineId,line.status,line.unitPrice===null?null:decimal(line.unitPrice,true).toFixed(2)]);
   await c.query("UPDATE supplier_links SET status='used' WHERE id=$1",[cap.link_id]);await c.query("UPDATE supplier_tasks SET status='submitted' WHERE id=$1",[cap.task_id]);await this.store.bump(c,cap.purchase_order_id);await this.store.audit(c,cap.purchase_order_id,cap.link_id,'supplier.submit',{taskId:cap.task_id,submissionId:submission.id});
   const result=await this.form(c,cap);await c.query("INSERT INTO operation_requests VALUES('supplier',$1,$2,'supplier.submit',$3,$4,$5)",[cap.link_id,key,digest,JSON.stringify(result),this.store.clock()]);return result;
  });
 }
 async operation(token:string,key:string){uuid.parse(key);return this.store.db.transaction(async c=>{const cap=await this.capability(c,token);const row=(await c.query("SELECT result FROM operation_requests WHERE actor_type='supplier' AND actor_id=$1 AND idempotency_key=$2",[cap.link_id,key])).rows[0];return row?{status:'committed',result:row.result}:{status:'not_found'};});}
}
