/** Shared joins keep list, totals and detail on the same authoritative confirmation pointer. */
export const archiveRows=`SELECT o.*,h.name AS hospital_name,h.sales_user_id AS hospital_owner,
 r.id AS revision_id,r.revision_no,u.name AS owner_name,original.name AS original_owner_name,
 confirmed.document AS confirmed_document,confirmed.id AS confirmed_version_id,
 history.verification_status AS historical_verification_status,COALESCE(history.historical_confirmed_amount_override,history.historical_confirmed_amount)::text AS historical_amount,history.verified_revision_id AS historical_revision_id,
 ar.id AS ar_id,ar.amount::text AS ar_amount,ar.due_date AS ar_due_date,COALESCE(payments.paid,0)::numeric(12,2)::text AS ar_paid,(ar.amount-COALESCE(payments.paid,0))::numeric(12,2)::text AS ar_balance
 FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id
 JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no
 JOIN users u ON u.id=o.sales_user_id JOIN users original ON original.id=o.original_sales_user_id
 LEFT JOIN LATERAL(SELECT v.id,v.document FROM quotes q JOIN quote_versions v ON v.id=q.confirmed_version_id AND v.quote_id=q.id WHERE q.purchase_order_id=o.id ORDER BY v.confirmation_recorded_at DESC NULLS LAST,v.id DESC LIMIT 1) confirmed ON true
 LEFT JOIN historical_order_records history ON history.purchase_order_id=o.id
 LEFT JOIN receivables ar ON ar.purchase_order_id=o.id
 LEFT JOIN LATERAL(SELECT sum(p.amount) AS paid FROM payment_records p WHERE p.receivable_id=ar.id AND p.status='active') payments ON true`;

// strpos performs a literal substring search: %, _ and backslash have no wildcard meaning.
export const lineMatches=`strpos(lower(pl.name),lower($7))>0 OR strpos(lower(pl.spec),lower($7))>0`;
export const archivePageSql=`WITH readable AS (
 ${archiveRows.replace('SELECT o.*','SELECT matches.matched_revisions,o.*')}, LATERAL(SELECT ARRAY(SELECT pr.revision_no FROM purchase_order_revisions pr WHERE pr.purchase_order_id=o.id AND $7<>'' AND EXISTS(SELECT 1 FROM purchase_order_lines pl WHERE pl.revision_id=pr.id AND (${lineMatches})) ORDER BY pr.revision_no) AS matched_revisions) matches
 WHERE ($2::boolean OR o.sales_user_id=$1 OR h.sales_user_id=$1)
 AND ($4::uuid IS NULL OR o.hospital_id=$4) AND ($5::date IS NULL OR o.received_date>=$5) AND ($6::date IS NULL OR o.received_date<=$6)
 AND ($7='' OR strpos(lower(o.order_no),lower($7))>0 OR cardinality(matches.matched_revisions)>0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(history.draft_lines) hl WHERE strpos(lower(hl->>'name'),lower($7))>0 OR strpos(lower(hl->>'spec'),lower($7))>0) OR strpos(lower(history.original_order_no),lower($7))>0 OR EXISTS(SELECT 1 FROM quotes q WHERE q.purchase_order_id=o.id AND strpos(lower(q.quote_no),lower($7))>0))
 AND ($8::text IS NULL OR o.status=$8)
 AND ($9::text IS NULL OR $9='mine' AND NOT $2::boolean AND o.sales_user_id=$1 OR $9='readonly' AND ($2::boolean OR o.sales_user_id<>$1))
 AND ($10::text IS NULL OR $10='none' AND ar.id IS NULL OR $10='outstanding' AND ar.amount>COALESCE(payments.paid,0) OR $10='settled' AND ar.amount=COALESCE(payments.paid,0) OR $10='due' AND ar.amount>COALESCE(payments.paid,0) AND ar.due_date=$3::date OR $10='overdue' AND ar.amount>COALESCE(payments.paid,0) AND ar.due_date<$3::date)
), page AS (SELECT * FROM readable ORDER BY received_date DESC NULLS LAST,order_no DESC,id DESC LIMIT $11 OFFSET $12)
SELECT (SELECT count(*)::integer FROM readable) AS total,
 COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY received_date DESC NULLS LAST,order_no DESC,id DESC) FROM page),'[]'::jsonb) AS items`;

export const priceHistorySql=`WITH eligible AS (
 SELECT o.id AS order_id,o.order_no,q.id AS quote_id,q.quote_no,v.id AS version_id,v.version_no,v.document,v.hospital_confirmed_at,r.revision_no,v.revision_id,
 sends.sent_at,row_number() OVER(PARTITION BY o.id ORDER BY COALESCE(q.confirmed_version_id=v.id,false) DESC,sends.sent_at DESC,r.revision_no DESC,v.version_no DESC,v.id DESC) AS rank
 FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id JOIN quotes q ON q.purchase_order_id=o.id
 JOIN quote_versions v ON v.quote_id=q.id JOIN purchase_order_revisions r ON r.id=v.revision_id
 JOIN LATERAL(SELECT max(recorded_at) AS sent_at FROM quote_sends WHERE version_id=v.id) sends ON sends.sent_at IS NOT NULL
 WHERE o.hospital_id=$3 AND ($2::boolean OR o.sales_user_id=$1 OR h.sales_user_id=$1)
 AND ($4::uuid IS NULL OR o.id<>$4) AND v.status IN('sent','confirmed') AND v.first_sent_at IS NOT NULL AND v.document IS NOT NULL
), representatives AS (SELECT * FROM eligible WHERE rank=1), candidates AS (
 SELECT rep.order_id,pl.id AS purchase_line_id,pl.item_id,pl.item_variant_id,entry.line,entry.position,
 CASE WHEN $8::uuid IS NOT NULL AND pl.item_variant_id=$8 AND entry.line->>'unit'='kg' THEN 1
 WHEN $7::uuid IS NOT NULL AND pl.item_id=$7 AND lower(regexp_replace(btrim(COALESCE(entry.line->>'spec','')),'[[:space:]]+',' ','g'))=$6 AND entry.line->>'unit'='kg' THEN 2
 WHEN $7::uuid IS NOT NULL AND pl.item_id=$7 THEN 3
 WHEN $7::uuid IS NULL AND $8::uuid IS NULL AND lower(regexp_replace(btrim(entry.line->>'name'),'[[:space:]]+',' ','g'))=$5
 AND lower(regexp_replace(btrim(COALESCE(entry.line->>'spec','')),'[[:space:]]+',' ','g'))=$6 AND entry.line->>'unit'='kg' THEN 4 END AS match_rank
 FROM representatives rep CROSS JOIN LATERAL jsonb_array_elements(rep.document->'lines') WITH ORDINALITY entry(line,position)
 JOIN purchase_order_lines pl ON pl.revision_id=rep.revision_id AND pl.position=(entry.line->>'position')::integer-1
), ranked AS (SELECT *,min(match_rank) OVER(PARTITION BY order_id) AS best_rank FROM candidates WHERE match_rank IS NOT NULL), matched AS (
 SELECT order_id,best_rank,jsonb_agg(jsonb_build_object(
 'purchaseLineId',purchase_line_id,'itemId',item_id,'itemVariantId',item_variant_id,'name',line->>'name','spec',COALESCE(line->>'spec',''),
 'unit',COALESCE(line->>'unit',''),'quantity',line->>'quantity','status',line->>'status','unitPrice',CASE WHEN line->>'status'='missing' THEN NULL ELSE line->>'unitPrice' END,
 'match',CASE best_rank WHEN 1 THEN 'variant_exact' WHEN 2 THEN 'item_spec_exact' WHEN 3 THEN 'item_fallback' ELSE 'text_exact' END,
 'specDifference',lower(regexp_replace(btrim(COALESCE(line->>'spec','')),'[[:space:]]+',' ','g')) IS DISTINCT FROM $6,
 'unitDifference',(line->>'unit') IS DISTINCT FROM 'kg') ORDER BY position) AS lines
 FROM ranked WHERE match_rank=best_rank GROUP BY order_id,best_rank
)
SELECT rep.*,matched.best_rank,matched.lines FROM representatives rep JOIN matched USING(order_id)
ORDER BY matched.best_rank,rep.sent_at DESC,rep.order_no DESC,rep.order_id DESC LIMIT 3`;
