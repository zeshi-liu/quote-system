import {createServer as createHttpServer} from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const storage=new Map<string,unknown>();
const replies:Array<{data?:unknown;fail?:boolean;defer?:boolean}>=[];
const requests:Array<{url:string;method:string;header:Record<string,string>;data:unknown}>=[];
let completeDeferred:(()=>void)|null=null;
const storageEvents:Array<{key:string;pendingAtWrite:boolean}>=[];
let api:typeof import('./api');
const sampleSession={authState:'authenticated',token:'offline-test-session',user:{id:'offline-salesperson',name:'试用销售',role:'salesperson'}};
const originalPath='/quotes/quote-id/versions/version-id/export';
const accepted={orderId:'order-id',versionId:'version-id',jobId:'job-id',exportId:'export-id'};
const jobKey='quote-export-job-order-id-version-id';
const fakeUni={
 getStorageSync(key:string){return storage.get(key);},
 setStorageSync(key:string,value:unknown){storageEvents.push({key,pendingAtWrite:!!api?.pending.value});storage.set(key,value);},
 removeStorageSync(key:string){storage.delete(key);},
 request(options:any){requests.push(options);const reply=replies.shift();const complete=()=>{if(!reply)throw new Error('No test response');if(reply.fail)options.fail({});else options.success({statusCode:200,data:{data:reply.data}});};if(reply?.defer)completeDeferred=complete;else queueMicrotask(complete);},
};
let vite:ViteDevServer;let cacheDir:string;
test.before(async()=>{
 (globalThis as any).uni=fakeUni;storage.set('quote-session',sampleSession);
 const {createServer}=await import('vite');cacheDir=await mkdtemp(resolve(tmpdir(),'quote-mini-recovery-'));
 vite=await createServer({root:resolve('apps/mini'),cacheDir,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},logLevel:'error',server:{middlewareMode:true,hmr:{server:createHttpServer()}},appType:'custom'});
 api=await vite.ssrLoadModule('/src/api.ts') as typeof api;
});
test.after(async()=>{await vite?.close();if(cacheDir)await rm(cacheDir,{recursive:true,force:true});delete (globalThis as any).uni;});
test.beforeEach(()=>{storage.clear();storage.set('quote-session',sampleSession);api.setSession(sampleSession as any);replies.length=0;requests.length=0;storageEvents.length=0;api.pending.value=null;});

async function loseExportResponse(){
 replies.push({fail:true});
 await assert.rejects(api.mutate('导出报价 PDF',originalPath,'POST',{expectedVersion:7,format:'pdf',lossAcknowledged:false}));
 assert.ok(api.pending.value,'unknown export keeps the original request');
 return api.pending.value!.key;
}
test('operation check restores an accepted export job before clearing the original pending request',async()=>{
 const key=await loseExportResponse();
 replies.push({data:{status:'committed',result:accepted}});
 assert.equal(await api.checkOperation(),'committed');
 assert.equal(storage.get(jobKey),'job-id','refresh must recover the original export job');
 assert.ok(storageEvents.some(event=>event.key===jobKey&&event.pendingAtWrite),'job receipt is durable before pending is cleared');
 assert.equal(api.pending.value,null);
 assert.equal(requests[1].url.endsWith('/operations/'+key),true);
});
test('retry restores the accepted export job using the same original key and body',async()=>{
 const key=await loseExportResponse();
 replies.push({data:accepted});
 assert.deepEqual(await api.retryOperation(),accepted);
 assert.equal(storage.get(jobKey),'job-id');
 assert.ok(storageEvents.some(event=>event.key===jobKey&&event.pendingAtWrite));
 assert.equal(api.pending.value,null);
 assert.equal(requests[1].header['Idempotency-Key'],key);
 assert.deepEqual(requests[1].data,requests[0].data);
 assert.equal(requests[1].url,requests[0].url);
});
test('an acknowledged export without a recoverable receipt retains the original pending request',async()=>{
 const key=await loseExportResponse();
 replies.push({data:{status:'committed',result:{orderId:'order-id'}}});
 await assert.rejects(api.checkOperation());
 assert.equal(api.pending.value?.key,key);
 assert.equal(storage.has(jobKey),false);
});
const paymentReceipt=()=>({orderId:'order-id',receivable:{id:'ar-id',orderId:'order-id'},payment:{id:'payment-id',receivableId:'ar-id',status:'active',amount:'40.00',paidDate:'2026-10-20',remark:'原备注',correctsPaymentRecordId:null}});
async function losePaymentResponse(){replies.push({fail:true});await assert.rejects(api.mutate('登记回款','/sales/receivables/ar-id/payments','POST',{amount:'40.00',paidDate:'2026-10-20',remark:'原备注'}));return api.pending.value!.key;}
test('mini refuses to clear an unknown payment until its matching receipt is recovered',async()=>{const key=await losePaymentResponse();replies.push({data:{status:'committed',result:{orderId:'order-id'}}});await assert.rejects(api.checkOperation(),/回执/);assert.equal(api.pending.value?.key,key);replies.push({data:{status:'committed',result:paymentReceipt()}});assert.equal(await api.checkOperation(),'committed');assert.equal(api.pending.value,null);});
test('mini recovery points to original receivable and retries the unchanged payment body and key',async()=>{const key=await losePaymentResponse();const {receivableForOperation}=await import('./pending');assert.equal(receivableForOperation(api.pending.value),'ar-id');replies.push({data:{status:'not_found'}});assert.equal(await api.checkOperation(),'not_found');assert.equal(api.pending.value?.key,key);replies.push({data:paymentReceipt()});await api.retryOperation();assert.equal(requests.at(-1)?.header['Idempotency-Key'],key);assert.deepEqual(requests.at(-1)?.data,requests[0].data);});

test('mini check and retry keep exact stored add request on wrong receipt facts',async t=>{const mutations:Array<[string,(r:any)=>void]>=[['payment receivable',r=>{r.payment.receivableId='other';}],['order consistency',r=>{r.receivable.orderId='other';}],['amount',r=>{r.payment.amount='39.00';}],['date',r=>{r.payment.paidDate='2026-10-21';}],['status',r=>{r.payment.status='void';}],['correction',r=>{r.payment.correctsPaymentRecordId='other';}],['remark',r=>{r.payment.remark='other';}]];for(const [label,change] of mutations)for(const mode of ['check','retry'] as const)await t.test(label+' via '+mode,async()=>{storage.clear();replies.length=0;requests.length=0;api.pending.value=null;const key=await losePaymentResponse(),original=JSON.stringify(api.pending.value),saved=JSON.stringify(storage.get('quote-pending-'+sampleSession.user.id)),wrong=paymentReceipt();change(wrong);replies.push({data:mode==='check'?{status:'committed',result:wrong}:wrong});await assert.rejects(mode==='check'?api.checkOperation():api.retryOperation(),/回执/);assert.equal(api.pending.value?.key,key);assert.equal(JSON.stringify(api.pending.value),original);assert.equal(JSON.stringify(storage.get('quote-pending-'+sampleSession.user.id)),saved);replies.push({data:mode==='check'?{status:'committed',result:paymentReceipt()}:paymentReceipt()});await(mode==='check'?api.checkOperation():api.retryOperation());assert.equal(api.pending.value,null);});});
test('mini check and retry keep exact void operation unless record, status and reason match',async t=>{for(const [label,change] of [['record',(r:any)=>{r.payment.id='other';}],['status',(r:any)=>{r.payment.status='active';}],['reason',(r:any)=>{r.payment.voidReason='other';}],['receivable',(r:any)=>{r.payment.receivableId='other';}]] as const)for(const mode of ['check','retry'] as const)await t.test(label+' via '+mode,async()=>{storage.clear();replies.length=0;requests.length=0;api.pending.value=null;replies.push({fail:true});await assert.rejects(api.mutate('作废误录回款','/sales/receivables/ar-id/payments/payment-id/void','POST',{reason:' 原金额误录 '}));const original=JSON.stringify(api.pending.value),correct={...paymentReceipt(),payment:{...paymentReceipt().payment,status:'void',voidReason:'原金额误录'}},wrong=structuredClone(correct);change(wrong);replies.push({data:mode==='check'?{status:'committed',result:wrong}:wrong});await assert.rejects(mode==='check'?api.checkOperation():api.retryOperation(),/回执/);assert.equal(JSON.stringify(api.pending.value),original);replies.push({data:mode==='check'?{status:'committed',result:correct}:correct});await(mode==='check'?api.checkOperation():api.retryOperation());assert.equal(api.pending.value,null);});});
test('mini accepts matching normalized correction with preserved unknown actual date',async()=>{const result={...paymentReceipt(),payment:{...paymentReceipt().payment,amount:'35.00',paidDate:null,remark:'历史更正',correctsPaymentRecordId:'old-void'}};replies.push({data:result});await api.mutate('关联重录','/sales/receivables/ar-id/payments','POST',{amount:'35',paidDate:null,remark:'  历史更正  ',correctsPaymentRecordId:'old-void'});assert.equal(api.pending.value,null);});
test('原账号请求迟到时不清除新账号的待核实操作，也不将原账号回执写入新账号界面',async()=>{const key=await losePaymentResponse(),saved=storage.get('quote-pending-'+sampleSession.user.id),other={...sampleSession,token:'other-token',user:{...sampleSession.user,id:'other-salesperson'}},otherPending={...api.pending.value!,key:'other-key'};storage.set('quote-pending-'+other.user.id,otherPending);replies.push({data:paymentReceipt()});const inFlight=api.retryOperation();api.setSession(other as any);await assert.rejects(inFlight,/登录|账号|会话/);assert.equal(api.pending.value?.key,'other-key');assert.deepEqual(storage.get('quote-pending-'+other.user.id),otherPending);assert.deepEqual(storage.get('quote-pending-'+sampleSession.user.id),saved);api.setSession(sampleSession as any);assert.equal(api.pending.value?.key,key);});
test('核对操作结果时账号变化也保留原账号和新账号各自记录',async()=>{await losePaymentResponse();const original=storage.get('quote-pending-'+sampleSession.user.id);replies.push({data:{status:'committed',result:paymentReceipt()}});const checking=api.checkOperation();api.setSession(null);await assert.rejects(checking,/登录|账号|会话/);assert.equal(api.pending.value,null);assert.deepEqual(storage.get('quote-pending-'+sampleSession.user.id),original);});

test('采购冻结及整单作废拒绝不匹配的成功回执并保留原操作',async()=>{for(const [path,result] of [['/sales/purchase-orders/order-a/revisions/r1/freeze',{id:'other',version:3,status:'frozen',revisionId:'r1',lines:[]}],['/sales/purchase-orders/order-a/void',{id:'order-a',version:2,status:'draft'}],['/sales/purchase-orders/order-a/revisions/r1/lines',{id:'order-a',version:1,status:'draft',revisionId:'r1'}]] as const){api.pending.value=null;storage.delete('quote-pending-'+sampleSession.user.id);replies.push({data:result});await assert.rejects(api.mutate('采购操作',path,path.endsWith('/lines')?'PUT':'POST',{expectedVersion:2}));assert.ok(api.pending.value);}});

test('actual transport blocks concurrent recovery but unknown outcome releases it',async()=>{
 replies.push({fail:true,defer:true});const writing=api.mutate('登记回款','/sales/receivables/ar-id/payments','POST',{amount:'40.00',paidDate:'2026-10-20',remark:'原备注'});
 assert.equal(api.operationInFlight.value,true);await assert.rejects(api.checkOperation(),/正在/);await assert.rejects(api.retryOperation(),/正在/);assert.equal(requests.length,1);
 completeDeferred!();await assert.rejects(writing);assert.equal(api.operationInFlight.value,false);assert.ok(api.pending.value);
 replies.push({data:{status:'not_found'},defer:true});const checking=api.checkOperation();assert.equal(api.operationInFlight.value,true);await assert.rejects(api.checkOperation(),/正在/);completeDeferred!();assert.equal(await checking,'not_found');assert.equal(api.operationInFlight.value,false);assert.ok(api.pending.value);
});

test('hospital recovered create result is scoped to original user and operation key',async()=>{
 const receipt={id:'hospital-original',version:1,lines:[],submissionSource:'hospital_self',writable:true,status:'draft'};
 replies.push({fail:true});await assert.rejects(api.mutate('新建医院采购草稿','/hospital/purchase-orders','POST',{lines:[]}));const original={...api.pending.value!};
 replies.push({data:{status:'committed',result:receipt}});assert.equal(await api.checkOperation(),'committed');assert.deepEqual(api.hospitalResultForOperation(original),{id:receipt.id});assert.equal(api.hospitalResultForOperation({...original,key:'wrong-key'}),undefined);
 api.setSession({...sampleSession,user:{...sampleSession.user,id:'other-user'}} as any);assert.equal(api.hospitalResultForOperation(original),undefined);api.setSession(sampleSession as any);assert.deepEqual(api.hospitalResultForOperation(original),{id:receipt.id});
});
