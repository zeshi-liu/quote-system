import {setTimeout as sleep} from 'node:timers/promises';
import {Database} from '../db/database';
import {configuration} from '../config';
import {CoreStore} from '../core/store';
import {createStorage} from '../delivery/storage';
import {SourceFileService} from './service';
import {ParserService} from './parser';
export async function startParseWorker(){
 const config=configuration(),db=new Database(config.databaseUrl),abort=new AbortController();
 if(!['local','cos'].includes(process.env.FILE_STORAGE_DRIVER||''))throw Error('解析 worker 必须配置私有文件存储');
 await db.migrate({verifyOnly:config.production});const files=new SourceFileService(new CoreStore(db),createStorage()),parser=new ParserService(files,{signal:abort.signal});
 process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());
 try{while(!abort.signal.aborted){try{await parser.runOnce();}catch{console.error('parse_worker_iteration_failed');}if(!abort.signal.aborted)await sleep(1000,undefined,{signal:abort.signal}).catch(()=>{});}}
 finally{await db.close();}
}
if(require.main===module)startParseWorker().catch(()=>{console.error('parse_worker_startup_failed');process.exitCode=1;});
