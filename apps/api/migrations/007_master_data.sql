ALTER TABLE users ADD COLUMN phone text;
ALTER TABLE users ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE users ADD COLUMN access_scope_version integer NOT NULL DEFAULT 1 CHECK(access_scope_version>0);
ALTER TABLE users ADD COLUMN password_setup_required boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN temporary_password_expires_at timestamptz;
CREATE UNIQUE INDEX hospital_phone_unique ON users(phone) WHERE role='hospital' AND phone IS NOT NULL;
ALTER TABLE hospitals ADD COLUMN active boolean NOT NULL DEFAULT true;
ALTER TABLE hospitals ADD COLUMN IF NOT EXISTS row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE manufacturers ADD COLUMN contact_name text NOT NULL DEFAULT '';
ALTER TABLE manufacturers ADD COLUMN contact_phone text NOT NULL DEFAULT '';
ALTER TABLE manufacturers ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
CREATE OR REPLACE FUNCTION advance_auth_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.role,NEW.active,NEW.password_hash,NEW.password_setup_required,NEW.temporary_password_expires_at) IS DISTINCT FROM ROW(OLD.role,OLD.active,OLD.password_hash,OLD.password_setup_required,OLD.temporary_password_expires_at) OR NEW.auth_version>OLD.auth_version THEN
  NEW.auth_version:=OLD.auth_version+1;
 ELSE NEW.auth_version:=OLD.auth_version;
 END IF;
 RETURN NEW;
END $$;
CREATE TABLE password_setup_tickets(token_hash text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users,auth_version integer NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz);
CREATE INDEX password_setup_tickets_user ON password_setup_tickets(user_id);
CREATE TABLE items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,category text NOT NULL DEFAULT '',active boolean NOT NULL DEFAULT true,row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0));
CREATE TABLE item_aliases(item_id uuid NOT NULL REFERENCES items,alias text NOT NULL CHECK(length(trim(alias))>0),PRIMARY KEY(item_id,alias));
CREATE INDEX item_alias_search ON item_aliases(lower(alias));
CREATE TABLE item_variants(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),item_id uuid NOT NULL REFERENCES items,specification text NOT NULL DEFAULT '',origin text NOT NULL DEFAULT '',grade text NOT NULL DEFAULT '',package_description text NOT NULL DEFAULT '',default_unit text NOT NULL DEFAULT 'kg' CHECK(default_unit='kg'),active boolean NOT NULL DEFAULT true,row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),UNIQUE(id,item_id));
CREATE TABLE quote_templates(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,seller_name text NOT NULL,contact_phone text NOT NULL DEFAULT '',fixed_notes text NOT NULL DEFAULT '',logo_file_id uuid,active boolean NOT NULL DEFAULT true,is_default boolean NOT NULL DEFAULT false,row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0),CHECK(NOT is_default OR active));
CREATE UNIQUE INDEX quote_template_default ON quote_templates(is_default) WHERE is_default;
CREATE TABLE product_source_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),manufacturer_id uuid NOT NULL REFERENCES manufacturers,batch_no text UNIQUE NOT NULL,source_batch_no text NOT NULL DEFAULT '',quoted_at date NOT NULL,source_type text NOT NULL CHECK(source_type IN('manual','excel')),source_file_id uuid,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','confirmed','voided')),total_rows integer NOT NULL,valid_rows integer NOT NULL,invalid_rows integer NOT NULL,created_by uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL,preview_snapshot jsonb NOT NULL,row_version integer NOT NULL DEFAULT 1,void_reason text,voided_by uuid REFERENCES users,voided_at timestamptz,CHECK((status IN('draft','confirmed') AND void_reason IS NULL AND voided_by IS NULL AND voided_at IS NULL) OR (status='voided' AND length(trim(void_reason))>0 AND voided_by IS NOT NULL AND voided_at IS NOT NULL)));
CREATE TABLE product_source_lines(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES product_source_batches,row_number integer NOT NULL,raw_item_name text NOT NULL,item_id uuid REFERENCES items,item_variant_id uuid REFERENCES item_variants,specification text NOT NULL DEFAULT '',origin text NOT NULL DEFAULT '',grade text NOT NULL DEFAULT '',unit text NOT NULL CHECK(unit='kg'),reference_price numeric(12,2) NOT NULL CHECK(reference_price>0),status text NOT NULL CHECK(status IN('valid','unmatched','duplicate')),remark text NOT NULL DEFAULT '',UNIQUE(batch_id,row_number),FOREIGN KEY(item_variant_id,item_id) REFERENCES item_variants(id,item_id));
CREATE FUNCTION preserve_source_batch() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'source batches are retained permanently';END IF;
 IF NOT (OLD.status='draft' AND NEW.status='confirmed' OR OLD.status='confirmed' AND NEW.status='voided') OR ROW(NEW.id,NEW.manufacturer_id,NEW.batch_no,NEW.source_batch_no,NEW.quoted_at,NEW.source_type,NEW.source_file_id,NEW.total_rows,NEW.valid_rows,NEW.invalid_rows,NEW.created_by,NEW.created_at,NEW.preview_snapshot) IS DISTINCT FROM ROW(OLD.id,OLD.manufacturer_id,OLD.batch_no,OLD.source_batch_no,OLD.quoted_at,OLD.source_type,OLD.source_file_id,OLD.total_rows,OLD.valid_rows,OLD.invalid_rows,OLD.created_by,OLD.created_at,OLD.preview_snapshot) THEN RAISE EXCEPTION 'confirmed source evidence is immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER source_batch_guard BEFORE UPDATE OR DELETE ON product_source_batches FOR EACH ROW EXECUTE FUNCTION preserve_source_batch();
CREATE FUNCTION preserve_source_line() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM product_source_batches WHERE id=NEW.batch_id AND status='draft') THEN RETURN NEW;END IF;RAISE EXCEPTION 'confirmed source lines are immutable';END $$;
CREATE TRIGGER source_line_guard BEFORE INSERT OR UPDATE OR DELETE ON product_source_lines FOR EACH ROW EXECUTE FUNCTION preserve_source_line();
CREATE TABLE sales_handoff_batches(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),from_sales_user_id uuid NOT NULL REFERENCES users,to_sales_user_id uuid NOT NULL REFERENCES users,reason text NOT NULL,performed_by uuid NOT NULL REFERENCES users,performed_at timestamptz NOT NULL,scope jsonb NOT NULL,result jsonb NOT NULL);
CREATE TABLE sales_handoff_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES sales_handoff_batches,purchase_order_id uuid NOT NULL REFERENCES purchase_orders,from_sales_user_id uuid NOT NULL REFERENCES users,to_sales_user_id uuid NOT NULL REFERENCES users,before_snapshot jsonb NOT NULL,after_snapshot jsonb NOT NULL,UNIQUE(batch_id,purchase_order_id));
