import type {Actor} from '../auth/auth';
import type {DashboardStage,SalesDashboard} from '../../../../packages/contracts/src/dashboard';
import {CoreStore} from './store';
import {ensure} from './errors';
import {today} from './validation';

// Both panels and their uncapped totals come from one PostgreSQL statement snapshot.
const dashboardSql=`WITH scoped AS (
 SELECT o.id AS order_id,o.order_no,h.name AS hospital_name,o.received_date,r.revision_no,
 (SELECT count(*)::integer FROM purchase_order_lines l WHERE l.revision_id=r.id) AS line_count,
 live.valid_supplier_count,
 CASE WHEN o.status='draft' THEN 'review' WHEN o.status='quote_draft' THEN 'pricing'
 WHEN o.status='quote_exported' THEN 'exported' WHEN o.status='quote_sent' THEN 'sent'
 WHEN live.valid_supplier_count>0 THEN 'ready' ELSE 'inquiry' END AS stage
 FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id
 JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no
 CROSS JOIN LATERAL(SELECT count(*)::integer AS valid_supplier_count FROM supplier_tasks t
 JOIN supplier_quote_submissions s ON s.task_id=t.id AND s.status='current'
 WHERE t.revision_id=r.id AND t.status='submitted' AND s.valid_until>=$2::date) live
 WHERE o.sales_user_id=$1 AND o.entry_mode='normal' AND o.status IN('draft','frozen','quote_draft','quote_exported','quote_sent')
 AND (o.submission_source<>'hospital_self' OR o.hospital_submitted_at IS NOT NULL)
), task_page AS (
 SELECT * FROM scoped ORDER BY CASE stage WHEN 'review' THEN 0 WHEN 'ready' THEN 1 WHEN 'pricing' THEN 2 WHEN 'exported' THEN 3 WHEN 'sent' THEN 4 ELSE 5 END,received_date,order_no,order_id LIMIT 20
), outstanding AS (
 SELECT ar.id AS receivable_id,o.id AS order_id,o.order_no,h.name AS hospital_name,ar.due_date,
 ar.amount::text AS amount,COALESCE(p.amount,0)::numeric(12,2)::text AS paid,
 ar.amount-COALESCE(p.amount,0) AS balance,
 EXISTS(SELECT 1 FROM receivable_exceptions e WHERE e.receivable_id=ar.id AND e.status='pending_verification') AS paused,
 GREATEST(0,$2::date-ar.due_date) AS overdue_days
 FROM receivables ar JOIN purchase_orders o ON o.id=ar.purchase_order_id JOIN hospitals h ON h.id=o.hospital_id
 LEFT JOIN LATERAL(SELECT sum(amount) AS amount FROM payment_records WHERE receivable_id=ar.id AND status='active') p ON true
 WHERE o.sales_user_id=$1 AND o.status<>'voided' AND ar.amount>COALESCE(p.amount,0)
), follow_up AS (SELECT * FROM outstanding WHERE due_date<=$2::date), receivable_page AS (
 SELECT * FROM follow_up ORDER BY paused,due_date,order_no,receivable_id LIMIT 10
)
SELECT (SELECT count(*)::integer FROM scoped) AS task_total,
 COALESCE((SELECT jsonb_object_agg(stage,n) FROM(SELECT stage,count(*)::integer AS n FROM scoped GROUP BY stage) counts),'{}'::jsonb) AS counts,
 COALESCE((SELECT jsonb_agg(to_jsonb(task_page) ORDER BY CASE stage WHEN 'review' THEN 0 WHEN 'ready' THEN 1 WHEN 'pricing' THEN 2 WHEN 'exported' THEN 3 WHEN 'sent' THEN 4 ELSE 5 END,received_date,order_no,order_id) FROM task_page),'[]'::jsonb) AS tasks,
 (SELECT count(*)::integer FROM outstanding) AS outstanding_count,
 (SELECT COALESCE(sum(balance),0)::numeric::text FROM outstanding) AS outstanding_balance,
 (SELECT count(*)::integer FROM follow_up WHERE NOT paused AND due_date=$2::date) AS due_count,
 (SELECT COALESCE(sum(balance),0)::numeric::text FROM follow_up WHERE NOT paused AND due_date=$2::date) AS due_balance,
 (SELECT count(*)::integer FROM follow_up WHERE NOT paused AND due_date<$2::date) AS overdue_count,
 (SELECT COALESCE(sum(balance),0)::numeric::text FROM follow_up WHERE NOT paused AND due_date<$2::date) AS overdue_balance,
 (SELECT count(*)::integer FROM outstanding WHERE paused) AS paused_count,
 (SELECT COALESCE(sum(balance),0)::numeric::text FROM outstanding WHERE paused) AS paused_balance,
 (SELECT count(*)::integer FROM follow_up) AS follow_up_count,
 COALESCE((SELECT jsonb_agg(to_jsonb(receivable_page)||jsonb_build_object('balance',balance::numeric::text) ORDER BY paused,due_date,order_no,receivable_id) FROM receivable_page),'[]'::jsonb) AS receivables`;
// SQL sum may exceed the per-order money bound; preserve exact cents without float coercion.
const money=(value:string)=>value.includes('.')?value.padEnd(value.indexOf('.')+3,'0'):value+'.00';
export class DashboardService {
 constructor(readonly store:CoreStore){}
 async get(actor:Actor):Promise<SalesDashboard>{return this.store.db.transaction(async c=>{
  await this.store.active(c,actor);ensure(actor.role==='salesperson',403,'ROLE_FORBIDDEN','销售工作台仅供销售员查看本人待办');
  const now=this.store.clock(),businessDate=today(now),r=(await c.query(dashboardSql,[actor.id,businessDate])).rows[0];
  const counts:Record<DashboardStage,number>={review:0,inquiry:0,ready:0,pricing:0,exported:0,sent:0,...r.counts};
  return {asOf:now.toISOString(),businessDate,tasks:{total:r.task_total,limit:20,counts,items:r.tasks.map((t:any)=>({orderId:t.order_id,orderNo:t.order_no,hospitalName:t.hospital_name,receivedDate:t.received_date,revisionNo:t.revision_no,stage:t.stage,lineCount:t.line_count,validSupplierCount:t.valid_supplier_count}))},
   receivables:{outstandingCount:r.outstanding_count,outstandingBalance:money(r.outstanding_balance),dueCount:r.due_count,dueBalance:money(r.due_balance),overdueCount:r.overdue_count,overdueBalance:money(r.overdue_balance),pausedCount:r.paused_count,pausedBalance:money(r.paused_balance),followUpCount:r.follow_up_count,limit:10,items:r.receivables.map((v:any)=>({receivableId:v.receivable_id,orderId:v.order_id,orderNo:v.order_no,hospitalName:v.hospital_name,dueDate:v.due_date,amount:money(v.amount),paid:money(v.paid),balance:money(v.balance),overdueDays:v.overdue_days,paused:v.paused}))}};
 });}
}
