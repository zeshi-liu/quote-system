import {fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import type {QuoteDocument,ExportFormat} from '../../../../packages/contracts/src';
import type {ObjectStorage} from './storage';
import {contentType,exportFilename,type RenderDocument} from './render';
import type {ResolvedQuoteLogo} from './template';
export interface RenderClaim {jobId:string;exportId:string;versionId:string;generation:number;document:QuoteDocument;format:ExportFormat;objectKey:string;deadline:string;}
export interface ExportWorkerStore {claim():Promise<RenderClaim|null>;finish(claim:RenderClaim,file:{objectKey:string;filename:string;sha256:string;size:number;contentType:string}):Promise<void>;fail(claim:RenderClaim,error:string,retryable:boolean):Promise<void>;recover():Promise<void>;resolveLogo?(document:QuoteDocument,storage:ObjectStorage):Promise<ResolvedQuoteLogo|null>;}
export function renderInChild(document:RenderDocument,format:ExportFormat,options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<Buffer>{
 return new Promise((done,reject)=>{
  const source=__filename.endsWith('.ts'),child=fork(resolve(__dirname,source?'render-child.ts':'render-child.js'),[],{execArgv:['--max-old-space-size=512',...(source?['--import','tsx']:[])],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc']});
  let settled=false;const finish=(error?:Error,bytes?:Buffer)=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(memory);options.signal?.removeEventListener('abort',abort);child.kill('SIGKILL');error?reject(error):done(bytes!);};
  const abort=()=>finish(new Error('worker 已停止，任务等待租约恢复'));
  const timer=setTimeout(()=>finish(new Error('文件生成超时')),Math.min(options.timeoutMs??300000,300000));
  // Linux production also applies a 1 GiB cgroup limit to worker + child (deployment file).
  const memory=setInterval(()=>{if(process.platform==='linux'&&child.pid)void readFile(`/proc/${child.pid}/status`,'utf8').then(s=>{const kb=Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1]||0);if(kb>1024*1024)finish(new Error('文件生成超过内存上限'));}).catch(()=>{});},500);memory.unref();
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted){abort();return;}
  child.on('message',(message:any)=>{if(message?.ok&&Buffer.isBuffer(message.bytes)&&message.bytes.length&&message.bytes.length<=20*1024*1024)finish(undefined,message.bytes);else {const e=new Error(message?.error==='TEMPLATE_LOGO_INVALID'?'模板 logo 图片格式损坏或资源超限':'文件生成失败，请核对字体和模板配置');Object.assign(e,{code:message?.error});finish(e);}});
  child.once('error',()=>finish(new Error('无法启动文件生成进程')));child.once('exit',()=>{if(!settled)finish(new Error('文件生成进程异常退出'));});
  child.send({document,format},error=>{if(error)finish(new Error('无法发送文件生成任务'));});
 });
}
export async function runOnce(store:ExportWorkerStore,storage:ObjectStorage,render:(document:RenderDocument,format:ExportFormat)=>Promise<Buffer>=renderInChild){
 await store.recover();const claim=await store.claim();if(!claim)return false;
 try{let document:RenderDocument=claim.document;if(claim.document.logo){if(!store.resolveLogo)throw Object.assign(new Error('模板 logo 解析器尚未配置'),{code:'TEMPLATE_LOGO_INVALID'});const logoImage=await store.resolveLogo(claim.document,storage);if(!logoImage)throw Object.assign(new Error('模板 logo 原文件缺失'),{code:'TEMPLATE_LOGO_INVALID'});document={...claim.document,logoImage};}const bytes=await render(document,claim.format);const sha256=createHash('sha256').update(bytes).digest('hex');await storage.put(claim.objectKey,bytes,contentType(claim.format));const stored=await storage.read(claim.objectKey);if(stored.length!==bytes.length||createHash('sha256').update(stored).digest('hex')!==sha256)throw new Error('文件存储完整性校验失败');await store.finish(claim,{objectKey:claim.objectKey,filename:exportFilename(claim.document,claim.format),sha256,size:bytes.length,contentType:contentType(claim.format)});}
 catch(error:any){const logoFailure=String(error?.code||'').startsWith('TEMPLATE_LOGO_'),retryable=logoFailure?error.code==='TEMPLATE_LOGO_UNAVAILABLE':!/字体|模板|格式|配置|内存|超过/.test(error?.message||'');await store.fail(claim,logoFailure?String(error.message).slice(0,500):retryable?'文件服务暂不可用，请稍后核对任务结果':'文件生成配置或资源校验失败，请联系维护人员',retryable);}
 return true;
}
