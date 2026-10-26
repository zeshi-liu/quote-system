import {assertPaymentReceipt,receivableOperationTarget} from '@quote/receivables-client';
import {assertHistoricalReceipt,historicalOperationTarget} from '../../../packages/historical-client/src';
import {assertHospitalReceipt} from './hospital-domain';
import {assertPurchaseReceipt} from './domain';
import {assertFinanceReceipt,financeOperationTarget} from '../../../packages/finance-client/src';
import { computed, ref } from 'vue';
import { exportJobStorageKey, resolveDownloadUrl } from './delivery-domain';
import type { Session } from '@quote/contracts';
import { exportVersionForOperation, recordOperation, replayDescriptor, retainPending, type StoredOperation } from './pending';
const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/,'');
export const session = ref<Session|null>(uni.getStorageSync('quote-session')||null);
const pendingStorageKey=(id:string)=>'quote-pending-'+id;
export const pending = ref<StoredOperation|null>(session.value?uni.getStorageSync(pendingStorageKey(session.value.user.id))||null:null);
const activeRequests=ref(0);
export const operationInFlight=computed(()=>activeRequests.value>0);
const hospitalReceipts=new Map<string,{id:string}>();
export function hospitalResultForOperation(operation:StoredOperation|null){return operation&&session.value?hospitalReceipts.get(session.value.user.id+':'+operation.key):undefined;}
function assertRecoveryIdle(){if(operationInFlight.value)throw new ApiFailure('OPERATION_IN_FLIGHT','请求正在进行，请等待响应后再核对或重试。');}
export const canRetry=computed(()=>replayDescriptor(pending.value)!==null);
export class ApiFailure extends Error { constructor(public code:string,message:string,public unknown=false,public status?:number){super(message);} }
function uuid(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);}); }
export function setSession(value:Session|null){if(value?.user.id!==session.value?.user.id)pending.value=value?uni.getStorageSync(pendingStorageKey(value.user.id))||null:null;session.value=value; value?uni.setStorageSync('quote-session',value):uni.removeStorageSync('quote-session');}
function pendingScope(){return {userId:session.value?.user.id,token:session.value?.token,key:pending.value?.key};}
function assertScope(scope:ReturnType<typeof pendingScope>){if(!scope.userId||session.value?.user.id!==scope.userId||session.value?.token!==scope.token||pending.value?.key!==scope.key)throw new ApiFailure('SESSION_CHANGED','登录账号或会话已变化，原操作仍保留，请在原账号重新核对。',true);}
function clearPending(scope:ReturnType<typeof pendingScope>){assertScope(scope);uni.removeStorageSync(pendingStorageKey(scope.userId!));pending.value=null;}
export function request<T>(path:string,method:'GET'|'POST'|'PUT'='GET',data?:Record<string,unknown>,key?:string):Promise<T>{
 activeRequests.value++;
 return new Promise<T>((resolve,reject)=>uni.request({url:base+path,method,data,timeout:20000,header:{'Content-Type':'application/json',...(session.value?{Authorization:'Bearer '+session.value.token}:{}),...(key?{'Idempotency-Key':key}:{})},success(res){const validBody=typeof res.data==='object'&&res.data!==null;const body=(validBody?res.data:{}) as {data:T;error?:{code:string;message:string}};if(res.statusCode>=200&&res.statusCode<300){if(validBody&&'data' in body)resolve(body.data);else reject(new ApiFailure('RESPONSE_UNKNOWN','服务响应无法确认，请先核对本次操作结果。',true));}else{const unknown=res.statusCode>=500||res.statusCode===408||body.error?.code==='BUSY_RETRY_REQUIRED';reject(new ApiFailure(body.error?.code||'HTTP_'+res.statusCode,unknown?'服务响应异常，请先核对本次操作结果。':body.error?.message||'请求失败，请重试',unknown,res.statusCode));}},fail(){reject(new ApiFailure('NETWORK_UNKNOWN','网络连接中断，请先核对本次操作结果。',true));}})).finally(()=>{activeRequests.value--;});
}
export async function mutate<T>(label:string,path:string,method:'POST'|'PUT',data:Record<string,unknown>):Promise<T>{
 if(pending.value)throw new ApiFailure('PENDING_OPERATION','上次操作结果尚未核实，请先核对。');
 if(!session.value)throw new ApiFailure('UNAUTHENTICATED','请先登录再提交业务操作。',false,401);
 const operation=recordOperation(uuid(),label,path,method,data);uni.setStorageSync(pendingStorageKey(session.value.user.id),operation);pending.value=operation;
 return retryOperation<T>();
}
function rememberOperationResult(operation:StoredOperation|null,result:unknown){
 if(operation){try{assertPurchaseReceipt(operation,result);}catch{throw new ApiFailure('PURCHASE_RECEIPT_UNKNOWN','采购操作回执尚未核实，请保留原操作继续核对。',true);}}
 if(operation&&historicalOperationTarget(operation)){try{assertHistoricalReceipt(operation,result);}catch{throw new ApiFailure('HISTORICAL_RECEIPT_UNKNOWN','历史补录回执尚未核实，请保留原操作继续核对。',true);}return;}
 if(operation&&operation.path?.startsWith('/hospital/purchase-orders')){const id=operation.path.match(/^\/hospital\/purchase-orders\/([^/]+)/)?.[1];try{assertHospitalReceipt(result,operation.path.endsWith('/submit')?'submit':id?'save':'create',id);hospitalReceipts.set(session.value!.user.id+':'+operation.key,{id:(result as {id:string}).id});}catch{throw new ApiFailure('HOSPITAL_RECEIPT_UNKNOWN','采购需求回执尚未核实，请保留原操作继续核对。',true);}return;}
 if(operation&&(financeOperationTarget(operation)||operation.path==='/sales/receivable-reminders/subscriptions')){try{assertFinanceReceipt(operation,result);}catch{throw new ApiFailure('FINANCE_RECEIPT_UNKNOWN','财务操作回执尚未核实，请保留原请求继续核对。',true);}return;}
 if(receivableOperationTarget(operation)){try{assertPaymentReceipt(operation!,result);}catch{throw new ApiFailure('PAYMENT_RECEIPT_UNKNOWN','回款回执尚未核实，请保留原操作继续核对。',true);}return;}
 const versionId=exportVersionForOperation(operation);if(!versionId)return;
 const receipt=result as {orderId?:unknown;versionId?:unknown;jobId?:unknown}|null;
 if(!receipt||receipt.versionId!==versionId||typeof receipt.orderId!=='string'||!receipt.orderId.trim()||typeof receipt.jobId!=='string'||!receipt.jobId.trim())throw new ApiFailure('EXPORT_RECEIPT_UNKNOWN','导出已受理但任务回执尚未核实，请保留原操作继续核对。',true);
 uni.setStorageSync(exportJobStorageKey(receipt.orderId,versionId),receipt.jobId);
}
export async function checkOperation(){assertRecoveryIdle();if(!pending.value)return 'none';const operation=pending.value,scope=pendingScope();const r=await request<{status:'committed'|'not_found';result?:unknown}>('/operations/'+operation.key);assertScope(scope);if(r.status==='committed'){rememberOperationResult(operation,r.result);clearPending(scope);}else if(r.status!=='not_found')throw new ApiFailure('RESPONSE_UNKNOWN','操作状态尚未核实，请保留原操作。',true);return r.status;}
export async function retryOperation<T=unknown>(){assertRecoveryIdle();const original=pending.value,scope=pendingScope();const operation=replayDescriptor(original);if(!operation)throw new ApiFailure('RETRY_UNAVAILABLE','旧操作缺少原请求内容，请继续核对结果并联系维护人员核实。',true);try{const result=await request<T>(operation.path,operation.method,operation.data,operation.key);assertScope(scope);rememberOperationResult(original,result);clearPending(scope);return result;}catch(e){assertScope(scope);if(e instanceof ApiFailure&&!retainPending(e.status,e.unknown))clearPending(scope);throw e;}}

/** A short-lived read authorization is not an idempotent business mutation. */
export async function downloadFile(id:string,format:'pdf'|'xlsx',filename:string):Promise<void>{
 const ticket=await request<{url:string;expiresAt:string}>('/files/'+id+'/download-url','POST',{});
 const url=resolveDownloadUrl(ticket.url,base);
 // #ifdef H5
 const response=await fetch(url);
 if(!response.ok)throw new ApiFailure('DOWNLOAD_FAILED','文件下载失败，请重新获取下载凭证。',false,response.status);
 const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),link=document.createElement('a');
 link.href=objectUrl;link.download=filename;link.rel='noopener';document.body.appendChild(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(objectUrl),60000);
 return;
 // #endif
 // #ifndef H5
 await new Promise<void>((resolve,reject)=>uni.downloadFile({url,success(result){
  if(result.statusCode!==200){reject(new ApiFailure('DOWNLOAD_FAILED','文件下载失败，请重试。',false,result.statusCode));return;}
  uni.openDocument({filePath:result.tempFilePath,fileType:format,showMenu:true,success:()=>resolve(),fail:()=>reject(new Error('文件已下载但无法打开，请重试或在浏览器下载。'))});
 },fail:()=>reject(new Error('文件下载中断，请重新获取文件。'))}));
 // #endif
}
