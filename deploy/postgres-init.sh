#!/usr/bin/env bash
set -euo pipefail
export QUOTE_MIGRATOR_PASSWORD="$(cat /run/secrets/migrator_password)"
export QUOTE_APP_PASSWORD="$(cat /run/secrets/app_password)"
for secret in "$QUOTE_MIGRATOR_PASSWORD" "$QUOTE_APP_PASSWORD"; do
  if [ "${#secret}" -lt 16 ] || [[ "$secret" =~ replace_me|change_me|placeholder ]]; then
    echo 'database_secret_invalid' >&2
    exit 1
  fi
done
# getenv avoids exposing supplied credentials in command arguments or generated SQL files.
psql --username "$POSTGRES_USER" --dbname postgres --set ON_ERROR_STOP=1 <<'SQL'
\getenv migrator_password QUOTE_MIGRATOR_PASSWORD
\getenv app_password QUOTE_APP_PASSWORD
CREATE ROLE quote_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'migrator_password';
CREATE ROLE quote_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE DATABASE quote_system OWNER quote_migrator;
\connect quote_system
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO quote_app;
ALTER DEFAULT PRIVILEGES FOR ROLE quote_migrator IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO quote_app;
ALTER DEFAULT PRIVILEGES FOR ROLE quote_migrator IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO quote_app;
SQL
unset QUOTE_MIGRATOR_PASSWORD QUOTE_APP_PASSWORD
