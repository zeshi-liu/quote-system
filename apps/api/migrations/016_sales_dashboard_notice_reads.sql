-- Read state belongs to a salesperson and one immutable business event, never a time watermark.
CREATE TABLE sales_dashboard_notice_reads (
 sales_user_id uuid NOT NULL REFERENCES users(id),
 event_kind text NOT NULL CHECK(event_kind IN('hospital_purchase','supplier_quote')),
 event_id uuid NOT NULL,
 read_at timestamptz NOT NULL,
 PRIMARY KEY(sales_user_id,event_kind,event_id)
);
