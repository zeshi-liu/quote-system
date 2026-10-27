// Money mutations call this only after both the root order and receivable locks.
// A fresh statement is essential under PostgreSQL READ COMMITTED after lock waits.
export const effectivePaidSql="SELECT COALESCE(sum(amount),0)::numeric(12,2)::text AS paid FROM payment_records WHERE receivable_id=$1 AND status='active'";
export const receivableRows=`SELECT ar.id,ar.purchase_order_id,ar.amount::text AS amount,ar.payment_term_days,o.payment_term_days AS original_term_days,EXISTS(SELECT 1 FROM receivable_exceptions e WHERE e.receivable_id=ar.id AND e.status='pending_verification') AS paused,ar.due_date,o.order_no,o.hospital_id,o.received_date,o.sales_user_id,o.row_version,o.status AS order_status,h.name AS hospital_name,h.sales_user_id AS hospital_owner,u.name AS owner_name,
 COALESCE(paid.amount,0)::numeric(12,2)::text AS paid,(ar.amount-COALESCE(paid.amount,0))::numeric(12,2)::text AS balance
 FROM receivables ar JOIN purchase_orders o ON o.id=ar.purchase_order_id JOIN hospitals h ON h.id=o.hospital_id JOIN users u ON u.id=o.sales_user_id
 LEFT JOIN LATERAL(SELECT sum(p.amount) AS amount FROM payment_records p WHERE p.receivable_id=ar.id AND p.status='active') paid ON true`;
export const receivablePageSql=`WITH readable AS (
 ${receivableRows}
 WHERE ($2::boolean OR o.sales_user_id=$1 OR h.sales_user_id=$1)
 AND ($4::uuid IS NULL OR o.hospital_id=$4) AND ($5::date IS NULL OR o.received_date>=$5) AND ($6::date IS NULL OR o.received_date<=$6)
 AND ($7='' OR strpos(lower(o.order_no),lower($7))>0 OR strpos(lower(h.name),lower($7))>0 OR EXISTS(SELECT 1 FROM purchase_order_revisions r JOIN purchase_order_lines l ON l.revision_id=r.id WHERE r.purchase_order_id=o.id AND (strpos(lower(l.name),lower($7))>0 OR strpos(lower(l.spec),lower($7))>0)))
 AND ($8::text IS NULL OR $8='mine' AND NOT $2::boolean AND o.sales_user_id=$1 OR $8='readonly' AND ($2::boolean OR o.sales_user_id<>$1))
 AND ($9::text IS NULL OR $9='outstanding' AND ar.amount>COALESCE(paid.amount,0) OR $9='settled' AND ar.amount=COALESCE(paid.amount,0) OR $9='unpaid' AND ar.amount>0 AND COALESCE(paid.amount,0)=0 OR $9='partial' AND COALESCE(paid.amount,0)>0 AND COALESCE(paid.amount,0)<ar.amount)
 AND ($10::text IS NULL OR ar.amount>COALESCE(paid.amount,0) AND ($10='upcoming' AND ar.due_date>$3::date OR $10='due' AND ar.due_date=$3::date OR $10='overdue' AND ar.due_date<$3::date))
), page AS (SELECT * FROM readable ORDER BY due_date,order_no,id LIMIT $11 OFFSET $12)
SELECT (SELECT count(*)::integer FROM readable) AS total,COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY due_date,order_no,id) FROM page),'[]'::jsonb) AS items`;
