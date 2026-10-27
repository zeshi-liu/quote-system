-- Missing source labels are legacy sales entry, never an implicit hospital edit grant.
ALTER TABLE purchase_orders ADD COLUMN submission_source text NOT NULL DEFAULT 'sales_entry' CHECK(submission_source IN('sales_entry','hospital_self'));
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS hospital_submitted_at timestamptz;
ALTER TABLE purchase_order_lines ADD COLUMN purchase_remark text NOT NULL DEFAULT '' CHECK(length(purchase_remark)<=500);
