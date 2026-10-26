-- A new revision copies the trusted provenance of its prior frozen facts.
-- Within one revision an applied parser row remains unique; across revisions it is shared evidence.
DROP INDEX parsed_purchase_line_unique;
CREATE UNIQUE INDEX parsed_purchase_line_unique ON purchase_order_lines(revision_id,parsing_job_id,source_row_number) WHERE parsing_job_id IS NOT NULL;
