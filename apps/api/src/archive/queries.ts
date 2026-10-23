/** Shared joins keep list, totals and detail on the same authoritative confirmation pointer. */
export const archiveRows=`SELECT o.*,h.name AS hospital_name,h.sales_user_id AS hospital_owner,
 r.id AS revision_id,r.revision_no,u.name AS owner_name,original.name AS original_owner_name,
 confirmed.document AS confirmed_document,confirmed.id AS confirmed_version_id,
 ar.amount::text AS ar_amount,ar.due_date AS ar_due_date
 FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id
 JOIN purchase_order_revisions r ON r.purchase_order_id=o.id AND r.revision_no=o.current_revision_no
 JOIN users u ON u.id=o.sales_user_id JOIN users original ON original.id=o.original_sales_user_id
 LEFT JOIN LATERAL(SELECT v.id,v.document FROM quotes q JOIN quote_versions v ON v.id=q.confirmed_version_id AND v.quote_id=q.id WHERE q.purchase_order_id=o.id ORDER BY v.confirmation_recorded_at DESC NULLS LAST,v.id DESC LIMIT 1) confirmed ON true
 LEFT JOIN receivables ar ON ar.purchase_order_id=o.id`;

// strpos performs a literal substring search: %, _ and backslash have no wildcard meaning.
export const lineMatches=`strpos(lower(pl.name),lower($7))>0 OR strpos(lower(pl.spec),lower($7))>0`;
export const archivePageSql=`WITH readable AS (
 ${archiveRows.replace('SELECT o.*','SELECT matches.matched_revisions,o.*')}, LATERAL(SELECT ARRAY(SELECT pr.revision_no FROM purchase_order_revisions pr WHERE pr.purchase_order_id=o.id AND $7<>'' AND EXISTS(SELECT 1 FROM purchase_order_lines pl WHERE pl.revision_id=pr.id AND (${lineMatches})) ORDER BY pr.revision_no) AS matched_revisions) matches
 WHERE ($2::boolean OR o.sales_user_id=$1 OR h.sales_user_id=$1)
 AND ($4::uuid IS NULL OR o.hospital_id=$4) AND ($5::date IS NULL OR o.received_date>=$5) AND ($6::date IS NULL OR o.received_date<=$6)
 AND ($7='' OR strpos(lower(o.order_no),lower($7))>0 OR cardinality(matches.matched_revisions)>0 OR EXISTS(SELECT 1 FROM quotes q WHERE q.purchase_order_id=o.id AND strpos(lower(q.quote_no),lower($7))>0))
 AND ($8::text IS NULL OR o.status=$8)
 AND ($9::text IS NULL OR $9='mine' AND NOT $2::boolean AND o.sales_user_id=$1 OR $9='readonly' AND ($2::boolean OR o.sales_user_id<>$1))
 AND ($10::text IS NULL OR $10='none' AND ar.id IS NULL OR $10='outstanding' AND ar.amount>0 OR $10='settled' AND ar.amount=0 OR $10='due' AND ar.amount>0 AND ar.due_date=$3::date OR $10='overdue' AND ar.amount>0 AND ar.due_date<$3::date)
), page AS (SELECT * FROM readable ORDER BY received_date DESC,order_no DESC,id DESC LIMIT $11 OFFSET $12)
SELECT (SELECT count(*)::integer FROM readable) AS total,
 COALESCE((SELECT jsonb_agg(to_jsonb(page) ORDER BY received_date DESC,order_no DESC,id DESC) FROM page),'[]'::jsonb) AS items`;

export const priceHistorySql=`WITH eligible AS (
 SELECT o.id AS order_id,o.order_no,q.id AS quote_id,q.quote_no,v.id AS version_id,v.version_no,v.document,v.hospital_confirmed_at,r.revision_no,v.revision_id,
 sends.sent_at,row_number() OVER(PARTITION BY o.id ORDER BY COALESCE(q.confirmed_version_id=v.id,false) DESC,sends.sent_at DESC,r.revision_no DESC,v.version_no DESC,v.id DESC) AS rank
 FROM purchase_orders o JOIN hospitals h ON h.id=o.hospital_id JOIN quotes q ON q.purchase_order_id=o.id
 JOIN quote_versions v ON v.quote_id=q.id JOIN purchase_order_revisions r ON r.id=v.revision_id
 JOIN LATERAL(SELECT max(recorded_at) AS sent_at FROM quote_sends WHERE version_id=v.id) sends ON sends.sent_at IS NOT NULL
 WHERE o.hospital_id=$3 AND ($2::boolean OR o.sales_user_id=$1 OR h.sales_user_id=$1)
 AND ($4::uuid IS NULL OR o.id<>$4) AND v.status IN('sent','confirmed') AND v.first_sent_at IS NOT NULL AND v.document IS NOT NULL
), representatives AS (SELECT * FROM eligible WHERE rank=1)
SELECT rep.*,matched.lines FROM representatives rep
JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('purchaseLineId',pl.id,'name',entry.line->>'name','spec',entry.line->>'spec','unit','kg','quantity',entry.line->>'quantity','status',entry.line->>'status','unitPrice',CASE WHEN entry.line->>'status'='missing' THEN NULL ELSE entry.line->>'unitPrice' END) ORDER BY entry.position) AS lines
 FROM jsonb_array_elements(rep.document->'lines') WITH ORDINALITY entry(line,position)
 JOIN purchase_order_lines pl ON pl.revision_id=rep.revision_id AND pl.position=(entry.line->>'position')::integer-1
 WHERE lower(regexp_replace(btrim(entry.line->>'name'),'[[:space:]]+',' ','g'))=$5
 AND lower(regexp_replace(btrim(entry.line->>'spec'),'[[:space:]]+',' ','g'))=$6 AND entry.line->>'unit'='kg') matched ON matched.lines IS NOT NULL
ORDER BY rep.sent_at DESC,rep.order_no DESC,rep.order_id DESC LIMIT 3`;
