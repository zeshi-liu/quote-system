-- Preview contents stay server-side; clients receive only a short random capability.
CREATE TABLE master_data_previews(
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES users,
 purpose text NOT NULL CHECK(purpose IN('manufacturer-source','sales-handoff')),
 auth_version integer NOT NULL CHECK(auth_version>0),
 access_scope_version integer NOT NULL CHECK(access_scope_version>0),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>created_at)
);
CREATE INDEX master_data_previews_expiry ON master_data_previews(expires_at);
CREATE INDEX master_data_previews_actor_expiry ON master_data_previews(actor_id,expires_at);
CREATE FUNCTION protect_master_preview() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'preview scope and original contents are immutable';END $$;
CREATE TRIGGER master_preview_guard BEFORE UPDATE ON master_data_previews FOR EACH ROW EXECUTE FUNCTION protect_master_preview();
