import {fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {RawParseRow} from '../../../../packages/contracts/src/source-files';
export class ParseFailure extends Error {constructor(readonly code:string,message:string,readonly retryable=false,readonly resultUnknown=false){super(message);}}
export function parseInChild(bytes:Buffer,fileName:string,mimeType:string,options:{timeoutMs?:number;signal?:AbortSignal}={}):Promise<RawParseRow[]>{
 return new Promise((done,reject)=>{
  const source=__filename.endsWith('.ts'),child=fork(resolve(__dirname,source?'parse-child.ts':'parse-child.js'),[],{execArgv:['--max-old-space-size=256',...(source?['--import','tsx']:[])],serialization:'advanced',stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,NODE_ENV:process.env.NODE_ENV}});
  let settled=false;const finish=(error?:Error,rows?:RawParseRow[])=>{if(settled)return;settled=true;clearTimeout(timer);clearInterval(memory);options.signal?.removeEventListener('abort',abort);child.kill('SIGKILL');error?reject(error):done(rows!);};
  const abort=()=>finish(new ParseFailure('PARSE_INTERRUPTED','解析已中断，可手工重试',true));
  const timer=setTimeout(()=>finish(new ParseFailure('PARSE_TIMEOUT','表格解析超过 20 秒，请拆分文件或手工录入',true)),Math.max(1,Math.min(options.timeoutMs??20000,20000)));
  const memory=setInterval(()=>{if(process.platform==='linux'&&child.pid)void readFile(`/proc/${child.pid}/status`,'utf8').then(s=>{if(Number(s.match(/^VmRSS:\s+(\d+)/m)?.[1]||0)>512*1024)finish(new ParseFailure('PARSE_RESOURCE_LIMIT','表格解析内存超过限制，请拆分文件'));}).catch(()=>{});},250);memory.unref();
  options.signal?.addEventListener('abort',abort,{once:true});if(options.signal?.aborted){abort();return;}
  child.once('message',(m:any)=>{if(m?.ok&&Array.isArray(m.rows)&&m.rows.length<=1001&&Buffer.byteLength(JSON.stringify(m.rows))<=8*1024*1024)finish(undefined,m.rows);else finish(new ParseFailure(m?.code==='PARSE_RESOURCE_LIMIT'?'PARSE_RESOURCE_LIMIT':m?.code==='UNSAFE_WORKBOOK'?'UNSAFE_WORKBOOK':'INVALID_WORKBOOK','表格无法安全解析，请核对格式、公式、宏或外链后重试'));});
  child.once('error',()=>finish(new ParseFailure('PARSER_UNAVAILABLE','无法启动解析进程，请稍后重试',true)));child.once('exit',()=>{if(!settled)finish(new ParseFailure('PARSE_RESOURCE_LIMIT','解析进程退出，请拆分文件或手工录入'));});
  child.send({bytes,fileName,mimeType},error=>{if(error)finish(new ParseFailure('PARSER_UNAVAILABLE','无法提交解析任务',true));});
 });
}
