CREATE TABLE analytics_query_snapshots(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_id uuid NOT NULL REFERENCES users,session_id uuid NOT NULL REFERENCES auth_sessions,
 auth_version integer NOT NULL,access_scope_version integer NOT NULL,filters jsonb NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,CHECK(expires_at>created_at)
);
CREATE INDEX analytics_snapshots_expiry ON analytics_query_snapshots(expires_at);
CREATE TABLE analytics_query_snapshot_items(
 snapshot_id uuid NOT NULL REFERENCES analytics_query_snapshots ON DELETE CASCADE,sequence integer NOT NULL,
 purchase_order_id uuid NOT NULL REFERENCES purchase_orders,revision_id uuid NOT NULL REFERENCES purchase_order_revisions,
 cohort boolean NOT NULL,confirmation_trend boolean NOT NULL,fact jsonb NOT NULL,
 PRIMARY KEY(snapshot_id,sequence),UNIQUE(snapshot_id,purchase_order_id)
);
CREATE INDEX analytics_frozen_revision ON purchase_order_revisions(purchase_order_id,revision_no DESC) WHERE frozen_at IS NOT NULL;
-- Scope invalidation must also cover direct ownership updates, not only the admin UI.
CREATE FUNCTION analytics_scope_on_hospital_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.sales_user_id IS DISTINCT FROM OLD.sales_user_id THEN
  UPDATE users SET access_scope_version=access_scope_version+1 WHERE id IN(OLD.sales_user_id,NEW.sales_user_id);
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER analytics_hospital_scope AFTER UPDATE OF sales_user_id ON hospitals FOR EACH ROW EXECUTE FUNCTION analytics_scope_on_hospital_owner();
CREATE FUNCTION analytics_scope_on_order_owner() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.sales_user_id IS DISTINCT FROM OLD.sales_user_id OR NEW.hospital_id IS DISTINCT FROM OLD.hospital_id THEN
  UPDATE users SET access_scope_version=access_scope_version+1 WHERE id IN(OLD.sales_user_id,NEW.sales_user_id) OR id IN(SELECT sales_user_id FROM hospitals WHERE id IN(OLD.hospital_id,NEW.hospital_id));
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER analytics_order_scope AFTER UPDATE OF sales_user_id,hospital_id ON purchase_orders FOR EACH ROW EXECUTE FUNCTION analytics_scope_on_order_owner();
