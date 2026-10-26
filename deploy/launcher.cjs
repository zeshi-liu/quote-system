'use strict';
const path=require('node:path');const root=path.resolve(__dirname,'../apps/api/dist/apps/api/src');const api=name=>require(path.join(root,name));const {validate}=require('../scripts/deployment-preflight.cjs');
// Probe every mounted filesystem before each claim; never infer that containers share a disk.
async function mountedStatfs(target,readFile=require('node:fs/promises').readFile,statfs=require('node:fs/promises').statfs){
 const mountinfo=await readFile('/proc/self/mountinfo','utf8'),mounts=mountinfo.trim().split('\n').map(line=>line.split(' ')[4]?.replace(/\\([0-7]{3})/g,(_match,octal)=>String.fromCharCode(parseInt(octal,8))));
 if(!mounts.includes(target))throw Error('disk_path_not_mounted');return statfs(target,{bigint:true});
}
async function capacity(paths,statfs=mountedStatfs){
 const mounts=[];if(!Array.isArray(paths)||!paths.length)return {allowed:false,status:'paused_unknown',mounts};
 for(let index=0;index<paths.length;index++){try{const fs=await statfs(paths[index],{bigint:true}),blocks=BigInt(fs.blocks),free=BigInt(fs.bfree),available=BigInt(fs.bavail),used=blocks-free,total=used+available;if(blocks<=0n||free<0n||free>blocks||available<0n||available>free||total<=0n)throw Error('invalid_statfs');mounts.push({index,usedPercent:Number(used*10000n/total)/100,full:used*100n>=total*85n,warning:used*100n>=total*75n});}catch{mounts.push({index,unknown:true});}}
 const unknown=mounts.some(m=>m.unknown),full=mounts.some(m=>m.full),warning=mounts.some(m=>m.warning);return {allowed:!unknown&&!full,status:unknown?'paused_unknown':full?'paused_full':warning?'warning':'ready',mounts};
}
async function runHeavyCycle({signal,gate,report,exportTask,parseTask}){
 for(const task of [exportTask,parseTask]){if(signal.aborted)return;const state=await gate();report(state);if(!state.allowed||signal.aborted)return;await task();}
}
module.exports={capacity,runHeavyCycle,mountedStatfs};
async function main(){const mode=process.argv[2];if(!['migrate','verify-migrations','init-admin','heavy','maintenance'].includes(mode))throw Error('invalid_deployment_command');const {Database}=api('db/database.js');
 if(mode==='migrate'){if(!process.env.MIGRATION_DATABASE_URL)throw Error('MIGRATION_DATABASE_URL_required');const db=new Database(process.env.MIGRATION_DATABASE_URL,1);try{await db.migrate();await db.query('REVOKE INSERT,UPDATE,DELETE ON schema_migrations FROM quote_app');console.log('migration_completed');}finally{await db.close();}return;}
 const checked=validate(process.env,{heavy:mode==='heavy'});const db=new Database(process.env.DATABASE_URL,5);try{await db.verifyMigrations();if(mode==='verify-migrations'){console.log('migration_checksum_verified');return;}const {CoreStore}=api('core/store.js'),store=new CoreStore(db);
 if(mode==='init-admin'){if(!process.stdout.isTTY)throw Error('interactive_terminal_required');for(const key of ['ADMIN_LOGIN_NAME','ADMIN_NAME','ADMIN_PHONE'])if(!process.env[key])throw Error(key+'_required');const {initializeAdmin}=api('master-data/identity.js');const result=await initializeAdmin(store,{loginName:process.env.ADMIN_LOGIN_NAME,name:process.env.ADMIN_NAME,phone:process.env.ADMIN_PHONE});console.log('管理员：'+result.user.loginName+'\n临时密码（仅交互终端）：'+result.temporaryPassword+'\n首次登录须设置本人新密码');return;}
 const abort=new AbortController();for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>abort.abort());const sleep=async(ms)=>require('node:timers/promises').setTimeout(ms,undefined,{signal:abort.signal}).catch(()=>{});
 if(mode==='maintenance'){const {AnalyticsService}=api('analytics/service.js');do{await new AnalyticsService(store).cleanupExpired();await db.query('DELETE FROM master_data_previews WHERE expires_at<=now()');console.log('temporary_query_data_cleaned');if(process.env.MAINTENANCE_ONCE==='true')return;await sleep(3600000);}while(!abort.signal.aborted);return;}
 // One session-level lease across all heavy replicas: export + parser share concurrency 1.
 const lock=await db.pool.connect();try{const acquired=(await lock.query('SELECT pg_try_advisory_lock(790125) AS acquired')).rows[0].acquired;if(!acquired)throw Error('heavy_worker_already_running');lock.on('error',()=>abort.abort());const storage=api('delivery/storage.js').createStorage(),exportStore=new (api('delivery/export-store.js').ExportStore)(store),parser=new (api('source-files/parser.js').ParserService)(new (api('source-files/service.js').SourceFileService)(store,storage),{signal:abort.signal}),delivery=api('delivery/worker.js');let cleanup=0;
 let lastStatus='',lastReported=0;const report=state=>{if(state.status!==lastStatus||Date.now()-lastReported>=60000){console.log(JSON.stringify({event:'heavy_disk_capacity',status:state.status,mounts:state.mounts}));lastStatus=state.status;lastReported=Date.now();}};
 while(!abort.signal.aborted){try{await runHeavyCycle({signal:abort.signal,gate:()=>capacity(checked.diskPaths),report,exportTask:()=>delivery.runOnce(exportStore,storage,(document,format)=>delivery.renderInChild(document,format,{signal:abort.signal})),parseTask:()=>parser.runOnce()});if(Date.now()-cleanup>86400000){await api('delivery/worker-main.js').cleanupObjects(db,storage);cleanup=Date.now();}}catch{console.error('heavy_worker_iteration_failed');}await sleep(2000);}
 }finally{await lock.query('SELECT pg_advisory_unlock(790125)').catch(()=>{});lock.release();}
 }finally{await db.close();}}
if(require.main===module)main().catch(()=>{console.error('deployment_command_failed: verify configuration, migration and operator access');process.exitCode=1;});
