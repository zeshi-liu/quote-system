'use strict';
const {spawn}=require('node:child_process');const {createReadStream}=require('node:fs');const {createHash}=require('node:crypto');
function required(env,keys){for(const k of keys)if(!env[k]||/replace_me|placeholder|example\.com/i.test(env[k]))throw Error('missing_or_placeholder: '+k);}
function run(command,args,options={}){return new Promise((resolve,reject)=>{const p=spawn(command,args,{stdio:['ignore','ignore','ignore'],...options});p.once('error',()=>reject(Object.assign(Error('tool_unavailable: '+command),{tool:command})));p.once('exit',(code)=>code===0?resolve():reject(Object.assign(Error('tool_failed: '+command),{tool:command,exitCode:code})));});}
async function hashFile(file){const hash=createHash('sha256');for await(const part of createReadStream(file))hash.update(part);return hash.digest('hex');}
function pgEnv(url){const parsed=new URL(url);if(!['postgres:','postgresql:'].includes(parsed.protocol))throw Error('invalid_database_protocol');return {...process.env,PGHOST:parsed.hostname,PGPORT:parsed.port||'5432',PGUSER:decodeURIComponent(parsed.username),PGPASSWORD:decodeURIComponent(parsed.password),PGDATABASE:decodeURIComponent(parsed.pathname.slice(1)),PGCONNECT_TIMEOUT:'5',PGSSLMODE:parsed.searchParams.get('sslmode')||'prefer'};}
function cosAdapter(env){required(env,['BACKUP_COS_SECRET_ID','BACKUP_COS_SECRET_KEY','BACKUP_COS_BUCKET','BACKUP_COS_REGION']);const COS=require('cos-nodejs-sdk-v5');const client=new COS({SecretId:env.BACKUP_COS_SECRET_ID,SecretKey:env.BACKUP_COS_SECRET_KEY,Protocol:'https:',Timeout:60000});const args=key=>({Bucket:env.BACKUP_COS_BUCKET,Region:env.BACKUP_COS_REGION,Key:key});return {
 async putFile(key,file){const {stat}=require('node:fs/promises');await client.putObject({...args(key),Body:createReadStream(file),ContentLength:(await stat(file)).size,ACL:'private'});},
 async putJson(key,object){await client.putObject({...args(key),Body:Buffer.from(JSON.stringify(object)),ContentType:'application/json',ACL:'private'});},
 async readJson(key){const r=await client.getObject(args(key));return JSON.parse(Buffer.from(r.Body).toString());},
 async verifyFile(key,expected){const {PassThrough}=require('node:stream');const stream=new PassThrough();const digest=createHash('sha256');let bytes=0;const consuming=(async()=>{for await(const part of stream){bytes+=part.length;digest.update(part);}})();try{await client.getObject({...args(key),Output:stream});stream.end();await consuming;}catch(e){stream.destroy();await consuming.catch(()=>{});throw e;}if(bytes!==expected.bytes||digest.digest('hex')!==expected.sha256)throw Error('offhost_checksum_mismatch');},
 async list(prefix){const keys=[];let marker='';do{const r=await client.getBucket({Bucket:env.BACKUP_COS_BUCKET,Region:env.BACKUP_COS_REGION,Prefix:prefix,Marker:marker,MaxKeys:1000});keys.push(...(r.Contents||[]).map(r=>r.Key));marker=r.IsTruncated==='true'?r.NextMarker:'';if(r.IsTruncated==='true'&&!marker)throw Error('backup_listing_incomplete');}while(marker);return keys;},
 async remove(key){await client.deleteObject(args(key));}
 };}
// Preserve an actionable stage, never provider messages, paths, URLs or supplied values.
class DeploymentFailure extends Error {
 constructor(operation,stage,error){
  const known=new Set(['tool_failed','tool_unavailable','missing_or_placeholder','backup_bucket_must_be_separate','invalid_backup_scope','backup_already_running_or_stale_lock','empty_backup','offhost_checksum_mismatch','manifest_verification_failed','invalid_backup_manifest','backup_checksum_mismatch','backup_checksum_manifest_invalid','isolated_target_required','explicit_confirmation_required','explicit_backup_file_required','restore_target_already_exists','missing_or_future_backup']);
  const candidate=typeof error?.message==='string'?error.message.split(':')[0]:'',reason=known.has(candidate)?candidate:['EACCES','ENOSPC','ENOENT','EIO','ETIMEDOUT','ECONNREFUSED','ECONNRESET'].includes(error?.code)?error.code:'operation_failed';
  super(operation+'_failed: '+stage+' ('+reason+')');this.record={event:operation+'_failed',stage,reason};
  if(['tool_failed','tool_unavailable'].includes(reason)&&['pg_dump','pg_restore','age'].includes(error?.tool)){this.record.tool=error.tool;if(Number.isInteger(error.exitCode))this.record.exitCode=error.exitCode;}
 }
}
async function deploymentStage(operation,stage,action){try{return await action();}catch(error){throw new DeploymentFailure(operation,stage,error);}}
function reportFailure(operation,error){console.error(JSON.stringify(error instanceof DeploymentFailure?error.record:new DeploymentFailure(operation,'unknown',error).record));}
module.exports={run,hashFile,required,pgEnv,cosAdapter,deploymentStage,reportFailure};
