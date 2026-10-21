#!/bin/sh
# Runs once, only when a database volume is first created (docker-entrypoint-initdb.d).
# Creates the two application roles so apps never connect as the postgres superuser:
#   trp_migrator - owns the schema; used by migrations and seed (M2)
#   trp_runtime  - used by the API; not superuser, not owner, no BYPASSRLS, so RLS applies (M2+)
# Table-level grants are added by migrations in M2.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v migrator_pw="$PG_MIGRATOR_PASSWORD" \
  -v runtime_pw="$PG_RUNTIME_PASSWORD" \
  -v db="$POSTGRES_DB" <<'SQL'
CREATE ROLE trp_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'migrator_pw';
CREATE ROLE trp_runtime  LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD :'runtime_pw';

REVOKE ALL ON DATABASE :"db" FROM PUBLIC;
GRANT CONNECT, TEMPORARY ON DATABASE :"db" TO trp_migrator;
GRANT CONNECT ON DATABASE :"db" TO trp_runtime;

ALTER SCHEMA public OWNER TO trp_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO trp_runtime;
SQL
