CREATE TABLE source_files(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purpose text NOT NULL CHECK(purpose IN('purchase_image','purchase_excel','historical_attachment','payment_proof','manufacturer_source','template_logo')),
 reference_kind text NOT NULL CHECK(reference_kind IN('purchase_revision','historical_order','payment_record','manufacturer','template')),
 order_id uuid REFERENCES purchase_orders,revision_id uuid,payment_record_id uuid REFERENCES payment_records,manufacturer_id uuid REFERENCES manufacturers,
 file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 200),mime_type text NOT NULL,
 file_type text NOT NULL CHECK(file_type IN('png','jpg','jpeg','xlsx','xls','csv')),byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 20971520),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),object_key text NOT NULL UNIQUE,
 uploaded_by uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL,parent_file_id uuid REFERENCES source_files,
 FOREIGN KEY(revision_id,order_id) REFERENCES purchase_order_revisions(id,purchase_order_id),
 CHECK((reference_kind='purchase_revision' AND order_id IS NOT NULL AND revision_id IS NOT NULL AND payment_record_id IS NULL AND manufacturer_id IS NULL AND purpose IN('purchase_image','purchase_excel'))
 OR(reference_kind='historical_order' AND order_id IS NOT NULL AND revision_id IS NULL AND payment_record_id IS NULL AND manufacturer_id IS NULL AND purpose='historical_attachment')
 OR(reference_kind='payment_record' AND order_id IS NOT NULL AND revision_id IS NULL AND payment_record_id IS NOT NULL AND manufacturer_id IS NULL AND purpose='payment_proof')
 OR(reference_kind='manufacturer' AND order_id IS NULL AND revision_id IS NULL AND payment_record_id IS NULL AND manufacturer_id IS NOT NULL AND purpose='manufacturer_source')
 OR(reference_kind='template' AND order_id IS NULL AND revision_id IS NULL AND payment_record_id IS NULL AND manufacturer_id IS NULL AND purpose='template_logo'))
);
CREATE INDEX source_files_order ON source_files(order_id,created_at,id);
CREATE INDEX source_files_manufacturer ON source_files(manufacturer_id,created_at,id);
CREATE FUNCTION preserve_source_file() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private source evidence is immutable';END $$;
CREATE TRIGGER source_file_guard BEFORE UPDATE OR DELETE ON source_files FOR EACH ROW EXECUTE FUNCTION preserve_source_file();
CREATE TABLE source_download_grants(token_hash text PRIMARY KEY,file_id uuid NOT NULL REFERENCES source_files,user_id uuid NOT NULL REFERENCES users,session_id uuid NOT NULL REFERENCES auth_sessions,expires_at timestamptz NOT NULL);
CREATE INDEX source_download_grants_expiry ON source_download_grants(expires_at);
CREATE TABLE source_parsing_jobs(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),file_id uuid NOT NULL UNIQUE REFERENCES source_files,created_by uuid NOT NULL REFERENCES users,
 parser_type text NOT NULL CHECK(parser_type IN('spreadsheet','ocr')),status text NOT NULL DEFAULT 'pending' CHECK(status IN('pending','processing','succeeded','failed')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),claim_generation integer NOT NULL DEFAULT 0,
 lease_until timestamptz,error_code text,error_message text,retryable boolean NOT NULL DEFAULT false,result_unknown boolean NOT NULL DEFAULT false,
 raw_rows jsonb,confidence numeric CHECK(confidence BETWEEN 0 AND 1),created_at timestamptz NOT NULL,completed_at timestamptz,
 applied_result jsonb,applied_hash text,
 CHECK((applied_result IS NULL)=(applied_hash IS NULL)),CHECK(status<>'succeeded' OR raw_rows IS NOT NULL)
);
CREATE INDEX source_parsing_pending ON source_parsing_jobs(status,created_at,id);
ALTER TABLE purchase_order_lines ADD COLUMN source_file_id uuid REFERENCES source_files;
ALTER TABLE purchase_order_lines ADD COLUMN parsing_job_id uuid REFERENCES source_parsing_jobs;
ALTER TABLE purchase_order_lines ADD COLUMN source_row_number integer;
CREATE UNIQUE INDEX parsed_purchase_line_unique ON purchase_order_lines(parsing_job_id,source_row_number) WHERE parsing_job_id IS NOT NULL;
