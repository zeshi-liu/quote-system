-- Submitted hospital requirements remain evidence even when sales corrects the working revision.
ALTER TABLE purchase_orders ADD COLUMN hospital_submission_snapshot jsonb;
ALTER TABLE purchase_orders ADD CONSTRAINT hospital_submission_evidence CHECK(hospital_submission_snapshot IS NULL OR (submission_source='hospital_self' AND hospital_submitted_at IS NOT NULL));
CREATE FUNCTION preserve_hospital_submission() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.submission_source IS DISTINCT FROM OLD.submission_source THEN RAISE EXCEPTION 'purchase submission source is immutable'; END IF;
 IF OLD.hospital_submitted_at IS NOT NULL AND ROW(NEW.hospital_submitted_at,NEW.hospital_submission_snapshot) IS DISTINCT FROM ROW(OLD.hospital_submitted_at,OLD.hospital_submission_snapshot) THEN RAISE EXCEPTION 'hospital submission evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hospital_submission_guard BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION preserve_hospital_submission();
CREATE INDEX hospital_own_orders ON purchase_orders(purchaser_user_id,created_at DESC,id DESC) WHERE entry_mode='normal';
