import type {SourceFile,SourceReference,SourcePurpose,SourceUploadInput,ParsingJob,ParsePreview,SpreadsheetFieldMapping} from '../../contracts/src/source-files';
export type {SourceFile,SourceReference,SourcePurpose,ParsingJob,ParsePreview,SpreadsheetFieldMapping};
export interface DescriptorStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
export interface AssetStore<T=unknown> {put(id:string,input:T):Promise<void>;read(id:string):Promise<string>;remove(id:string):Promise<void>;}
export interface PendingSource {version:1;userId:string;key:string;reference:SourceReference;action:'upload'|'parse'|'retry'|'apply';path:string;body:Record<string,unknown>;assetId?:string;fileId?:string;jobId?:string;}
export const sourceStorageKey=(userId:string)=>'quote-source-pending-v1:'+userId;
export const sameReference=(a:SourceReference,b:SourceReference)=>JSON.stringify(orderedRef(a))===JSON.stringify(orderedRef(b));
function orderedRef(r:SourceReference){switch(r.kind){case 'purchase_revision':return [r.kind,r.orderId,r.revisionId];case 'payment_record':return [r.kind,r.orderId,r.paymentRecordId];case 'historical_order':return [r.kind,r.orderId];case 'manufacturer':return [r.kind,r.manufacturerId];case 'template':return [r.kind];default:throw new Error('原业务对象资料无效。');}}
export function sourceOperationTarget(p:PendingSource|null){return p?.reference||null;}
export function readSourcePending(userId:string,storage:DescriptorStorage):PendingSource|null{const raw=storage.getItem(sourceStorageKey(userId));if(!raw)return null;try{const p=JSON.parse(raw) as PendingSource;if(p.version!==1||p.userId!==userId||!p.key||!p.reference||!p.body||typeof p.body!=='object'||'base64' in p.body||!['upload','parse','retry','apply'].includes(p.action)||!p.path.startsWith('/'))throw new Error();orderedRef(p.reference);if(p.action==='upload'&&(p.path!=='/files/upload'||!p.assetId))throw new Error();if(p.action!=='upload'&&!/^\/parsing\/jobs(?:\/[^/]+\/(retry|apply-lines))?$/.test(p.path))throw new Error();return p;}catch{throw new Error('原单待核实资料损坏，请保留本机资料并联系维护人员。');}}
export function purposeFor(r:SourceReference,image:boolean):SourcePurpose{return r.kind==='purchase_revision'?(image?'purchase_image':'purchase_excel'):r.kind==='historical_order'?'historical_attachment':r.kind==='payment_record'?'payment_proof':r.kind==='manufacturer'?'manufacturer_source':'template_logo';}
export function fileMeta(name:string,size:number,reference:SourceReference){const ext=name.split('.').pop()?.toLowerCase(),mime=ext==='png'?'image/png':ext==='jpg'||ext==='jpeg'?'image/jpeg':ext==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':ext==='xls'?'application/vnd.ms-excel':ext==='csv'?'text/csv':null;if(!mime||/[\x00-\x1f/\\]/.test(name)||name.length>200||name.trim()!==name)throw new Error('请选择 jpg、png、xlsx、xls 或 csv 文件，文件名不超过 200 字。');if(!Number.isInteger(size)||size<=0||size>20*1024*1024)throw new Error('单文件须大于 0 且不超过 20MB。');const image=ext==='png'||ext==='jpg'||ext==='jpeg';if(reference.kind==='manufacturer'&&image)throw new Error('厂家来源仅支持 xlsx、xls、csv。');if(reference.kind==='template'&&!image)throw new Error('模板标志仅支持 jpg、png 图片。');return {name,mime,size,purpose:purposeFor(reference,image)};}
export function assertSourceReceipt(p:PendingSource,result:unknown){const r=result as Record<string,any>|null;const bad=()=>{throw new Error('原单操作回执与原业务对象不一致，请保留原请求继续核对。');};if(!r||typeof r!=='object')return bad();if(p.action==='upload'){if(typeof r.id!=='string'||!r.id||!r.reference||!sameReference(p.reference,r.reference)||r.fileName!==p.body.fileName||r.mimeType!==p.body.mimeType||r.purpose!==p.body.purpose||r.byteSize!==p.body.byteSize||r.uploadedBy!==p.userId)return bad();}else if(p.action==='apply'){if(!('orderId' in p.reference)||r.orderId!==p.reference.orderId||r.jobId!==p.jobId||!Array.isArray(r.lineIds)||!r.lineIds.length||r.lineIds.some((id:unknown)=>typeof id!=='string')||!Number.isInteger(r.rowVersion))return bad();}else if(typeof r.id!=='string'||!r.id||r.fileId!==p.fileId||(p.jobId&&r.id!==p.jobId)||!['pending','processing','succeeded','failed'].includes(r.status))return bad();}
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
/** The descriptor is small; file bytes live in IndexedDB or USER_DATA_PATH, never string storage. */
export class SourceOperations<T=unknown>{
 pending:PendingSource|null;lastResult:unknown=null;private working=false;private invalidated=false;
 constructor(readonly userId:string,private read:<R>(path:string)=>Promise<R>,private write:<R>(path:string,body:unknown,key:string)=>Promise<R>,private storage:DescriptorStorage,private assets:AssetStore<T>,private key:()=>string=()=>crypto.randomUUID(),private isCurrent:()=>boolean=()=>true){this.pending=readSourcePending(userId,storage);}
 invalidate(){this.invalidated=true;}
 private current(){if(this.invalidated||!this.isCurrent())throw Object.assign(new Error('页面或登录会话已变化，原文件操作保留在原账号，请重新进入后核对。'),{code:'SOURCE_SCOPE_CHANGED'});}
 private latest(){this.current();const stored=readSourcePending(this.userId,this.storage);if(stored?.key!==this.pending?.key)throw new Error('本机原单待核实操作已变化，请刷新后核对。');return stored;}
 private remember(p:PendingSource){if(readSourcePending(this.userId,this.storage))throw new Error('上次原单操作结果待核实，请先处理原请求。');this.storage.setItem(sourceStorageKey(this.userId),JSON.stringify(p));this.pending=p;}
 private async clear(p:PendingSource){this.current();if(this.pending?.key!==p.key)return;this.latest();this.storage.removeItem(sourceStorageKey(this.userId));this.pending=null;if(p.assetId){try{await this.assets.remove(p.assetId);}catch{/* A committed result remains known even when local byte cleanup fails. */}this.current();}}
 async upload(reference:SourceReference,meta:{name:string;mime:string;size:number},asset:T,parentFileId?:string){
  this.current();if(this.pending||this.working)throw new Error('上次原单操作待核实，请先处理。');
  const valid=fileMeta(meta.name,meta.size,reference),key=this.key(),assetId='source-'+key;
  const p:PendingSource={version:1,userId:this.userId,key,reference:clone(reference),action:'upload',path:'/files/upload',assetId,body:{reference:clone(reference),purpose:valid.purpose,fileName:valid.name,mimeType:valid.mime,byteSize:valid.size,...(parentFileId?{parentFileId}:{})}};
  await this.assets.put(assetId,asset);
  try{this.current();}catch(e){
   // Bytes may finish persisting after navigation. Retain recovery metadata only in the captured user's namespace; never dispatch or delete them here.
   try{this.remember(p);}catch{/* Keep the original bytes if the descriptor cannot be persisted. */}throw e;
  }
  try{this.remember(p);}catch(e){this.current();await this.assets.remove(assetId).catch(()=>{});this.current();throw new Error('文件未能保存到本机，未发起上传。'+(e instanceof Error?e.message:''));}
  const result=await this.retry(p.reference);this.current();return result;
 }
 async mutate(reference:SourceReference,action:'parse'|'retry'|'apply',path:string,body:Record<string,unknown>,target:{fileId:string;jobId?:string}){this.current();if(this.pending||this.working)throw new Error('上次原单操作待核实，请先处理。');this.remember({version:1,userId:this.userId,key:this.key(),reference:clone(reference),action,path,body:clone(body),...target});const result=await this.retry(reference);this.current();return result;}
 async check(){
  this.current();if(this.working)throw new Error('正在核对原单操作。');const p=this.latest();if(!p)return 'none';this.working=true;
  try{this.current();const r=await this.read<{status:'committed'|'not_found';result?:unknown}>('/operations/'+encodeURIComponent(p.key));this.current();if(r.status==='committed'){assertSourceReceipt(p,r.result);this.lastResult=r.result;await this.clear(p);this.current();}else if(r.status!=='not_found')throw new Error('操作结果无法确认，请保留原请求继续核对。');return r.status;}finally{this.working=false;}
 }
 async retry(reference:SourceReference):Promise<unknown>{
  this.current();if(this.working)throw new Error('正在提交原单操作，请稍候。');const p=this.latest();if(!p)throw new Error('没有待核实的原单操作。');if(!sameReference(p.reference,reference))throw new Error('请返回原业务对象核对，不可将待核实文件提交到其他订单。');this.working=true;
  try{let body={...p.body};if(p.action==='upload'){this.current();const base64=await this.assets.read(p.assetId!);this.current();if(typeof base64!=='string'||!base64.length)throw new Error('本机原文件已不可读取，请保留待核实记录并联系维护人员。');delete body.byteSize;body={...body,base64};}this.current();const result=await this.write(p.path,body,p.key);this.current();assertSourceReceipt(p,result);this.lastResult=result;await this.clear(p);this.current();return result;
  }catch(e){this.current();const v=e as {status?:number;code?:string};if(v.status&&v.status>=400&&v.status<500&&![401,403,404,408,410].includes(v.status)&&!['RESPONSE_UNKNOWN','REQUEST_TIMEOUT','BUSY_RETRY_REQUIRED'].includes(v.code||'')){await this.clear(p);this.current();}throw e;}finally{this.working=false;}
 }
}
export function resolveSourceDownload(value:string,apiBase:string){const base=new URL(apiBase),url=new URL(value,base);if(url.origin!==base.origin||url.username||url.password||!url.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/files/')||!/^\/files\/[^/]+\/content$/.test(url.pathname.slice(base.pathname.replace(/\/$/,'').length))||!url.searchParams.get('token'))throw new Error('下载地址与当前服务不一致，已停止下载。');return url.href;}
export const defaultMapping=():SpreadsheetFieldMapping=>({headerRow:1,columns:{name:0,quantity:1,spec:2}});

export {formatBeijingTimestamp} from './timestamp';
