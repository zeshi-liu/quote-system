import {setTimeout as sleep} from 'node:timers/promises';
import {configuration} from '../config';
import {Database} from '../db/database';
import {CoreStore} from '../core/store';
import {ExportStore} from './export-store';
import {createStorage,type ObjectStorage} from './storage';
import {runOnce,renderInChild} from './worker';

/** Only old, unbound objects belonging to terminal jobs are removed. Unknown objects are retained. */
export async function cleanupObjects(db:Database,storage:ObjectStorage,now=new Date()){
 if(!storage.listBefore)return;
 const cutoff=new Date(now.getTime()-24*3600000);
 for(const obj of await storage.listBefore(cutoff)){
  const match=obj.key.match(/^exports\/([a-f0-9-]{36})\/([0-9]+)\/quote\.(pdf|xlsx)$/);if(!match)continue;
  const canDelete=await db.transaction(async c=>{await c.query('SELECT pg_advisory_xact_lock(790124)');const job=(await c.query('SELECT state,claim_generation FROM export_jobs WHERE id=$1',[match[1]])).rows[0];if(!job||!['succeeded','failed'].includes(job.state))return false;return !(await c.query('SELECT id FROM quote_files WHERE object_key=$1',[obj.key])).rowCount;});
  if(canDelete)await storage.remove(obj.key);
 }
}
async function main(){
 const config=configuration(),db=new Database(config.databaseUrl),storage=createStorage(),store=new ExportStore(new CoreStore(db)),abort=new AbortController();
 if(!['local','cos'].includes(process.env.FILE_STORAGE_DRIVER||''))throw new Error('worker 必须配置私有文件存储');
 await db.migrate();process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());let cleanupAt=0;
 try{while(!abort.signal.aborted){try{await runOnce(store,storage,(document,format)=>renderInChild(document,format,{signal:abort.signal}));if(Date.now()-cleanupAt>3600000){await cleanupObjects(db,storage);cleanupAt=Date.now();}}catch{console.error('export_worker_iteration_failed');}if(!abort.signal.aborted)await sleep(2000,undefined,{signal:abort.signal}).catch(()=>{});}}
 finally{await db.close();}
}
// Importing cleanup helpers must never start a worker.
if(require.main===module)main().catch(error=>{console.error(error instanceof Error?error.message:'worker_startup_failed');process.exitCode=1;});
export {main as startDeliveryWorker};
