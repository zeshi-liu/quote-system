'use strict';
const fs=require('node:fs/promises');const {join}=require('node:path');const {run,hashFile,required,pgEnv,cosAdapter,deploymentStage,reportFailure}=require('./deployment-common.cjs');
function retention(rows){const sorted=[...rows].sort((a,b)=>Date.parse(b.dataTime)-Date.parse(a.dataTime));const keep=new Set(sorted.slice(0,24).map(r=>r.key)),days=new Set();for(const row of sorted){const day=row.dataTime.slice(0,10);if(!days.has(day)&&days.size<7){days.add(day);keep.add(row.key);}}return keep;}
async function backup(env=process.env,adapter){
 const at=(stage,action)=>deploymentStage('backup',stage,action);
 await at('configuration',()=>{required(env,['BACKUP_DATABASE_URL','BACKUP_AGE_RECIPIENTS_FILE','BACKUP_SCOPE','BACKUP_COS_BUCKET','COS_BUCKET']);if(env.BACKUP_COS_BUCKET===env.COS_BUCKET)throw Error('backup_bucket_must_be_separate');if(!/^[a-z0-9-]{1,48}$/.test(env.BACKUP_SCOPE))throw Error('invalid_backup_scope');});
 const root=env.BACKUP_WORK_DIR||'/backup-work';await at('prepare_workdir',()=>fs.mkdir(root,{recursive:true,mode:0o700}));const lock=join(root,'.backup-lock');await at('acquire_lock',()=>fs.mkdir(lock).catch(()=>{throw Error('backup_already_running_or_stale_lock');}));let dir;
 try{
  dir=await at('prepare_workdir',()=>fs.mkdtemp(join(root,'run-')));const dataTime=new Date().toISOString(),dump=join(dir,'database.dump'),cipher=dump+'.age';
  await at('dump',()=>run('pg_dump',['--format=custom','--no-owner','--no-acl','--file',dump],{env:pgEnv(env.BACKUP_DATABASE_URL)}));
  await at('verify_archive',()=>run('pg_restore',['--list',dump]));
  await at('encrypt',()=>run('age',['--encrypt','--recipients-file',env.BACKUP_AGE_RECIPIENTS_FILE,'--output',cipher,dump]));await at('remove_plaintext',()=>fs.rm(dump));
  const prefix='backups/'+env.BACKUP_SCOPE+'/',key=prefix+dataTime.replace(/[:.]/g,'-')+'.dump.age';
  const manifest=await at('checksum_cipher',async()=>{const m={version:1,dataTime,completedAt:new Date().toISOString(),key,bytes:(await fs.stat(cipher)).size,sha256:await hashFile(cipher)};if(!m.bytes)throw Error('empty_backup');return m;});
  const remote=await at('configuration',()=>adapter||cosAdapter(env));
  await at('upload_cipher',()=>remote.putFile(key,cipher));await at('verify_remote_cipher',()=>remote.verifyFile(key,manifest));
  await at('upload_manifest',()=>remote.putJson(key+'.json',manifest));
  await at('verify_remote_manifest',async()=>{const uploaded=await remote.readJson(key+'.json');if(uploaded.sha256!==manifest.sha256||uploaded.dataTime!==manifest.dataTime)throw Error('manifest_verification_failed');});
  // Only manifests created by this tool in the configured backup namespace participate.
  await at('retention',async()=>{const names=(await remote.list(prefix)).filter(k=>k.startsWith(prefix)&&/^\d{4}-\d{2}-\d{2}T[0-9TZ-]+\.dump\.age\.json$/.test(k.slice(prefix.length)));const rows=[];for(const name of names){const m=await remote.readJson(name);if(m.version!==1||m.key+'.json'!==name||!Number.isFinite(Date.parse(m.dataTime)))throw Error('invalid_backup_manifest');rows.push({...m,key:name});}const keep=retention(rows);for(const row of rows)if(!keep.has(row.key)){await remote.remove(row.key.slice(0,-5));await remote.remove(row.key);}});
  await at('record_success',()=>fs.writeFile(join(root,'last-success.json'),JSON.stringify(manifest),{mode:0o600}));console.log('backup_uploaded_verified '+manifest.dataTime);return manifest;
 }finally{await at('cleanup',async()=>{if(dir)await fs.rm(dir,{recursive:true,force:true});await fs.rmdir(lock);});}
}
module.exports={retention,backup};if(require.main===module)backup().catch(error=>{reportFailure('backup',error);process.exitCode=1;});
