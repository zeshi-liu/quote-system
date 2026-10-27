'use strict';
const {existsSync,statSync}=require('node:fs');const fs=require('node:fs/promises');const {join}=require('node:path');const {tmpdir}=require('node:os');const {run,hashFile,required,pgEnv,deploymentStage,reportFailure}=require('./deployment-common.cjs');
function validateRestore({file,manifest,target,confirmation}){if(!/^quote_restore_[a-z0-9_]{1,40}$/.test(target||''))throw Error('isolated_target_required');if(confirmation!=='CREATE_NEW_ISOLATED_DATABASE')throw Error('explicit_confirmation_required');if(!file?.endsWith('.dump.age')||!existsSync(file)||!statSync(file).isFile())throw Error('explicit_backup_file_required');if(manifest?.version!==1||!/^[a-f0-9]{64}$/.test(manifest.sha256)||manifest.bytes!==statSync(file).size)throw Error('backup_checksum_manifest_invalid');}
async function restore(env=process.env){
 const at=(stage,action)=>deploymentStage('restore',stage,action);
 await at('configuration',()=>required(env,['RESTORE_BACKUP_FILE','RESTORE_MANIFEST_FILE','RESTORE_TARGET_DATABASE','RESTORE_ADMIN_URL','RESTORE_AGE_IDENTITY_FILE']));
 const manifest=await at('read_manifest',async()=>JSON.parse(await fs.readFile(env.RESTORE_MANIFEST_FILE,'utf8')));
 await at('verify_checksum',async()=>{validateRestore({file:env.RESTORE_BACKUP_FILE,manifest,target:env.RESTORE_TARGET_DATABASE,confirmation:env.RESTORE_CONFIRM});if(await hashFile(env.RESTORE_BACKUP_FILE)!==manifest.sha256)throw Error('backup_checksum_mismatch');});
 const directory=await at('prepare_workdir',()=>fs.mkdtemp(join(env.RESTORE_WORK_DIR||tmpdir(),'quote-restore-'))),dump=join(directory,'database.dump');let admin;
 try{
  const {Client}=require('pg');admin=await at('configuration',()=>new Client({connectionString:env.RESTORE_ADMIN_URL,connectionTimeoutMillis:5000}));
  await at('decrypt',()=>run('age',['--decrypt','--identity',env.RESTORE_AGE_IDENTITY_FILE,'--output',dump,env.RESTORE_BACKUP_FILE]));await at('verify_archive',()=>run('pg_restore',['--list',dump]));
  await at('connect_isolated_admin',()=>admin.connect());
  await at('create_isolated_database',async()=>{if((await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[env.RESTORE_TARGET_DATABASE])).rowCount)throw Error('restore_target_already_exists');
   // No DROP/CLEAN/IF-EXISTS: concurrent creation also fails without overwriting.
   await admin.query('CREATE DATABASE "'+env.RESTORE_TARGET_DATABASE+'" TEMPLATE template0');});
  await at('restore_archive',async()=>{const url=new URL(env.RESTORE_ADMIN_URL);url.pathname='/'+env.RESTORE_TARGET_DATABASE;await run('pg_restore',['--exit-on-error','--single-transaction','--no-owner','--no-acl','--dbname',env.RESTORE_TARGET_DATABASE,dump],{env:pgEnv(url.toString())});});console.log('isolated_database_restored; business/files/session-revocation checks still required');
 }finally{await at('cleanup',async()=>{if(admin)await admin.end().catch(()=>{});await fs.rm(directory,{recursive:true,force:true});});}
}
module.exports={validateRestore,restore};if(require.main===module)restore().catch(error=>{reportFailure('restore',error);process.exitCode=1;});
