import {setTimeout as sleep} from 'node:timers/promises';
import {Database} from '../db/database';
import {CoreStore} from '../core/store';
import {ReminderWorker} from './reminders';
import {WechatReminderSender,type WechatReminderOptions} from './wechat-sender';
export function reminderOptions(env:NodeJS.ProcessEnv=process.env):WechatReminderOptions{
 let fields:WechatReminderOptions['fields']={};if(env.WECHAT_REMINDER_FIELDS){const parsed:unknown=JSON.parse(env.WECHAT_REMINDER_FIELDS);if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')throw new Error('WECHAT_REMINDER_FIELDS 必须是模板字段映射');fields=parsed as WechatReminderOptions['fields'];}
 const state=env.WECHAT_MINIPROGRAM_STATE||'formal';if(!['formal','trial','developer'].includes(state))throw new Error('WECHAT_MINIPROGRAM_STATE 无效');
 return {enabled:env.REMINDER_SEND_WECHAT==='true',appId:env.WECHAT_APP_ID||'',appSecret:env.WECHAT_APP_SECRET||'',templateId:env.WECHAT_REMINDER_TEMPLATE_ID||'',page:env.WECHAT_REMINDER_PAGE||'',fields,miniprogramState:state as WechatReminderOptions['miniprogramState']};
}
export async function startReminderWorker(){const url=process.env.DATABASE_URL;if(!url)throw new Error('必须配置 DATABASE_URL');const options=reminderOptions(),db=new Database(url),store=new CoreStore(db),workers=[new ReminderWorker(store),new ReminderWorker(store,new WechatReminderSender(options))],abort=new AbortController();
 process.once('SIGTERM',()=>abort.abort());process.once('SIGINT',()=>abort.abort());
 try{await db.migrate({verifyOnly:process.env.NODE_ENV==='production'});while(!abort.signal.aborted){for(const worker of workers){if(abort.signal.aborted)break;try{await worker.runOnce();}catch{console.error('reminder_worker_iteration_failed');}}if(!abort.signal.aborted)await sleep(60000,undefined,{signal:abort.signal}).catch(()=>{});}}
 finally{await db.close();}
}
if(require.main===module)startReminderWorker().catch(error=>{console.error(error instanceof Error?error.message:'reminder_worker_startup_failed');process.exitCode=1;});
