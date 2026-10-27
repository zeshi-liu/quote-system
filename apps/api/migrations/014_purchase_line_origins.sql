-- Source is an input provenance tag, never a price source for quotation.
ALTER TABLE purchase_order_lines ADD COLUMN source_type text NOT NULL DEFAULT 'custom_input' CHECK(source_type IN('ocr','excel','product_library','custom_input'));
ALTER TABLE purchase_order_lines ADD COLUMN item_id uuid REFERENCES items;
ALTER TABLE purchase_order_lines ADD COLUMN item_variant_id uuid;
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_line_variant_item FOREIGN KEY(item_variant_id,item_id) REFERENCES item_variants(id,item_id);
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_line_variant_requires_item CHECK(item_variant_id IS NULL OR item_id IS NOT NULL);
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_line_catalog_reference CHECK(source_type<>'product_library' OR item_id IS NOT NULL);
-- Only metadata is backfilled. Frozen requirement/price facts remain unchanged.
ALTER TABLE purchase_order_lines DISABLE TRIGGER frozen_lines_guard;
UPDATE purchase_order_lines l SET source_type=CASE WHEN j.parser_type='ocr' THEN 'ocr' ELSE 'excel' END FROM source_parsing_jobs j WHERE l.parsing_job_id=j.id AND l.source_file_id=j.file_id AND l.source_row_number IS NOT NULL;
ALTER TABLE purchase_order_lines ENABLE TRIGGER frozen_lines_guard;
ALTER TABLE purchase_order_lines ADD CONSTRAINT purchase_line_parse_reference CHECK(source_type NOT IN('ocr','excel') OR (source_file_id IS NOT NULL AND parsing_job_id IS NOT NULL AND source_row_number IS NOT NULL));
