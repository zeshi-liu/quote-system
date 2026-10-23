import {startDeliveryWorker} from '../apps/api/src/delivery/worker-main';
startDeliveryWorker().catch(error=>{console.error(error instanceof Error?error.message:'worker_startup_failed');process.exitCode=1;});
