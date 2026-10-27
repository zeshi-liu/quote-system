ALTER TABLE auth_sessions DROP CONSTRAINT auth_sessions_channel_check;
ALTER TABLE auth_sessions ADD CONSTRAINT auth_sessions_channel_check CHECK(channel IN('mini','trial','pc'));
-- Historical rows deliberately remain NULL: current profile names are not historical evidence.
ALTER TABLE audit_records ADD COLUMN actor_name_snapshot text;
CREATE INDEX orders_archive_date ON purchase_orders(received_date DESC,order_no DESC,id DESC);
CREATE INDEX revisions_archive_order ON purchase_order_revisions(purchase_order_id,revision_no);
CREATE INDEX quote_sends_history ON quote_sends(version_id,recorded_at DESC,id DESC);
CREATE INDEX audits_archive_order ON audit_records(purchase_order_id,created_at,id);
