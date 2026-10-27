ALTER TABLE hospitals ADD COLUMN row_version integer NOT NULL DEFAULT 1 CHECK(row_version>0);
ALTER TABLE purchase_orders ADD COLUMN payment_term_days_override integer CHECK(payment_term_days_override BETWEEN 0 AND 3650);
CREATE TABLE hospital_payment_term_changes(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),hospital_id uuid NOT NULL REFERENCES hospitals,
 before_term_days integer NOT NULL,after_term_days integer NOT NULL,
 recorded_by uuid NOT NULL REFERENCES users,recorded_by_name_snapshot text NOT NULL,recorded_at timestamptz NOT NULL,
 CHECK(before_term_days BETWEEN 0 AND 3650 AND after_term_days BETWEEN 0 AND 3650)
);
CREATE TABLE payment_term_adjustments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL REFERENCES purchase_orders,
 original_term_days integer NOT NULL,before_term_days integer NOT NULL,after_term_days integer NOT NULL,
 before_due_date date NOT NULL,after_due_date date NOT NULL,reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 recorded_by uuid NOT NULL REFERENCES users,recorded_by_name_snapshot text NOT NULL,recorded_at timestamptz NOT NULL,
 CHECK(original_term_days BETWEEN 0 AND 3650 AND before_term_days BETWEEN 0 AND 3650 AND after_term_days BETWEEN 0 AND 3650)
);
CREATE INDEX term_adjustment_history ON payment_term_adjustments(order_id,recorded_at,id);
CREATE FUNCTION finance_immutable_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'finance evidence cannot be changed or deleted';END $$;
CREATE TRIGGER hospital_term_guard BEFORE UPDATE OR DELETE ON hospital_payment_term_changes FOR EACH ROW EXECUTE FUNCTION finance_immutable_evidence();
CREATE TRIGGER order_term_guard BEFORE UPDATE OR DELETE ON payment_term_adjustments FOR EACH ROW EXECUTE FUNCTION finance_immutable_evidence();
CREATE TABLE receivable_exceptions(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receivable_id uuid NOT NULL REFERENCES receivables,
 exception_type text NOT NULL CHECK(exception_type IN('cancellation','refund')),
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 500),
 status text NOT NULL DEFAULT 'pending_verification' CHECK(status IN('pending_verification','resolved')),
 recorded_by uuid NOT NULL REFERENCES users,recorded_by_name_snapshot text NOT NULL,recorded_at timestamptz NOT NULL,
 verification_result text CHECK(verification_result='continue_collection'),resolve_reason text,
 resolved_by uuid REFERENCES users,resolved_by_name_snapshot text,resolved_at timestamptz,
 CHECK((status='pending_verification' AND verification_result IS NULL AND resolve_reason IS NULL AND resolved_by IS NULL AND resolved_by_name_snapshot IS NULL AND resolved_at IS NULL)
 OR (status='resolved' AND verification_result IS NOT NULL AND verification_result='continue_collection' AND resolve_reason IS NOT NULL AND length(trim(resolve_reason)) BETWEEN 1 AND 500 AND resolved_by IS NOT NULL AND resolved_by_name_snapshot IS NOT NULL AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX receivable_pending_exception ON receivable_exceptions(receivable_id) WHERE status='pending_verification';
CREATE INDEX receivable_exception_history ON receivable_exceptions(receivable_id,recorded_at,id);
CREATE FUNCTION protect_receivable_exception() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'exception evidence cannot be deleted';END IF;
 IF TG_OP='INSERT' THEN IF NEW.status<>'pending_verification' THEN RAISE EXCEPTION 'exception must be registered pending';END IF;
 ELSE
  IF ROW(NEW.id,NEW.receivable_id,NEW.exception_type,NEW.reason,NEW.recorded_by,NEW.recorded_by_name_snapshot,NEW.recorded_at) IS DISTINCT FROM ROW(OLD.id,OLD.receivable_id,OLD.exception_type,OLD.reason,OLD.recorded_by,OLD.recorded_by_name_snapshot,OLD.recorded_at) THEN RAISE EXCEPTION 'original exception evidence is immutable';END IF;
  IF OLD.status<>'pending_verification' OR NEW.status<>'resolved' THEN RAISE EXCEPTION 'exception may only resolve once';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER receivable_exception_guard BEFORE INSERT OR UPDATE OR DELETE ON receivable_exceptions FOR EACH ROW EXECUTE FUNCTION protect_receivable_exception();
-- This records the bound mini client's report; only the provider can confirm actual subscription validity.
CREATE TABLE reminder_subscription_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users,app_id text NOT NULL,template_id text NOT NULL,open_id text NOT NULL,
 idempotency_key uuid NOT NULL,decision text NOT NULL CHECK(decision IN('accept','reject')),
 source text NOT NULL DEFAULT 'client_reported' CHECK(source='client_reported'),
 state text NOT NULL CHECK(state IN('available','claimed','consumed','revoked','rejected')),
 recorded_at timestamptz NOT NULL,UNIQUE(user_id,idempotency_key)
);
CREATE INDEX reminder_available_subscription ON reminder_subscription_reports(user_id,app_id,template_id,recorded_at,id) WHERE state='available';
CREATE TABLE receivable_reminders(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),receivable_id uuid NOT NULL REFERENCES receivables,reminder_date date NOT NULL,
 channel text NOT NULL CHECK(channel IN('in_app','wechat')),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','sent','skipped','unavailable','retryable','outcome_unknown')),
 owner_id uuid REFERENCES users,attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 claim_token uuid,subscription_report_id uuid REFERENCES reminder_subscription_reports,
 reason text,created_at timestamptz NOT NULL,attempted_at timestamptz,sent_at timestamptz,retry_at timestamptz,
 UNIQUE(receivable_id,reminder_date,channel),CHECK(state<>'sent' OR sent_at IS NOT NULL)
);
CREATE INDEX receivable_reminder_dispatch ON receivable_reminders(reminder_date,channel,state,retry_at);
CREATE TABLE receivable_reminder_attempts(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),reminder_id uuid NOT NULL REFERENCES receivable_reminders,
 attempt_no integer NOT NULL,owner_id uuid NOT NULL REFERENCES users,claim_token uuid UNIQUE NOT NULL,
 started_at timestamptz NOT NULL,outcome text NOT NULL DEFAULT 'outcome_unknown' CHECK(outcome IN('sent','not_sent','outcome_unknown','skipped')),
 result_code text,finished_at timestamptz,UNIQUE(reminder_id,attempt_no)
);
CREATE FUNCTION protect_finance_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.action LIKE 'finance.%' THEN RAISE EXCEPTION 'finance audit cannot be changed or deleted';END IF;
 IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;
END $$;
CREATE TRIGGER finance_audit_guard BEFORE UPDATE OR DELETE ON audit_records FOR EACH ROW EXECUTE FUNCTION protect_finance_audit();
CREATE FUNCTION protect_reminder_attempt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'reminder attempt evidence cannot be deleted';END IF;
 IF ROW(NEW.id,NEW.reminder_id,NEW.attempt_no,NEW.owner_id,NEW.claim_token,NEW.started_at) IS DISTINCT FROM ROW(OLD.id,OLD.reminder_id,OLD.attempt_no,OLD.owner_id,OLD.claim_token,OLD.started_at) OR OLD.finished_at IS NOT NULL OR NEW.finished_at IS NULL THEN RAISE EXCEPTION 'reminder attempt may only finish once';END IF;RETURN NEW;
END $$;
CREATE TRIGGER reminder_attempt_guard BEFORE UPDATE OR DELETE ON receivable_reminder_attempts FOR EACH ROW EXECUTE FUNCTION protect_reminder_attempt();
CREATE FUNCTION protect_subscription_report() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'subscription report evidence cannot be deleted';END IF;
 IF ROW(NEW.id,NEW.user_id,NEW.app_id,NEW.template_id,NEW.open_id,NEW.idempotency_key,NEW.decision,NEW.source,NEW.recorded_at) IS DISTINCT FROM ROW(OLD.id,OLD.user_id,OLD.app_id,OLD.template_id,OLD.open_id,OLD.idempotency_key,OLD.decision,OLD.source,OLD.recorded_at) THEN RAISE EXCEPTION 'original subscription report is immutable';END IF;RETURN NEW;
END $$;
CREATE TRIGGER subscription_report_guard BEFORE UPDATE OR DELETE ON reminder_subscription_reports FOR EACH ROW EXECUTE FUNCTION protect_subscription_report();
