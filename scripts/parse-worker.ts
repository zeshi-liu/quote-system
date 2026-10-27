import {startParseWorker} from '../apps/api/src/source-files/worker-main';
startParseWorker().catch(()=>{console.error('parse_worker_startup_failed');process.exitCode=1;});
