import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {z} from 'zod';
import type {Actor} from '../auth/auth';
import {secretHash,sessionIdleMs} from '../auth/auth';
import {CoreStore,stable,type Client} from '../core/store';
import {ensure,missing} from '../core/errors';
import type {ObjectStorage} from '../delivery/storage';
import type {SourceFile,SourceReference,SourceDownloadGrant} from '../../../../packages/contracts/src/source-files';
import {sourceReference,validateFile,MAX_BYTES} from './validation';
const uploadSchema=z.object({reference:sourceReference,purpose:z.enum(['purchase_image','purchase_excel','historical_attachment','payment_proof','manufacturer_source','template_logo']),fileName:z.string().min(1).max(200).refine(v=>!/[\x00-\x1f/\\]/.test(v)&&v.trim()===v,'文件名无效'),mimeType:z.string().max(150),base64:z.string().max(32*1024*1024),parentFileId:z.uuid().optional()}).strict();
export class SourceFileService {
 constructor(readonly core:CoreStore,readonly storage:ObjectStorage,readonly downloadTtlSeconds=300){ensure(Number.isInteger(downloadTtlSeconds)&&downloadTtlSeconds>0&&downloadTtlSeconds<=300,500,'INVALID_CONFIGURATION','下载有效期须在 1–300 秒内');}
 async active(c:Client,actor:Actor){
  if(actor.role!=='hospital'){await this.core.active(c,actor);return;}
  const r=(await c.query('SELECT u.active,u.role,u.auth_version,s.user_id,s.channel,s.expires_at,s.last_seen_at,s.revoked_at,s.issued_role,s.auth_version AS session_version FROM users u JOIN auth_sessions s ON s.user_id=u.id WHERE u.id=$1 AND s.id=$2 FOR SHARE OF u,s',[actor.id,actor.sessionId])).rows[0],now=this.core.clock();
  ensure(r?.active&&r.role==='hospital'&&actor.channel==='mini'&&r.channel==='mini'&&r.user_id===actor.id&&r.issued_role===actor.role&&r.auth_version===r.session_version&&!r.revoked_at&&r.expires_at>now&&now.getTime()-r.last_seen_at.getTime()<sessionIdleMs('mini'),401,'SESSION_EXPIRED','医院会话已失效');
 }
 async authorize(c:Client,actor:Actor,ref:SourceReference,write=false,stateChecks=true){
  await this.active(c,actor);
  if(ref.kind==='template'){if(actor.role!=='admin'||actor.channel!=='pc')throw missing();return {}; }
  if(ref.kind==='manufacturer'){
   if(actor.role==='hospital')throw missing();
   ensure(actor.role==='salesperson'||actor.role==='admin'&&actor.channel==='pc',403,'ROLE_FORBIDDEN','当前角色无厂家资料权限');
   const m=(await c.query('SELECT * FROM manufacturers WHERE id=$1 FOR SHARE',[ref.manufacturerId])).rows[0];if(!m)throw missing();if(write&&stateChecks)ensure(m.active,409,'MANUFACTURER_INACTIVE','厂家已停用');return m;
  }
  let root:any;
  if(actor.role==='hospital'){
   const found=(await c.query('SELECT hospital_id FROM purchase_orders WHERE id=$1',[ref.orderId])).rows[0];if(!found)throw missing();
   const hospital=(await c.query('SELECT id,active FROM hospitals WHERE id=$1 FOR SHARE',[found.hospital_id])).rows[0];if(!hospital?.active)throw missing();
   root=(await c.query(`SELECT o.*,r.id AS revision_id,r.status AS revision_status,COALESCE(to_jsonb(o)->>'entry_mode','normal') AS source_entry_mode FROM purchase_orders o JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no WHERE o.id=$1 ${write?'FOR UPDATE OF o':'FOR SHARE OF o'}`,[ref.orderId])).rows[0];
   const p=(await c.query('SELECT hospital_id FROM hospital_purchasers WHERE user_id=$1 AND active FOR SHARE',[actor.id])).rows[0];
   if(!root||root.source_entry_mode!=='normal'||ref.kind!=='purchase_revision'||root.purchaser_user_id!==actor.id||p?.hospital_id!==root.hospital_id)throw missing();
  }else{root=await this.core.root(c,actor,ref.orderId,write);root.source_entry_mode=(await c.query("SELECT COALESCE(to_jsonb(o)->>'entry_mode','normal') AS mode FROM purchase_orders o WHERE id=$1",[ref.orderId])).rows[0].mode;if(write&&root.submission_source==='hospital_self'&&!root.hospital_submitted_at)ensure(false,409,'HOSPITAL_DRAFT_NOT_SUBMITTED','医院草稿尚未提交，销售不能提前修改原资料');}
  if(ref.kind==='purchase_revision'){
   if(root.source_entry_mode!=='normal')throw missing();
   const r=(await c.query('SELECT * FROM purchase_order_revisions WHERE id=$1 AND purchase_order_id=$2',[ref.revisionId,ref.orderId])).rows[0];if(!r)throw missing();
   if(write&&stateChecks)ensure(ref.revisionId===root.revision_id&&r.status==='draft'&&!['completed','voided'].includes(root.status),409,'REVISION_READ_ONLY','仅当前草稿可上传或应用采购资料');
   if(write&&actor.role==='hospital')ensure(root.submission_source==='hospital_self',403,'ORDER_READ_ONLY','销售代录或旧采购单仅可查看，请由销售校对');
   if(write&&stateChecks&&actor.role==='hospital')ensure(root.status==='draft'&&!root.hospital_submitted_at,409,'ORDER_SUBMITTED','采购单已提交，请由销售校对');
  }else if(ref.kind==='historical_order'){
   if(root.source_entry_mode!=='historical_backfill')throw missing();
   if(write&&stateChecks)ensure(root.status!=='voided',409,'ORDER_VOIDED','作废单不可追加附件');
  }else{
   const payment=(await c.query('SELECT p.id,p.status FROM payment_records p JOIN receivables r ON r.id=p.receivable_id WHERE p.id=$1 AND r.purchase_order_id=$2 FOR SHARE OF p',[ref.paymentRecordId,ref.orderId])).rows[0];if(!payment)throw missing();
   if(write&&stateChecks)ensure(payment.status==='active',409,'PAYMENT_VOIDED','已作废回款不可追加凭证');
  }
  return root;
 }
 reference(row:any):SourceReference{
  switch(row.reference_kind){case 'template':return {kind:'template'};case 'purchase_revision':return {kind:'purchase_revision',orderId:row.order_id,revisionId:row.revision_id};case 'historical_order':return {kind:'historical_order',orderId:row.order_id};case 'payment_record':return {kind:'payment_record',orderId:row.order_id,paymentRecordId:row.payment_record_id};default:return {kind:'manufacturer',manufacturerId:row.manufacturer_id};}
 }
 dto(row:any):SourceFile{return {id:row.id,purpose:row.purpose,reference:this.reference(row),fileName:row.file_name,mimeType:row.mime_type,fileType:row.file_type,byteSize:row.byte_size,sha256:row.sha256,uploadedBy:row.uploaded_by,createdAt:new Date(row.created_at).toISOString(),parentFileId:row.parent_file_id};}
 async requireReference(c:Client,actor:Actor,fileId:string,expected?:SourceReference,write=false){
  z.uuid().parse(fileId);const row=(await c.query('SELECT * FROM source_files WHERE id=$1',[fileId])).rows[0];if(!row)throw missing();
  const ref=this.reference(row);if(expected&&stable(ref)!==stable(sourceReference.parse(expected)))throw missing();await this.authorize(c,actor,ref,write);return row;
 }
 /** Shared persistent idempotency, including hospital/admin file operations. Authorization is repeated before replay. */
 async mutate<T>(actor:Actor,key:string,operation:string,input:unknown,ref:SourceReference,action:(c:Client,root:any)=>Promise<T>):Promise<T>{
  z.uuid().parse(key);const hash=secretHash(stable({operation,input,ref}));
  return this.core.db.transaction(async c=>{
   const root=await this.authorize(c,actor,ref,true,false);
   await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['source-operation:'+actor.id+':'+key]);
   const old=(await c.query("SELECT * FROM operation_requests WHERE actor_type='user' AND actor_id=$1 AND idempotency_key=$2",[actor.id,key])).rows[0];
   if(old){ensure(old.content_hash===hash,409,'IDEMPOTENCY_KEY_REUSED','同一请求标识不能用于不同内容');return old.result;}
   await this.authorize(c,actor,ref,true);
   const result=await action(c,root);
   await c.query("INSERT INTO operation_requests(actor_type,actor_id,idempotency_key,operation,content_hash,result,created_at) VALUES('user',$1,$2,$3,$4,$5,$6)",[actor.id,key,operation,hash,JSON.stringify(result),this.core.clock()]);return result;
  });
 }
 async upload(actor:Actor,key:string,input:unknown):Promise<SourceFile>{
  const v=uploadSchema.parse(input);ensure(v.base64.length<=Math.ceil(MAX_BYTES/3)*4,413,'FILE_SIZE_LIMIT','单文件不超过 20MB');
  ensure(v.base64.length%4===0&&!/[^A-Za-z0-9+/=]/.test(v.base64),400,'INVALID_BASE64','文件编码无效');
  const bytes=Buffer.from(v.base64,'base64');ensure(bytes.toString('base64')===v.base64,400,'INVALID_BASE64','文件编码无效');const type=validateFile(v.fileName,v.mimeType,bytes),image=['png','jpg','jpeg'].includes(type);
  const allowed=v.reference.kind==='template'?'template_logo':v.reference.kind==='purchase_revision'?(image?'purchase_image':'purchase_excel'):v.reference.kind==='historical_order'?'historical_attachment':v.reference.kind==='payment_record'?'payment_proof':'manufacturer_source';
  ensure(v.purpose===allowed&&(v.reference.kind!=='manufacturer'||!image)&&(v.reference.kind!=='template'||image),400,'FILE_PURPOSE_MISMATCH','文件用途与业务对象或内容不符');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  return this.mutate(actor,key,'source-files.upload',{...v,base64:undefined,sha256,byteSize:bytes.length},v.reference,async(c)=>{
   if(v.parentFileId)await this.requireReference(c,actor,v.parentFileId,v.reference);
   if(v.purpose==='purchase_image'){const count=(await c.query("SELECT count(*)::int AS n FROM source_files WHERE order_id=$1 AND purpose='purchase_image'",[(v.reference as {orderId:string}).orderId])).rows[0].n;ensure(count<20,409,'IMAGE_LIMIT','每张采购单最多 20 张采购图片');}
   const id=randomUUID(),objectKey=`source-files/${id}/${sha256}.${type}`,ref=v.reference;
   await this.storage.put(objectKey,bytes,v.mimeType);
   const stored=await this.storage.read(objectKey);ensure(stored.length===bytes.length&&createHash('sha256').update(stored).digest('hex')===sha256,503,'STORAGE_INTEGRITY','私有文件存储校验失败，请核对后重试');
   const row=(await c.query('INSERT INTO source_files(id,purpose,reference_kind,order_id,revision_id,payment_record_id,manufacturer_id,file_name,mime_type,file_type,byte_size,sha256,object_key,uploaded_by,created_at,parent_file_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *',[id,v.purpose,ref.kind,'orderId' in ref?ref.orderId:null,ref.kind==='purchase_revision'?ref.revisionId:null,ref.kind==='payment_record'?ref.paymentRecordId:null,ref.kind==='manufacturer'?ref.manufacturerId:null,v.fileName,v.mimeType,type,bytes.length,sha256,objectKey,actor.id,this.core.clock(),v.parentFileId||null])).rows[0];
   await this.core.audit(c,'orderId' in ref?ref.orderId:null as any,actor.id,'source-files.upload',{fileId:id,purpose:v.purpose,sha256,byteSize:bytes.length});return this.dto(row);
  });
 }
 get(actor:Actor,fileId:string){return this.core.db.transaction(async c=>this.dto(await this.requireReference(c,actor,fileId)));}
 list(actor:Actor,input:unknown){const ref=sourceReference.parse(input);return this.core.db.transaction(async c=>{await this.authorize(c,actor,ref);const rows=ref.kind==='template'?await c.query("SELECT * FROM source_files WHERE reference_kind='template' ORDER BY created_at,id"):await c.query(`SELECT * FROM source_files WHERE reference_kind=$1 AND ${ref.kind==='manufacturer'?'manufacturer_id':ref.kind==='purchase_revision'?'revision_id':ref.kind==='payment_record'?'payment_record_id':'order_id'}=$2 ORDER BY created_at,id`,[ref.kind,ref.kind==='manufacturer'?ref.manufacturerId:ref.kind==='purchase_revision'?ref.revisionId:ref.kind==='payment_record'?ref.paymentRecordId:ref.orderId]);return {items:rows.rows.map(r=>this.dto(r))};});}
 async downloadGrant(actor:Actor,fileId:string):Promise<SourceDownloadGrant>{return this.core.db.transaction(async c=>{await this.requireReference(c,actor,fileId);const token=randomBytes(32).toString('base64url'),expires=new Date(this.core.clock().getTime()+this.downloadTtlSeconds*1000);await c.query('INSERT INTO source_download_grants(token_hash,file_id,user_id,session_id,expires_at) VALUES($1,$2,$3,$4,$5)',[secretHash(token),fileId,actor.id,actor.sessionId,expires]);return {token,downloadPath:`/files/${fileId}/content?token=${encodeURIComponent(token)}`,expiresAt:expires.toISOString()};});}
 async download(actor:Actor,fileId:string,token:string){
  ensure(typeof token==='string'&&token.length<=100,404,'NOT_FOUND','下载授权不存在或已失效');const row=await this.core.db.transaction(async c=>{const f=await this.requireReference(c,actor,fileId);const g=(await c.query('SELECT expires_at FROM source_download_grants WHERE token_hash=$1 AND file_id=$2 AND user_id=$3 AND session_id=$4',[secretHash(token),fileId,actor.id,actor.sessionId])).rows[0];if(!g||g.expires_at<=this.core.clock())throw missing();return f;});
  const bytes=await this.storage.read(row.object_key);ensure(bytes.length===row.byte_size&&createHash('sha256').update(bytes).digest('hex')===row.sha256,503,'STORAGE_INTEGRITY','原文件完整性校验失败');
  return {bytes,fileName:row.file_name as string,mimeType:row.mime_type as string};
 }
}
