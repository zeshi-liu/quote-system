import {createHash} from 'node:crypto';
import {newSecret,secretHash,type Actor} from '../auth/auth';
import {CoreStore,stable,type Client} from '../core/store';
import {ensure} from '../core/errors';
import {uuid} from '../core/validation';
export const metadataLock=790128;
export const camel=(row:any):any=>Object.fromEntries(Object.entries(row).filter(([key])=>!['password_hash','auth_version','temporary_password_expires_at'].includes(key)).map(([key,value])=>[key==='row_version'?'version':key.replace(/_([a-z])/g,(_m,c)=>c.toUpperCase()),value instanceof Date?value.toISOString():value]));
export async function admin(store:CoreStore,c:Client,actor:Actor){await store.active(c,actor);ensure(actor.role==='admin'&&actor.channel==='pc',403,'ROLE_FORBIDDEN','仅管理员 PC 可维护基础资料及执行专项交接');}
export async function audited(store:CoreStore,c:Client,actor:Actor,action:string,details:unknown,orderId:string|null=null){await c.query('INSERT INTO audit_records(purchase_order_id,actor_id,action,details,created_at,actor_name_snapshot) VALUES($1,$2,$3,$4,$5,$6)',[orderId,actor.id,action,JSON.stringify(details),store.clock(),actor.name]);}
export async function adminMutation<T>(store:CoreStore,actor:Actor,key:string,operation:string,input:unknown,action:(c:Client)=>Promise<T>,cache:(value:T)=>unknown=value=>value):Promise<T>{
 uuid.parse(key);const digest=createHash('sha256').update(stable({operation,input})).digest('hex');
 return store.db.transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock($1)',[metadataLock]);await admin(store,c,actor);const old=(await c.query("SELECT content_hash,result FROM operation_requests WHERE actor_type='user' AND actor_id=$1 AND idempotency_key=$2",[actor.id,key])).rows[0];if(old){ensure(old.content_hash===digest,409,'IDEMPOTENCY_KEY_REUSED','同一请求标识不能用于不同内容');return old.result as T;}const result=await action(c);await c.query("INSERT INTO operation_requests(actor_type,actor_id,idempotency_key,operation,content_hash,result,created_at) VALUES('user',$1,$2,$3,$4,$5,$6)",[actor.id,key,operation,digest,JSON.stringify(cache(result)),store.clock()]);return result;});
}
export class PreviewTokens {
 constructor(readonly store:CoreStore,readonly purpose:string){}
 async issue(c:Client,actor:Actor,value:unknown){
  const user=(await c.query('SELECT active,auth_version,access_scope_version FROM users WHERE id=$1 FOR SHARE',[actor.id])).rows[0];ensure(user?.active,401,'SESSION_EXPIRED','账号已停用');
  const token=newSecret(),now=this.store.clock(),expires=new Date(now.getTime()+900000);
  // Cleanup must not wait on an in-flight confirmation after the snapshot locked users.
  await c.query('WITH expired AS(SELECT token_hash FROM master_data_previews WHERE actor_id=$1 AND expires_at<=$2 ORDER BY expires_at,token_hash LIMIT 200 FOR UPDATE SKIP LOCKED) DELETE FROM master_data_previews p USING expired e WHERE p.token_hash=e.token_hash',[actor.id,now]);
  await c.query('INSERT INTO master_data_previews(token_hash,actor_id,purpose,auth_version,access_scope_version,payload,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[secretHash(token),actor.id,this.purpose,user.auth_version,user.access_scope_version,JSON.stringify(value),now,expires]);return token;
 }
 async read(c:Client,actor:Actor,token:string):Promise<any>{
  ensure(typeof token==='string'&&/^[A-Za-z0-9_-]{43}$/.test(token),409,'PREVIEW_INVALID','预览凭证已失效，请重新预览');
  const row=(await c.query('SELECT p.payload FROM master_data_previews p JOIN users u ON u.id=p.actor_id WHERE p.token_hash=$1 AND p.actor_id=$2 AND p.purpose=$3 AND p.expires_at>$4 AND u.active AND p.auth_version=u.auth_version AND p.access_scope_version=u.access_scope_version FOR SHARE OF p,u',[secretHash(token),actor.id,this.purpose,this.store.clock()])).rows[0];ensure(row,409,'PREVIEW_INVALID','预览已过期或身份权限已变化，请重新预览');return row.payload;
 }
}
export async function activeSales(c:Client,id:string){const row=(await c.query('SELECT id,role,active FROM users WHERE id=$1 FOR SHARE',[id])).rows[0];ensure(row?.active&&row.role==='salesperson',400,'INVALID_ASSIGNEE','接手人必须是启用的销售账号');}
// Owner is authoritative on the order. Finance reminders and receivable reads JOIN it live.
export async function pendingWork(c:Client,userId:string,lock=false){
 const hasExceptions=(await c.query("SELECT to_regclass('receivable_exceptions') AS name")).rows[0].name;
 const exception=hasExceptions?"EXISTS(SELECT 1 FROM receivable_exceptions ex WHERE ex.receivable_id=ar.id AND ex.status='pending_verification')":'false';
 const rows=(await c.query(`SELECT o.id,o.order_no,o.hospital_id,o.sales_user_id,o.original_sales_user_id,o.row_version,o.status,ar.id AS receivable_id,ar.amount::text AS amount,ar.payment_term_days,ar.due_date,COALESCE((SELECT sum(p.amount) FROM payment_records p WHERE p.receivable_id=ar.id AND p.status='active'),0)::numeric(12,2)::text AS paid,${exception} AS pending_exception FROM purchase_orders o LEFT JOIN receivables ar ON ar.purchase_order_id=o.id WHERE o.sales_user_id=$1 AND (o.status NOT IN('completed','voided') OR o.status<>'voided' AND ar.amount>COALESCE((SELECT sum(p.amount) FROM payment_records p WHERE p.receivable_id=ar.id AND p.status='active'),0) OR ${exception}) ORDER BY o.id ${lock?'FOR UPDATE OF o':''}`,[userId])).rows;
 return rows;
}
export async function revoke(store:CoreStore,c:Client,userId:string){await c.query('UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,$2) WHERE user_id=$1',[userId,store.clock()]);await c.query('UPDATE password_setup_tickets SET used_at=COALESCE(used_at,$2) WHERE user_id=$1',[userId,store.clock()]);}
