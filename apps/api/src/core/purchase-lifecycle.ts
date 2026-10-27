import {z} from 'zod';
import type {Actor} from '../auth/auth';
import {CoreStore,type Client} from './store';
import {ensure} from './errors';
import {uuid,version,reason} from './validation';
import {orderView} from './read-model';
const command=z.object({expectedVersion:version,reason}).strict();
/** Root-locked lifecycle commands. Frozen purchase and price facts are never rewritten. */
export class PurchaseLifecycleService {
 constructor(readonly store:CoreStore){}
 private async open(c:Client,root:any){
  ensure(root.entry_mode==='normal',409,'HISTORICAL_FLOW_REQUIRED','历史资料须使用专用入口');
  const terminal=(await c.query("SELECT id FROM quotes WHERE purchase_order_id=$1 AND (confirmed_version_id IS NOT NULL OR status='completed') UNION ALL SELECT id FROM receivables WHERE purchase_order_id=$1 UNION ALL SELECT v.id FROM quote_versions v JOIN quotes q ON q.id=v.quote_id WHERE q.purchase_order_id=$1 AND v.status='confirmed'",[root.id])).rowCount;
  ensure(!terminal&&!['completed','voided'].includes(root.status),409,'ORDER_COMPLETED','已完成、最终确认或形成应收的订单不能换版或整单作废');
  // Even an expired running lease can represent an external write whose outcome is unknown.
  // Let the export worker resolve it; cancelling here would hide the outstanding effect.
  const occupied=(await c.query("SELECT v.id FROM quote_versions v JOIN quotes q ON q.id=v.quote_id WHERE q.purchase_order_id=$1 AND v.active_export_id IS NOT NULL UNION ALL SELECT a.id FROM quote_export_attempts a WHERE a.order_id=$1 AND a.state='pending' UNION ALL SELECT j.id FROM export_jobs j JOIN quote_export_attempts a ON a.id=j.export_id WHERE a.order_id=$1 AND j.state IN('queued','running')",[root.id])).rowCount;
  ensure(!occupied,409,'EXPORT_OCCUPIED','存在未完成的导出任务，请先核对并解决原任务后操作');
 }
 private async closeLinks(c:Client,orderId:string,revisionId:string|null){
  const tasks='SELECT t.id FROM supplier_tasks t JOIN purchase_order_revisions r ON r.id=t.revision_id WHERE r.purchase_order_id=$1 AND ($2::uuid IS NULL OR r.id=$2)';
  const links='SELECT id FROM supplier_links WHERE task_id IN('+tasks+')';
  await c.query('UPDATE supplier_sessions SET expires_at=LEAST(expires_at,$3) WHERE link_id IN('+links+')',[orderId,revisionId,this.store.clock()]);
  await c.query("UPDATE supplier_links SET status='revoked' WHERE task_id IN("+tasks+") AND status<>'revoked'",[orderId,revisionId]);
 }
 async revise(actor:Actor,key:string,orderId:string,input:unknown){
  uuid.parse(orderId);const value=command.parse(input);
  return this.store.mutate(actor,key,'purchase.revise',value,orderId,async(c,root)=>{
   this.store.checkVersion(root.row_version,value.expectedVersion);await this.open(c,root);
   ensure(root.revision_status==='frozen',409,'REVISION_NOT_FROZEN','仅可从当前已冻结采购修订创建下一草稿；当前草稿请直接改正');
   const next=(await c.query('INSERT INTO purchase_order_revisions(purchase_order_id,revision_no) VALUES($1,$2) RETURNING id',[orderId,root.revision_no+1])).rows[0];
   await c.query('INSERT INTO purchase_order_lines(revision_id,position,name,spec,quantity,unit,checked,purchase_remark,source_type,item_id,item_variant_id,source_file_id,parsing_job_id,source_row_number) SELECT $2,position,name,spec,quantity,unit,false,purchase_remark,source_type,item_id,item_variant_id,source_file_id,parsing_job_id,source_row_number FROM purchase_order_lines WHERE revision_id=$1 ORDER BY position',[root.revision_id,next.id]);
   await this.closeLinks(c,orderId,root.revision_id);
   await c.query("UPDATE quote_versions SET use_invalidated_at=COALESCE(use_invalidated_at,$2),row_version=row_version+1 WHERE quote_id IN(SELECT id FROM quotes WHERE revision_id=$1) AND status IN('draft','exported','sent')",[root.revision_id,this.store.clock()]);
   await c.query("UPDATE purchase_order_revisions SET status='superseded' WHERE id=$1",[root.revision_id]);
   await c.query("UPDATE purchase_orders SET current_revision_no=$2,status='draft',row_version=row_version+1 WHERE id=$1",[orderId,root.revision_no+1]);
   await this.store.audit(c,orderId,actor.id,'purchase.revise',{previousRevisionId:root.revision_id,revisionId:next.id,revisionNo:root.revision_no+1,reason:value.reason});
   return orderView(c,await this.store.root(c,actor,orderId),actor);
  });
 }
 async void(actor:Actor,key:string,orderId:string,input:unknown){
  uuid.parse(orderId);const value=command.parse(input);
  return this.store.mutate(actor,key,'purchase.void',value,orderId,async(c,root)=>{
   this.store.checkVersion(root.row_version,value.expectedVersion);await this.open(c,root);
   await this.closeLinks(c,orderId,null);
   await c.query("UPDATE supplier_tasks SET status='cancelled' WHERE revision_id IN(SELECT id FROM purchase_order_revisions WHERE purchase_order_id=$1) AND status IN('pending','requote')",[orderId]);
   await c.query("UPDATE quote_versions SET use_invalidated_at=COALESCE(use_invalidated_at,$2),row_version=row_version+1 WHERE quote_id IN(SELECT id FROM quotes WHERE purchase_order_id=$1) AND status IN('draft','exported','sent')",[orderId,this.store.clock()]);
   // Pending parsing has no provider side effect. Processing/unknown results remain observable;
   // completion may retain evidence, while terminal root guards prohibit applying it to business rows.
   await c.query("UPDATE source_parsing_jobs SET status='failed',error_code='ORDER_VOIDED',error_message='订单已作废，解析任务关闭',retryable=false,completed_at=$2,lease_until=NULL WHERE file_id IN(SELECT id FROM source_files WHERE order_id=$1) AND status='pending'",[orderId,this.store.clock()]);
   await c.query("UPDATE purchase_orders SET status='voided',row_version=row_version+1 WHERE id=$1",[orderId]);
   await this.store.audit(c,orderId,actor.id,'purchase.void',{previousStatus:root.status,revisionId:root.revision_id,reason:value.reason});
   return orderView(c,await this.store.root(c,actor,orderId),actor);
  });
 }
}
