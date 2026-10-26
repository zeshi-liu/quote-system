import {randomUUID} from 'node:crypto';
import {CoreStore,type Client} from '../core/store';
import {today} from '../core/validation';
import {bounded,decimal} from '../core/money';
import {effectivePaidSql} from '../receivables/queries';
export interface ReminderMessage {reminderId:string;receivableId:string;orderId:string;orderNo:string;hospitalName:string;ownerId:string;balance:string;dueDate:string;businessDate:string;openId?:string;}
export interface ReminderSendResult {outcome:'sent'|'not_sent'|'outcome_unknown';code?:string;}
export interface ReminderSender {channel:'in_app'|'wechat';appId?:string;templateId?:string;availability():{available:boolean;reason?:string};send(message:ReminderMessage):Promise<ReminderSendResult>;}
export const inAppReminderSender:ReminderSender={channel:'in_app',availability:()=>({available:true}),async send(){return {outcome:'sent'};}};
const afterNine=(now:Date)=>(now.getUTCHours()+8)%24>=9;
/** Claims are committed as unknown before any external send. A crash cannot replay the request. */
export class ReminderWorker{
 constructor(readonly store:CoreStore,readonly sender:ReminderSender=inAppReminderSender){}
 async enqueueToday(){const now=this.store.clock(),day=today(now);return this.store.db.transaction(async c=>{
  await c.query("UPDATE receivable_reminders SET state='skipped',reason='expired_business_date' WHERE channel=$1 AND reminder_date<$2::date AND state IN('queued','retryable','unavailable','skipped') AND (state<>'skipped' OR reason IS DISTINCT FROM 'expired_business_date')",[this.sender.channel,day]);
  const actualNow=this.store.clock();if(!afterNine(actualNow))return 0;const actualDay=today(actualNow);
  const result=await c.query(`INSERT INTO receivable_reminders(receivable_id,reminder_date,channel,created_at)
   SELECT ar.id,$1,$2,$3 FROM receivables ar JOIN purchase_orders o ON o.id=ar.purchase_order_id JOIN users u ON u.id=o.sales_user_id
   WHERE o.status<>'voided' AND u.active AND u.role='salesperson' AND ar.due_date<=$1::date
   AND ar.amount>COALESCE((SELECT sum(p.amount) FROM payment_records p WHERE p.receivable_id=ar.id AND p.status='active'),0)
   AND NOT EXISTS(SELECT 1 FROM receivable_exceptions e WHERE e.receivable_id=ar.id AND e.status='pending_verification')
   ORDER BY ar.id
   ON CONFLICT(receivable_id,reminder_date,channel) DO NOTHING`,[actualDay,this.sender.channel,actualNow]);return result.rowCount||0;
 });}
 private async business(c:Client,id:string){const ref=(await c.query('SELECT r.receivable_id,o.id AS order_id,o.hospital_id,o.sales_user_id FROM receivable_reminders r JOIN receivables ar ON ar.id=r.receivable_id JOIN purchase_orders o ON o.id=ar.purchase_order_id WHERE r.id=$1',[id])).rows[0];if(!ref)return null;
  const owner=(await c.query('SELECT id,active,role FROM users WHERE id=$1 FOR SHARE',[ref.sales_user_id])).rows[0];
  const hospital=(await c.query('SELECT id,name FROM hospitals WHERE id=$1 FOR SHARE',[ref.hospital_id])).rows[0];
  const root=(await c.query('SELECT * FROM purchase_orders WHERE id=$1 FOR UPDATE',[ref.order_id])).rows[0];
  const ar=(await c.query('SELECT * FROM receivables WHERE id=$1 FOR UPDATE',[ref.receivable_id])).rows[0];
  const paid=(await c.query(effectivePaidSql,[ar.id])).rows[0].paid;
  const paused=!!(await c.query("SELECT id FROM receivable_exceptions WHERE receivable_id=$1 AND status='pending_verification'",[ar.id])).rowCount;
  return {root,ar,owner,hospital,paused,balance:bounded(decimal(ar.amount).minus(decimal(paid))),ownerChanged:ref.sales_user_id!==root.sales_user_id};
 }
 private reason(b:NonNullable<Awaited<ReturnType<ReminderWorker['business']>>>,r:any,now:Date){if(r.reminder_date!==today(now))return 'expired_business_date';if(!afterNine(now))return 'before_schedule';if(b.ownerChanged)return 'owner_changed';if(!b.owner?.active||b.owner.role!=='salesperson')return 'owner_inactive';if(b.root.status==='voided')return 'order_voided';if(decimal(b.balance).lte(0))return 'settled';if(b.paused)return 'exception_paused';if(b.ar.due_date>today(now))return 'not_due';return null;}
 async dispatch(id:string):Promise<boolean>{
  const claim=await this.store.db.transaction(async c=>{const b=await this.business(c,id);if(!b)return null;const row=(await c.query('SELECT * FROM receivable_reminders WHERE id=$1 FOR UPDATE',[id])).rows[0],now=this.store.clock();
   if(row.channel!==this.sender.channel||['sent','outcome_unknown'].includes(row.state)||row.attempt_count>=3||row.retry_at&&row.retry_at>now)return null;
   const skip=this.reason(b,row,now);if(skip){await c.query("UPDATE receivable_reminders SET state='skipped',reason=$2 WHERE id=$1",[id,skip]);return null;}
   const available=this.sender.availability();if(!available.available){await c.query("UPDATE receivable_reminders SET state='unavailable',reason=$2 WHERE id=$1",[id,available.reason||'sender_unavailable']);return null;}
   let report:any;
   if(this.sender.channel==='wechat'){
    report=(await c.query(`SELECT s.* FROM reminder_subscription_reports s JOIN wechat_identities w ON w.app_id=s.app_id AND w.user_id=s.user_id AND w.open_id=s.open_id WHERE s.user_id=$1 AND s.app_id=$2 AND s.template_id=$3 AND s.state='available' ORDER BY s.recorded_at,s.id LIMIT 1 FOR UPDATE OF s`,[b.root.sales_user_id,this.sender.appId||'',this.sender.templateId||''])).rows[0];
    if(!report){await c.query("UPDATE receivable_reminders SET state='unavailable',reason='subscription_unavailable' WHERE id=$1",[id]);return null;}
    await c.query("UPDATE reminder_subscription_reports SET state='claimed' WHERE id=$1",[report.id]);
   }
   const token=randomUUID();await c.query("UPDATE receivable_reminders SET state='outcome_unknown',owner_id=$2,attempt_count=attempt_count+1,claim_token=$3,subscription_report_id=$4,attempted_at=$5,retry_at=NULL,reason=NULL WHERE id=$1",[id,b.root.sales_user_id,token,report?.id||null,now]);
   await c.query('INSERT INTO receivable_reminder_attempts(reminder_id,attempt_no,owner_id,claim_token,started_at) VALUES($1,$2,$3,$4,$5)',[id,row.attempt_count+1,b.root.sales_user_id,token,now]);
   return {token,ownerId:b.root.sales_user_id,reportId:report?.id,openId:report?.open_id};
  });
  if(!claim)return false;
  // Reacquire in the same user -> hospital -> order -> receivable order used by handoff/money writes.
  return this.store.db.transaction(async c=>{const b=await this.business(c,id);if(!b)return false;const row=(await c.query('SELECT * FROM receivable_reminders WHERE id=$1 FOR UPDATE',[id])).rows[0];if(row.state!=='outcome_unknown'||row.claim_token!==claim.token)return false;
   const now=this.store.clock(),available=this.sender.availability();let skip=this.reason(b,row,now);if(!skip&&b.root.sales_user_id!==claim.ownerId)skip='owner_changed';if(!skip&&!available.available)skip='sender_unavailable';
   if(claim.reportId){const report=(await c.query('SELECT * FROM reminder_subscription_reports WHERE id=$1 FOR UPDATE',[claim.reportId])).rows[0];const identity=(await c.query('SELECT open_id FROM wechat_identities WHERE user_id=$1 AND app_id=$2 FOR SHARE',[b.root.sales_user_id,this.sender.appId])).rows[0];if(!skip&&(report.state!=='claimed'||report.open_id!==identity?.open_id||report.user_id!==b.root.sales_user_id))skip='subscription_changed';}
   if(skip){await c.query("UPDATE receivable_reminders SET state='skipped',reason=$2 WHERE id=$1",[id,skip]);await c.query("UPDATE receivable_reminder_attempts SET outcome='skipped',result_code=$2,finished_at=$3 WHERE claim_token=$1",[claim.token,skip,now]);if(claim.reportId)await c.query("UPDATE reminder_subscription_reports SET state='available' WHERE id=$1 AND state='claimed'",[claim.reportId]);return false;}
   const message:ReminderMessage={reminderId:id,receivableId:b.ar.id,orderId:b.root.id,orderNo:b.root.order_no,hospitalName:b.hospital.name,ownerId:b.root.sales_user_id,balance:b.balance,dueDate:b.ar.due_date,businessDate:today(now),...(claim.openId?{openId:claim.openId}:{})};
   let result:ReminderSendResult;try{result=await this.sender.send(message);if(!['sent','not_sent','outcome_unknown'].includes(result?.outcome))result={outcome:'outcome_unknown',code:'invalid_sender_response'};}catch{result={outcome:'outcome_unknown',code:'sender_exception'};}
   const finished=this.store.clock(),state=result.outcome==='sent'?'sent':result.outcome==='not_sent'?'retryable':'outcome_unknown',code=(result.code||'').slice(0,200);
   await c.query('UPDATE receivable_reminders SET state=$2,reason=$3,sent_at=$4,retry_at=$5 WHERE id=$1',[id,state,code||null,result.outcome==='sent'?finished:null,result.outcome==='not_sent'?new Date(finished.getTime()+5*60000):null]);
   await c.query('UPDATE receivable_reminder_attempts SET outcome=$2,result_code=$3,finished_at=$4 WHERE claim_token=$1',[claim.token,result.outcome,code||null,finished]);
   if(claim.reportId)await c.query('UPDATE reminder_subscription_reports SET state=$2 WHERE id=$1',[claim.reportId,result.outcome==='not_sent'&&code!=='43101'?'available':code==='43101'?'rejected':'consumed']);
   return true;
  });
 }
 async runOnce(){
  await this.enqueueToday();const now=this.store.clock(),day=today(now),values=[this.sender.channel,day,now];
  const candidates="channel=$1 AND reminder_date=$2 AND created_at<=$3 AND state IN('queued','retryable','unavailable','skipped') AND attempt_count<3 AND (retry_at IS NULL OR retry_at<=$3)";
  const end=(await this.store.db.query(`SELECT r.created_at::text AS created_at,r.id FROM receivable_reminders r WHERE ${candidates} ORDER BY r.created_at DESC,r.id DESC LIMIT 1`,values)).rows[0];
  if(!end)return {attempted:0};let cursor:{created_at:string;id:string}|undefined,attempted=0;
  // Text cursors retain PostgreSQL microseconds.
  // Unavailable/skipped records stay eligible for recovery. Move past their stable key,
  // rather than letting the same first page occupy every worker cycle.
  for(;;){
   const rows=(await this.store.db.query(`SELECT r.created_at::text AS created_at,r.id FROM receivable_reminders r WHERE ${candidates} AND ($4::timestamptz IS NULL OR (created_at,id)>($4::timestamptz,$5::uuid)) AND (created_at,id)<=($6::timestamptz,$7::uuid) ORDER BY r.created_at,r.id LIMIT 100`,[...values,cursor?.created_at||null,cursor?.id||null,end.created_at,end.id])).rows;
   if(!rows.length)break;for(const row of rows)if(await this.dispatch(row.id))attempted++;
   cursor=rows[rows.length-1];if(rows.length<100||today(this.store.clock())!==day)break;
  }
  return {attempted};
 }
}
