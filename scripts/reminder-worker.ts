import {startReminderWorker} from '../apps/api/src/finance-control/worker-main';
startReminderWorker().catch(error=>{console.error(error instanceof Error?error.message:'reminder_worker_startup_failed');process.exitCode=1;});
