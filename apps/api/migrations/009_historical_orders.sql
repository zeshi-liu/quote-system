-- History is a distinct internal source. Unknown draft values must remain unknown.
ALTER TABLE purchase_orders ADD COLUMN entry_mode text NOT NULL DEFAULT 'normal' CHECK(entry_mode IN('normal','historical_backfill'));
ALTER TABLE purchase_orders ALTER COLUMN purchaser_user_id DROP NOT NULL;
ALTER TABLE purchase_orders ALTER COLUMN received_date DROP NOT NULL;
ALTER TABLE purchase_orders ALTER COLUMN payment_term_days DROP NOT NULL;
ALTER TABLE purchase_orders ADD CONSTRAINT normal_order_required_fields CHECK(entry_mode='historical_backfill' OR (purchaser_user_id IS NOT NULL AND received_date IS NOT NULL AND payment_term_days IS NOT NULL));
CREATE TABLE historical_order_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid NOT NULL UNIQUE REFERENCES purchase_orders,
 verification_status text NOT NULL DEFAULT 'draft' CHECK(verification_status IN('draft','pending_verification','verified')),
 original_order_no text NOT NULL DEFAULT '',original_handler text NOT NULL DEFAULT '',
 historical_confirmed_date date,historical_confirmed_amount numeric(12,2) CHECK(historical_confirmed_amount>=0),
 historical_confirmed_amount_override numeric(12,2) CHECK(historical_confirmed_amount_override>=0),
 historical_paid_amount_snapshot numeric(12,2) CHECK(historical_paid_amount_snapshot>=0),
 verification_basis text NOT NULL DEFAULT '',verification_note text NOT NULL DEFAULT '',evidence_file_ids jsonb NOT NULL DEFAULT '[]',
 draft_lines jsonb NOT NULL DEFAULT '[]',verified_revision_id uuid,
 created_by uuid NOT NULL REFERENCES users,created_at timestamptz NOT NULL,verified_by uuid REFERENCES users,verified_at timestamptz,
 UNIQUE(id,purchase_order_id),UNIQUE(id,verified_revision_id),
 FOREIGN KEY(verified_revision_id,purchase_order_id) REFERENCES purchase_order_revisions(id,purchase_order_id),
 CHECK(jsonb_typeof(evidence_file_ids)='array' AND jsonb_typeof(draft_lines)='array'),
 CHECK((verification_status='verified' AND verified_revision_id IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL AND historical_confirmed_amount IS NOT NULL AND historical_paid_amount_snapshot IS NOT NULL AND historical_paid_amount_snapshot<=historical_confirmed_amount AND length(trim(verification_basis))>0 AND length(trim(verification_note))>0) OR (verification_status<>'verified' AND verified_revision_id IS NULL AND verified_by IS NULL AND verified_at IS NULL AND historical_confirmed_amount_override IS NULL))
);
CREATE TABLE historical_order_line_results(
 record_id uuid NOT NULL,revision_id uuid NOT NULL,purchase_line_id uuid PRIMARY KEY,
 supply_status text NOT NULL CHECK(supply_status IN('unknown','priced','missing')),
 confirmed_quantity numeric(12,2) CHECK(confirmed_quantity>=0),missing_quantity numeric(12,2) CHECK(missing_quantity>=0),unit_price numeric(12,2) CHECK(unit_price>0),
 FOREIGN KEY(record_id,revision_id) REFERENCES historical_order_records(id,verified_revision_id),
 FOREIGN KEY(purchase_line_id,revision_id) REFERENCES purchase_order_lines(id,revision_id),
 CHECK(supply_status<>'unknown' OR (confirmed_quantity IS NULL AND missing_quantity IS NULL)),
 CHECK(supply_status<>'missing' OR (confirmed_quantity=0 AND confirmed_quantity IS NOT NULL AND missing_quantity IS NOT NULL AND unit_price IS NULL))
);
CREATE TABLE historical_amount_corrections(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),purchase_order_id uuid NOT NULL REFERENCES purchase_orders,record_id uuid NOT NULL,
 original_verified_amount numeric(12,2) NOT NULL CHECK(original_verified_amount>=0),before_amount numeric(12,2) NOT NULL CHECK(before_amount>=0),after_amount numeric(12,2) NOT NULL CHECK(after_amount>=0),paid_at_correction numeric(12,2) NOT NULL CHECK(paid_at_correction>=0 AND after_amount>=paid_at_correction),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),verification_basis text NOT NULL CHECK(length(trim(verification_basis)) BETWEEN 1 AND 2000),verification_note text NOT NULL CHECK(length(trim(verification_note)) BETWEEN 1 AND 2000),evidence_file_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(evidence_file_ids)='array'),
 recorded_by uuid NOT NULL REFERENCES users,recorded_by_name_snapshot text NOT NULL,recorded_at timestamptz NOT NULL,
 FOREIGN KEY(record_id,purchase_order_id) REFERENCES historical_order_records(id,purchase_order_id)
);
CREATE INDEX historical_corrections_history ON historical_amount_corrections(purchase_order_id,recorded_at,id);
ALTER TABLE receivables ALTER COLUMN confirmed_version_id DROP NOT NULL;
ALTER TABLE receivables ADD COLUMN source_type text NOT NULL DEFAULT 'quote_confirmation' CHECK(source_type IN('quote_confirmation','historical_verified'));
ALTER TABLE receivables ADD COLUMN historical_record_id uuid UNIQUE;
ALTER TABLE receivables ADD CONSTRAINT receivable_historical_source FOREIGN KEY(historical_record_id,purchase_order_id) REFERENCES historical_order_records(id,purchase_order_id);
ALTER TABLE receivables ADD CONSTRAINT receivable_exactly_one_source CHECK((source_type='quote_confirmation' AND confirmed_version_id IS NOT NULL AND historical_record_id IS NULL) OR (source_type='historical_verified' AND confirmed_version_id IS NULL AND historical_record_id IS NOT NULL));
CREATE FUNCTION protect_historical_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'historical evidence cannot be changed or deleted';END $$;
CREATE TRIGGER historical_results_guard BEFORE UPDATE OR DELETE ON historical_order_line_results FOR EACH ROW EXECUTE FUNCTION protect_historical_evidence();
CREATE TRIGGER historical_corrections_guard BEFORE UPDATE OR DELETE ON historical_amount_corrections FOR EACH ROW EXECUTE FUNCTION protect_historical_evidence();
CREATE FUNCTION protect_historical_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'historical records cannot be deleted';END IF;
 IF NOT EXISTS(SELECT 1 FROM purchase_orders WHERE id=NEW.purchase_order_id AND entry_mode='historical_backfill') THEN RAISE EXCEPTION 'history requires a historical order';END IF;
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.purchase_order_id,NEW.created_by,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.purchase_order_id,OLD.created_by,OLD.created_at) THEN RAISE EXCEPTION 'historical source is immutable';END IF;
  IF OLD.verification_status='verified' AND (to_jsonb(NEW)-'historical_confirmed_amount_override') IS DISTINCT FROM (to_jsonb(OLD)-'historical_confirmed_amount_override') THEN RAISE EXCEPTION 'original historical verification is immutable';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_record_guard BEFORE INSERT OR UPDATE OR DELETE ON historical_order_records FOR EACH ROW EXECUTE FUNCTION protect_historical_record();
CREATE FUNCTION protect_order_entry_mode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.entry_mode IS DISTINCT FROM OLD.entry_mode THEN RAISE EXCEPTION 'order entry mode is immutable';END IF;
 IF OLD.entry_mode='historical_backfill' AND EXISTS(SELECT 1 FROM historical_order_records WHERE purchase_order_id=OLD.id AND verification_status='verified') AND ROW(NEW.hospital_id,NEW.purchaser_user_id,NEW.received_date,NEW.payment_term_days,NEW.current_revision_no) IS DISTINCT FROM ROW(OLD.hospital_id,OLD.purchaser_user_id,OLD.received_date,OLD.payment_term_days,OLD.current_revision_no) THEN RAISE EXCEPTION 'verified historical original fields are immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_entry_mode_guard BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION protect_order_entry_mode();
CREATE FUNCTION validate_receivable_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.source_type='historical_verified' THEN
  IF NOT EXISTS(SELECT 1 FROM historical_order_records h JOIN purchase_orders o ON o.id=h.purchase_order_id WHERE h.id=NEW.historical_record_id AND o.id=NEW.purchase_order_id AND o.entry_mode='historical_backfill' AND h.verification_status='verified') THEN RAISE EXCEPTION 'receivable requires verified historical evidence';END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM purchase_orders o JOIN quotes q ON q.purchase_order_id=o.id JOIN quote_versions v ON v.quote_id=q.id WHERE o.id=NEW.purchase_order_id AND o.entry_mode='normal' AND v.id=NEW.confirmed_version_id) THEN RAISE EXCEPTION 'quote receivable source must belong to normal order';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receivable_source_guard BEFORE INSERT OR UPDATE ON receivables FOR EACH ROW EXECUTE FUNCTION validate_receivable_source();

CREATE FUNCTION protect_historical_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.action LIKE 'historical.%' THEN RAISE EXCEPTION 'historical audit cannot be changed or deleted';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER historical_audit_guard BEFORE UPDATE OR DELETE ON audit_records FOR EACH ROW EXECUTE FUNCTION protect_historical_audit();
