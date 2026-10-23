import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import type { ViteDevServer } from 'vite';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const storage=new Map<string,unknown>();
const replies:Array<{data?:unknown;fail?:boolean}>=[];
const requests:Array<{url:string;method:string;header:Record<string,string>;data:unknown}>=[];
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
 request(options:any){requests.push(options);const reply=replies.shift();queueMicrotask(()=>{if(!reply)throw new Error('No test response');if(reply.fail)options.fail({});else options.success({statusCode:200,data:{data:reply.data}});});},
};
let vite:ViteDevServer;let cacheDir:string;
test.before(async()=>{
 (globalThis as any).uni=fakeUni;storage.set('quote-session',sampleSession);
 const {createServer}=await import('vite');cacheDir=await mkdtemp(resolve(tmpdir(),'quote-mini-recovery-'));
 vite=await createServer({root:resolve('apps/mini'),cacheDir,configFile:false,logLevel:'error',server:{middlewareMode:true,hmr:false},appType:'custom'});
 api=await vite.ssrLoadModule('/src/api.ts') as typeof api;
});
test.after(async()=>{await vite?.close();if(cacheDir)await rm(cacheDir,{recursive:true,force:true});delete (globalThis as any).uni;});
test.beforeEach(()=>{storage.clear();storage.set('quote-session',sampleSession);replies.length=0;requests.length=0;storageEvents.length=0;api.pending.value=null;});

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
