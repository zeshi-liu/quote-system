export interface PaymentOperation {key:string;label:string;path:string;method:'POST';body:Record<string,unknown>;}
export interface OperationStorage {getItem(key:string):string|null;setItem(key:string,value:string):void;removeItem(key:string):void;}
type Read=<T>(path:string)=>Promise<T>;
type Write=<T>(path:string,body:unknown,key:string)=>Promise<T>;
export function receivableOperationTarget(operation:{path?:string;method?:string}|null):string|null{if(operation?.method!=='POST')return null;const id=operation.path?.match(/^\/sales\/receivables\/([^/]+)\/payments(?:\/[^/]+\/void)?$/)?.[1];if(!id)return null;try{return decodeURIComponent(id);}catch{return null;}}
function keepOperation(e:unknown){const error=e as {status?:number;code?:string};return error?.status===undefined||error.status>=500||[401,403,404,408,410].includes(error.status)||['RESPONSE_UNKNOWN','BUSY_RETRY_REQUIRED','REQUEST_TIMEOUT'].includes(error.code||'');}
interface ReceiptOperation {path?:string;method?:string;body?:Record<string,unknown>;data?:Record<string,unknown>;}
interface Receipt {orderId?:unknown;receivable?:{id?:unknown;orderId?:unknown};payment?:{id?:unknown;receivableId?:unknown;status?:unknown;amount?:unknown;paidDate?:unknown;remark?:unknown;correctsPaymentRecordId?:unknown;voidReason?:unknown};}
function normalizedAmount(value:unknown):string|null{if(typeof value!=='string'||!/^(0|[1-9]\d{0,9})(?:\.\d{1,2})?$/.test(value))return null;const [whole,part='']=value.split('.');return whole+'.'+part.padEnd(2,'0');}
/** Only a receipt for the original request can clear its durable idempotency key. */
export function assertPaymentReceipt(operation:ReceiptOperation,value:unknown){
 const target=receivableOperationTarget(operation),r=value as Receipt,body=operation.body||operation.data;
 const reject=()=>{throw new Error('回款回执尚未核实，请保留原操作继续核对。');};
 if(!target||!r||!body||typeof r.orderId!=='string'||!r.orderId.trim()||r.receivable?.id!==target||r.receivable.orderId!==r.orderId||typeof r.payment?.id!=='string'||!r.payment.id.trim()||r.payment.receivableId!==target)return reject();
 const p=r.payment,voidPart=operation.path?.match(/\/payments\/([^/]+)\/void$/)?.[1];
 if(voidPart){let id:string;try{id=decodeURIComponent(voidPart);}catch{return reject();}if(p.id!==id||p.status!=='void'||typeof body.reason!=='string'||!body.reason.trim()||p.voidReason!==body.reason.trim())return reject();return;}
 const amount=normalizedAmount(body.amount),source=body.correctsPaymentRecordId===undefined?null:body.correctsPaymentRecordId;
 if(p.status!=='active'||amount===null||amount==='0.00'||normalizedAmount(p.amount)!==amount||p.paidDate!==body.paidDate||!(typeof body.paidDate==='string'||body.paidDate===null)||p.correctsPaymentRecordId!==source||!(source===null||typeof source==='string'&&source.trim())||!(body.remark===undefined||typeof body.remark==='string')||p.remark!==(typeof body.remark==='string'?body.remark.trim():''))return reject();
}
export class PaymentOperations {
 pending:PaymentOperation|null=null;
 private storageKey:string;
 constructor(userId:string,private read:Read,private write:Write,private storage:OperationStorage,private key=()=>crypto.randomUUID()){
  this.storageKey='quote-pc-payment-pending-'+userId;
  const saved=storage.getItem(this.storageKey);if(saved){try{const p=JSON.parse(saved);if(typeof p.key==='string'&&p.key&&typeof p.label==='string'&&receivableOperationTarget(p)&&p.body&&typeof p.body==='object'&&!Array.isArray(p.body))this.pending=p;else throw new Error();}catch{throw new Error('本机待核对回款资料无法读取，请保留资料并联系维护人员。');}}
 }
 private clear(){this.storage.removeItem(this.storageKey);this.pending=null;}
 async mutate<T>(label:string,path:string,body:Record<string,unknown>):Promise<T>{if(this.pending)throw new Error('上次回款结果尚未核对，请先核对原操作。');const operation:PaymentOperation={key:this.key(),label,path,method:'POST',body:JSON.parse(JSON.stringify(body))};if(!receivableOperationTarget(operation))throw new Error('无效回款操作。');this.storage.setItem(this.storageKey,JSON.stringify(operation));this.pending=operation;return this.retry<T>();}
 async check(){const operation=this.pending;if(!operation)return 'none';const read=this.read,r=await read<{status:'committed'|'not_found';result?:unknown}>('/operations/'+encodeURIComponent(operation.key));if(r.status==='committed'){assertPaymentReceipt(operation,r.result);this.clear();}else if(r.status!=='not_found')throw new Error('回款操作结果无法确认，请继续核对。');return r.status;}
 async retry<T=unknown>():Promise<T>{const operation=this.pending;if(!operation)throw new Error('没有可核对的原回款操作。');try{const write=this.write,r=await write<T>(operation.path,operation.body,operation.key);assertPaymentReceipt(operation,r);this.clear();return r;}catch(e){if(!keepOperation(e))this.clear();throw e;}}
}
