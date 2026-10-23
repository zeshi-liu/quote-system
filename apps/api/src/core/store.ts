import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { Database } from '../db/database';
import type { Actor } from '../auth/auth';
import { ensure, missing, conflict } from './errors';
import { uuid } from './validation';
export type Client=PoolClient;
export const stable=(v:any):string=>JSON.stringify(v,(_k,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort().reduce((o:any,k)=>(o[k]=value[k],o),{}):value);
export class CoreStore {
 constructor(readonly db:Database,readonly clock=()=>new Date()){}
 async root(c:Client,actor:Actor,id:string,write=false) {
   const reference=(await c.query('SELECT hospital_id FROM purchase_orders WHERE id=$1',[id])).rows[0];if(!reference)throw missing();
   await c.query('SELECT id FROM hospitals WHERE id=$1 FOR SHARE',[reference.hospital_id]);
   const locked=(await c.query(`SELECT id FROM purchase_orders WHERE id=$1 ${write?'FOR UPDATE':'FOR SHARE'}`,[id])).rows[0];if(!locked)throw missing();
   const row=(await c.query('SELECT o.*,h.name AS hospital_name,h.sales_user_id AS hospital_owner,r.id AS revision_id,r.revision_no,r.status AS revision_status FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no WHERE o.id=$1',[id])).rows[0];
   if(!row||(row.sales_user_id!==actor.id&&row.hospital_owner!==actor.id))throw missing();
   if(write)ensure(row.sales_user_id===actor.id,403,'ORDER_READ_ONLY','旧订单仅订单负责销售可操作');
   return row;
 }
 checkVersion(actual:number,expected:number) {if(actual!==expected)throw conflict('已被其他操作更新，请重新加载核对');}
 async bump(c:Client,id:string){await c.query('UPDATE purchase_orders SET row_version=row_version+1 WHERE id=$1',[id]);}
 async audit(c:Client,orderId:string,actorId:string,action:string,details:unknown){await c.query('INSERT INTO audit_records(purchase_order_id,actor_id,action,details,created_at) VALUES($1,$2,$3,$4,$5)',[orderId,actorId,action,JSON.stringify(details),this.clock()]);}
 async active(c:Client,actor:Actor){
   const user=(await c.query('SELECT active FROM users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];ensure(user?.active,401,'SESSION_EXPIRED','账号已停用');
   const session=(await c.query('SELECT revoked_at,expires_at FROM auth_sessions WHERE id=$1 FOR SHARE',[actor.sessionId])).rows[0];ensure(session&&!session.revoked_at&&session.expires_at>this.clock(),401,'SESSION_EXPIRED','会话已失效');
 }
 async authorizeResult(c:Client,actor:Actor,result:any){
   let orderId=result?.orderId||(result?.hospitalName?result.id:null);
   if(result?.linkId){const link=(await c.query('SELECT r.purchase_order_id FROM supplier_links l JOIN supplier_tasks t ON t.id=l.task_id JOIN purchase_order_revisions r ON r.id=t.revision_id WHERE l.id=$1',[result.linkId])).rows[0];if(!link)throw missing();orderId=link.purchase_order_id;}
   if(orderId)await this.root(c,actor,orderId);
 }
 async operation(actor:Actor,key:string){
   uuid.parse(key);return this.db.transaction(async c=>{await this.active(c,actor);const row=(await c.query("SELECT result FROM operation_requests WHERE actor_type='user' AND actor_id=$1 AND idempotency_key=$2",[actor.id,key])).rows[0];if(!row)return {status:'not_found'};await this.authorizeResult(c,actor,row.result);return {status:'committed',result:row.result};});
 }
 async mutate<T>(actor:Actor,key:string,operation:string,input:unknown,orderId:string|null,action:(c:Client,root:any)=>Promise<T>):Promise<T>{
   uuid.parse(key);const digest=createHash('sha256').update(stable({operation,orderId,input})).digest('hex');
   try{return await this.db.transaction(async c=>{
     await this.active(c,actor);
     const root=orderId?await this.root(c,actor,orderId,true):null;
     const old=(await c.query("SELECT * FROM operation_requests WHERE actor_type='user' AND actor_id=$1 AND idempotency_key=$2",[actor.id,key])).rows[0];
     if(old){ensure(old.content_hash===digest,409,'IDEMPOTENCY_KEY_REUSED','同一请求标识不能用于不同内容');await this.authorizeResult(c,actor,old.result);return old.result;}
     if(root)ensure(!['completed','voided'].includes(root.status)||operation==='delivery.confirm',409,'ORDER_COMPLETED','订单已完成或作废，仅可查看');
     const result=await action(c,root);
     const safe:any=result&&typeof result==='object'?{...result}:result;
     if(safe?.url){delete safe.url;safe.originalUnavailable=true;}
     await c.query("INSERT INTO operation_requests(actor_type,actor_id,idempotency_key,operation,content_hash,result,created_at) VALUES('user',$1,$2,$3,$4,$5,$6)",[actor.id,key,operation,digest,JSON.stringify(safe),this.clock()]);
     return result;
   });}catch(error:any){
     if(error.code==='23505'){
       const old=(await this.db.query("SELECT * FROM operation_requests WHERE actor_type='user' AND actor_id=$1 AND idempotency_key=$2",[actor.id,key])).rows[0];
       if(old){ensure(old.content_hash===digest,409,'IDEMPOTENCY_KEY_REUSED','请求标识冲突');return this.db.transaction(async c=>{await this.active(c,actor);await this.authorizeResult(c,actor,old.result);return old.result;});}
       throw conflict('任务位、厂家或业务记录已存在，请刷新核对');
     }throw error;
   }
 }
}
