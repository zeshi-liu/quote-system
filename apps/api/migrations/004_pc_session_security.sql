ALTER TABLE users ADD COLUMN auth_version integer NOT NULL DEFAULT 1 CHECK(auth_version>0);
ALTER TABLE auth_sessions ADD COLUMN issued_role text CHECK(issued_role IN('salesperson','admin','hospital'));
ALTER TABLE auth_sessions ADD COLUMN auth_version integer;
ALTER TABLE auth_sessions ADD COLUMN csrf_hash text;
-- Previous sessions did not retain their authenticated role. Require a fresh login;
-- never infer an old session's authority from a possibly promoted current profile.
UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,CURRENT_TIMESTAMP);
CREATE FUNCTION advance_auth_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW.role,NEW.active,NEW.password_hash) IS DISTINCT FROM ROW(OLD.role,OLD.active,OLD.password_hash) THEN
  NEW.auth_version:=OLD.auth_version+1;
 ELSE NEW.auth_version:=OLD.auth_version;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER user_auth_version BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION advance_auth_version();
CREATE FUNCTION bind_session_authority() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 SELECT role,auth_version INTO NEW.issued_role,NEW.auth_version FROM users WHERE id=NEW.user_id;
 RETURN NEW;
END $$;
CREATE TRIGGER session_authority BEFORE INSERT ON auth_sessions FOR EACH ROW EXECUTE FUNCTION bind_session_authority();
CREATE TABLE pc_pre_sessions(token_hash text PRIMARY KEY,csrf_hash text NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX pc_pre_sessions_expiry ON pc_pre_sessions(expires_at);
