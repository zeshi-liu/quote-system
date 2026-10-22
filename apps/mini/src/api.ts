import { computed, ref } from 'vue';
import type { Session } from '@quote/contracts';
import { recordOperation, replayDescriptor, retainPending, type StoredOperation } from './pending';
const base = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/,'');
export const session = ref<Session|null>(uni.getStorageSync('quote-session')||null);
const pendingStorageKey=(id:string)=>'quote-pending-'+id;
export const pending = ref<StoredOperation|null>(session.value?uni.getStorageSync(pendingStorageKey(session.value.user.id))||null:null);
export const canRetry=computed(()=>replayDescriptor(pending.value)!==null);
export class ApiFailure extends Error { constructor(public code:string,message:string,public unknown=false,public status?:number){super(message);} }
function uuid(){ return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.floor(Math.random()*16);return (c==='x'?r:(r&3)|8).toString(16);}); }
export function setSession(value:Session|null){if(value?.user.id!==session.value?.user.id)pending.value=value?uni.getStorageSync(pendingStorageKey(value.user.id))||null:null;session.value=value; value?uni.setStorageSync('quote-session',value):uni.removeStorageSync('quote-session');}
function clearPending(){pending.value=null;if(session.value)uni.removeStorageSync(pendingStorageKey(session.value.user.id));}
export function request<T>(path:string,method:'GET'|'POST'|'PUT'='GET',data?:Record<string,unknown>,key?:string):Promise<T>{
 return new Promise((resolve,reject)=>uni.request({url:base+path,method,data,timeout:20000,header:{'Content-Type':'application/json',...(session.value?{Authorization:'Bearer '+session.value.token}:{}),...(key?{'Idempotency-Key':key}:{})},success(res){const validBody=typeof res.data==='object'&&res.data!==null;const body=(validBody?res.data:{}) as {data:T;error?:{code:string;message:string}};if(res.statusCode>=200&&res.statusCode<300){if(validBody&&'data' in body)resolve(body.data);else reject(new ApiFailure('RESPONSE_UNKNOWN','服务响应无法确认，请先核对本次操作结果。',true));}else{const unknown=res.statusCode>=500||res.statusCode===408||body.error?.code==='BUSY_RETRY_REQUIRED';reject(new ApiFailure(body.error?.code||'HTTP_'+res.statusCode,unknown?'服务响应异常，请先核对本次操作结果。':body.error?.message||'请求失败，请重试',unknown,res.statusCode));}},fail(){reject(new ApiFailure('NETWORK_UNKNOWN','网络连接中断，请先核对本次操作结果。',true));}}));
}
export async function mutate<T>(label:string,path:string,method:'POST'|'PUT',data:Record<string,unknown>):Promise<T>{
 if(pending.value)throw new ApiFailure('PENDING_OPERATION','上次操作结果尚未核实，请先核对。');
 const operation=recordOperation(uuid(),label,path,method,data);pending.value=operation;if(session.value)uni.setStorageSync(pendingStorageKey(session.value.user.id),operation);
 return retryOperation<T>();
}
export async function checkOperation(){if(!pending.value)return 'none';const r=await request<{status:'committed'|'not_found'}>('/operations/'+pending.value.key);if(r.status==='committed')clearPending();return r.status;}
export async function retryOperation<T=unknown>(){const operation=replayDescriptor(pending.value);if(!operation)throw new ApiFailure('RETRY_UNAVAILABLE','旧操作缺少原请求内容，请继续核对结果并联系维护人员核实。',true);try{const result=await request<T>(operation.path,operation.method,operation.data,operation.key);clearPending();return result;}catch(e){if(e instanceof ApiFailure&&!retainPending(e.status,e.unknown))clearPending();throw e;}}
