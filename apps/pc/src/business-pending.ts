import {assertPurchaseReceipt} from '../../mini/src/domain';
import {assertHistoricalReceipt,historicalOperationTarget} from '../../../packages/historical-client/src';
import {assertFinanceReceipt,financeOperationTarget} from '../../../packages/finance-client/src';
export interface BusinessOperation {key:string;label:string;path:string;method:'POST'|'PUT'|'PATCH';body:Record<string,unknown>;metadata?:Record<string,unknown>;}
type Read=<T>(path:string)=>Promise<T>;
type Write=<T>(path:string,method:'POST'|'PUT'|'PATCH',body:unknown,key:string)=>Promise<T>;
interface Storage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
function assertReceipt(op:BusinessOperation,value:unknown){
 assertPurchaseReceipt(op,value);
 if(historicalOperationTarget(op)){assertHistoricalReceipt(op,value);return;}
 if(financeOperationTarget(op)||op.path==='/sales/receivable-reminders/subscriptions'){assertFinanceReceipt(op,value);return;}
 const r=value as Record<string,unknown>;if(!r||typeof r!=='object')throw new Error('业务回执无法核实，请保留原操作继续核对。');
 const order=op.path.match(/^\/sales\/purchase-orders\/([^/]+)/)?.[1];
 if(order&&r.id!==order&&r.orderId!==order)throw new Error('回执对应另一订单，请继续核对原操作。');
 if(op.path==='/sales/purchase-orders'&&(typeof r.id!=='string'||['hospitalId','purchaserUserId','receivedDate'].some(k=>r[k]!==op.body[k])))throw new Error('新建订单回执尚未核实。');
 const quote=op.path.match(/^\/quotes\/([^/]+)\/versions\/([^/]+)/);
 if(quote&&!(r.quoteId===quote[1]||r.versionId===quote[2]||r.id===quote[2]))throw new Error('报价回执尚未核实，请继续核对。');
}
export class BusinessOperations {
 pending:BusinessOperation|null=null;private storageKey:string;private receipt:{key:string;result:unknown}|null=null;
 constructor(userId:string,private read:Read,private write:Write,private storage:Storage,private key=()=>crypto.randomUUID()){
  this.storageKey='quote-pc-business-pending-'+userId;
  const raw=storage.getItem(this.storageKey);if(raw){try{const v=JSON.parse(raw);if(!v||typeof v.key!=='string'||!v.key||typeof v.label!=='string'||typeof v.path!=='string'||!v.path.startsWith('/')||!['POST','PUT','PATCH'].includes(v.method)||!v.body||typeof v.body!=='object'||Array.isArray(v.body)||v.metadata!==undefined&&(!v.metadata||typeof v.metadata!=='object'||Array.isArray(v.metadata)))throw new Error();this.pending=v;}catch{throw new Error('本机待核实业务资料损坏，请保留资料并联系维护人员。');}}
 }
 resultFor(key:string){return this.receipt?.key===key?this.receipt.result:undefined;}
 private clear(operation:BusinessOperation){const raw=this.storage.getItem(this.storageKey);if(raw){let current:any;try{current=JSON.parse(raw);}catch{throw new Error('本机待核实资料已变化，请刷新并保留原记录。');}if(current.key!==operation.key)throw new Error('其他标签页的待核实操作已变化，请刷新后核对。');}if(this.pending&&this.pending.key!==operation.key)throw new Error('待核实操作已变化，请刷新核对。');this.storage.removeItem(this.storageKey);this.pending=null;}
 async mutate<T>(label:string,path:string,method:BusinessOperation['method'],body:Record<string,unknown>,metadata?:Record<string,unknown>){if(this.pending)throw new Error('上次操作结果尚未核实，请先核对原操作。');const operation={key:this.key(),label,path,method,body:JSON.parse(JSON.stringify(body)),...(metadata?{metadata:JSON.parse(JSON.stringify(metadata))}:{})};this.storage.setItem(this.storageKey,JSON.stringify(operation));this.pending=operation;this.receipt=null;return this.retry<T>();}
 async check(){if(!this.pending)return 'none';const p=this.pending;const r=await this.read<{status:'committed'|'not_found';result?:unknown}>('/operations/'+encodeURIComponent(p.key));if(r.status==='committed'){assertReceipt(p,r.result);this.clear(p);this.receipt={key:p.key,result:r.result};}else if(r.status!=='not_found')throw new Error('操作状态无法确认，请继续核对。');return r.status;}
 async retry<T>():Promise<T>{const p=this.pending;if(!p)throw new Error('没有待核实操作。');try{const r=await this.write<T>(p.path,p.method,p.body,p.key);assertReceipt(p,r);this.clear(p);this.receipt={key:p.key,result:r};return r;}catch(e){const v=e as {status?:number;code?:string};if(v.status!==undefined&&v.status>=400&&v.status<500&&![401,403,404,408,410].includes(v.status)&&!['REQUEST_TIMEOUT','RESPONSE_UNKNOWN','BUSY_RETRY_REQUIRED'].includes(v.code||''))this.clear(p);throw e;}}
}
