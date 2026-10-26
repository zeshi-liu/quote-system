import type { QuoteDocument,ExportFormat } from '../../../../packages/contracts/src';
import { CoreStore,type Client } from '../core/store';
import { assertUsable,cancelAttempt,deliveryRoot } from './domain';
import { BusinessError } from '../core/errors';
import {resolveQuoteLogo} from './template';
import type {ObjectStorage} from './storage';
export interface WorkerClaim {jobId:string;exportId:string;versionId:string;generation:number;document:QuoteDocument;format:ExportFormat;objectKey:string;deadline:string;}
export interface BoundFile {objectKey:string;filename:string;sha256:string;size:number;contentType:string;}
const objectKey=(jobId:string,generation:number,format:string)=>`exports/${jobId}/${generation}/quote.${format}`;
export class ExportStore {
 constructor(readonly store:CoreStore){}
 resolveLogo(document:QuoteDocument,storage:ObjectStorage){return resolveQuoteLogo(this.store.db,storage,document);}
 private async load(c:Client,jobId:string){return (await c.query('SELECT j.*,a.version_id,a.order_id,a.revision_id,a.generation AS export_generation,a.input_version,a.document,a.basis_evidence,a.snapshot_hash,a.format,a.deadline,a.created_at AS prepared_at,a.state AS export_state FROM export_jobs j JOIN quote_export_attempts a ON a.id=j.export_id WHERE j.id=$1',[jobId])).rows[0];}
 private async valid(c:Client,j:any,r:any,now:Date){
  const v=(await c.query('SELECT * FROM quote_versions WHERE id=$1',[j.version_id])).rows[0];
  if(!r||!v||v.active_export_id!==j.export_id||v.export_generation!==j.export_generation||v.row_version!==j.input_version||j.deadline<=now)return null;
  try{await assertUsable(c,r,v,j.document,j.basis_evidence,now);return v;}catch(error){if(error instanceof BusinessError)return null;throw error;}
 }
 private async retry(c:Client,j:any,message:string,retryable:boolean,now:Date){
  const delay=(j.attempts===1?30000:120000)+Math.floor(Math.random()*5000),retryAt=new Date(now.getTime()+delay);
  if(retryable&&j.attempts<3&&retryAt<j.deadline){await c.query("UPDATE export_jobs SET state='queued',error=$2,retry_at=$3,lease_until=NULL WHERE id=$1",[j.id,message,retryAt]);}
  else await cancelAttempt(c,j.export_id,message);
 }
 async recover(){await this.store.db.transaction(async c=>{
  await c.query('SELECT pg_advisory_xact_lock(790124)');
  const jobs=(await c.query("SELECT j.id,a.order_id FROM export_jobs j JOIN quote_export_attempts a ON a.id=j.export_id WHERE j.state IN('queued','running') ORDER BY a.order_id,j.id")).rows;
  for(const ref of jobs){const r=await deliveryRoot(this.store,c,ref.order_id),j=await this.load(c,ref.id),now=this.store.clock();if(!['queued','running'].includes(j.state))continue;
   if(!await this.valid(c,j,r,now)){await cancelAttempt(c,j.export_id,'导出依据、占用或截止时间已变化');continue;}
   if(j.state==='running'&&j.lease_until<=now)await this.retry(c,j,'执行租约超时',true,now);
  }
 });}
 async claim():Promise<WorkerClaim|null>{
  await this.recover();return this.store.db.transaction(async c=>{
   await c.query('SELECT pg_advisory_xact_lock(790124)');const now=this.store.clock();
   if((await c.query("SELECT id FROM export_jobs WHERE state='running' AND lease_until>$1 LIMIT 1",[now])).rowCount)return null;
   const ref=(await c.query("SELECT j.id,a.order_id FROM export_jobs j JOIN quote_export_attempts a ON a.id=j.export_id WHERE j.state='queued' AND j.retry_at<=$1 ORDER BY j.created_at,j.id LIMIT 1",[now])).rows[0];if(!ref)return null;
   const r=await deliveryRoot(this.store,c,ref.order_id),j=await this.load(c,ref.id),claimedAt=this.store.clock();if(j.state!=='queued'||!await this.valid(c,j,r,claimedAt)){await cancelAttempt(c,j.export_id,'导出已取消或依据已变化');return null;}
   const generation=j.claim_generation+1;await c.query("UPDATE export_jobs SET state='running',attempts=attempts+1,claim_generation=$2,lease_until=$3 WHERE id=$1",[j.id,generation,new Date(Math.min(claimedAt.getTime()+300000,j.deadline.getTime()))]);
   return {jobId:j.id,exportId:j.export_id,versionId:j.version_id,generation,document:j.document,format:j.format,objectKey:objectKey(j.id,generation,j.format),deadline:j.deadline.toISOString()};
  });
 }
 private matches(j:any,claim:WorkerClaim,now:Date){return j&&j.state==='running'&&j.export_state==='pending'&&j.claim_generation===claim.generation&&j.export_id===claim.exportId&&j.version_id===claim.versionId&&j.lease_until>now;}
 async finish(claim:WorkerClaim,file:BoundFile):Promise<void>{await this.store.db.transaction(async c=>{
  const ref=await this.load(c,claim.jobId);if(!ref)return;const r=await deliveryRoot(this.store,c,ref.order_id),j=await this.load(c,claim.jobId),now=this.store.clock();if(!this.matches(j,claim,now))return;
  const v=await this.valid(c,j,r,now);if(!v){await cancelAttempt(c,j.export_id,'导出完成时依据、占用或截止已失效');return;}
  if(file.objectKey!==objectKey(j.id,j.claim_generation,j.format)||!/^[a-f0-9]{64}$/.test(file.sha256)||!Number.isSafeInteger(file.size)||file.size<=0||file.size>20*1024*1024)throw new Error('导出文件元数据不合法');
  const bound=(await c.query('INSERT INTO quote_files(export_id,version_id,object_key,filename,sha256,size,content_type,format,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',[j.export_id,j.version_id,file.objectKey,file.filename,file.sha256,file.size,file.contentType,j.format,now])).rows[0];
  await c.query("UPDATE quote_export_attempts SET state='succeeded' WHERE id=$1",[j.export_id]);await c.query("UPDATE export_jobs SET state='succeeded',file_id=$2,error=NULL,lease_until=NULL WHERE id=$1",[j.id,bound.id]);
  if(!v.first_exported_at){await c.query("UPDATE quote_versions SET document=$2,basis_evidence=$3,snapshot_hash=$4,first_exported_at=$5,status='exported',active_export_id=NULL,row_version=row_version+1 WHERE id=$1",[v.id,JSON.stringify(j.document),JSON.stringify(j.basis_evidence),j.snapshot_hash,now]);await c.query("UPDATE purchase_orders SET status='quote_exported',row_version=row_version+1 WHERE id=$1",[j.order_id]);}
  else await c.query('UPDATE quote_versions SET active_export_id=NULL WHERE id=$1',[v.id]);
  await this.store.audit(c,j.order_id,r.sales_user_id,'delivery.export-bound',{versionId:v.id,exportId:j.export_id,fileId:bound.id,snapshotHash:j.snapshot_hash});
 });}
 async fail(claim:WorkerClaim,message:string,retryable:boolean):Promise<void>{await this.store.db.transaction(async c=>{const ref=await this.load(c,claim.jobId);if(!ref)return;const r=await deliveryRoot(this.store,c,ref.order_id),j=await this.load(c,claim.jobId),now=this.store.clock();if(!this.matches(j,claim,now))return;if(!await this.valid(c,j,r,now))await cancelAttempt(c,j.export_id,'导出已取消或依据已变化');else await this.retry(c,j,message.slice(0,500),retryable,now);});}
}
