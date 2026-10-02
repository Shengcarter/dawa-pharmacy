#!/bin/sh
# Runs once, when the database volume is first created.
# Least privilege: the superuser (POSTGRES_USER) is only used here. The schema
# owner runs migrations; the application connects as a role with data access only.
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$DATABASE_OWNER_PASSWORD" -v app_pw="$DATABASE_APP_PASSWORD" <<'SQL'
CREATE ROLE dawa_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE dawa_app LOGIN PASSWORD :'app_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE DATABASE dawa OWNER dawa_owner;
REVOKE ALL ON DATABASE dawa FROM PUBLIC;
GRANT CONNECT ON DATABASE dawa TO dawa_owner, dawa_app;
SQL
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname dawa <<'SQL'
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO dawa_owner;
GRANT USAGE ON SCHEMA public TO dawa_app;
SQL
