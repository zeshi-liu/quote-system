CREATE TABLE payment_records(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receivable_id uuid NOT NULL REFERENCES receivables,
 record_type text NOT NULL DEFAULT 'regular' CHECK(record_type IN('regular','historical_opening')),
 amount numeric(12,2) NOT NULL CHECK(amount>0),paid_date date,
 remark text NOT NULL DEFAULT '' CHECK(length(remark)<=500),
 recorded_by uuid NOT NULL REFERENCES users,recorded_by_name_snapshot text NOT NULL CHECK(length(trim(recorded_by_name_snapshot))>0),recorded_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'active' CHECK(status IN('active','void')),
 void_reason text,voided_by uuid REFERENCES users,voided_by_name_snapshot text,voided_at timestamptz,
 corrects_payment_record_id uuid,
 UNIQUE(id,receivable_id),
 FOREIGN KEY(corrects_payment_record_id,receivable_id) REFERENCES payment_records(id,receivable_id),
 CHECK(record_type='historical_opening' OR paid_date IS NOT NULL),
 CHECK(corrects_payment_record_id IS NULL OR corrects_payment_record_id<>id),
 CHECK((status='active' AND void_reason IS NULL AND voided_by IS NULL AND voided_by_name_snapshot IS NULL AND voided_at IS NULL)
 OR (status='void' AND void_reason IS NOT NULL AND length(trim(void_reason)) BETWEEN 1 AND 500 AND voided_by IS NOT NULL AND voided_by_name_snapshot IS NOT NULL AND length(trim(voided_by_name_snapshot))>0 AND voided_at IS NOT NULL))
);
CREATE UNIQUE INDEX payment_active_opening ON payment_records(receivable_id) WHERE status='active' AND record_type='historical_opening';
CREATE INDEX payment_active_sum ON payment_records(receivable_id,amount) WHERE status='active';
CREATE INDEX payment_receivable_history ON payment_records(receivable_id,recorded_at,id);
CREATE INDEX receivables_due ON receivables(due_date,purchase_order_id,id);
CREATE FUNCTION protect_payment_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'payment records cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'active' THEN RAISE EXCEPTION 'payment must be registered active before voiding';END IF;
  IF NEW.corrects_payment_record_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM payment_records p WHERE p.id=NEW.corrects_payment_record_id AND p.receivable_id=NEW.receivable_id AND p.status='void' AND p.record_type=NEW.record_type) THEN RAISE EXCEPTION 'correction requires a void record of the same receivable and type';END IF;
 ELSE
  IF ROW(NEW.id,NEW.receivable_id,NEW.record_type,NEW.amount,NEW.paid_date,NEW.remark,NEW.recorded_by,NEW.recorded_by_name_snapshot,NEW.recorded_at,NEW.corrects_payment_record_id) IS DISTINCT FROM ROW(OLD.id,OLD.receivable_id,OLD.record_type,OLD.amount,OLD.paid_date,OLD.remark,OLD.recorded_by,OLD.recorded_by_name_snapshot,OLD.recorded_at,OLD.corrects_payment_record_id) THEN RAISE EXCEPTION 'original payment evidence is immutable';END IF;
  IF OLD.status<>'active' OR NEW.status<>'void' THEN RAISE EXCEPTION 'payment may only change from active to void once';END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payment_record_guard BEFORE INSERT OR UPDATE OR DELETE ON payment_records FOR EACH ROW EXECUTE FUNCTION protect_payment_record();
