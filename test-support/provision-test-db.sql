-- ONLY for a newly created disposable PostgreSQL instance. Never run on an existing server.
\set ON_ERROR_STOP on
\getenv test_password VINYL_TEST_PASSWORD
CREATE ROLE vinyl_shop_test LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'test_password';
CREATE DATABASE vinyl_shop_test;
REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;
REVOKE ALL ON DATABASE vinyl_shop_test FROM PUBLIC;
GRANT CONNECT, CREATE ON DATABASE vinyl_shop_test TO vinyl_shop_test;
\connect vinyl_shop_test
REVOKE ALL ON SCHEMA public FROM PUBLIC;
CREATE SCHEMA vinyl_test_control;
CREATE TABLE vinyl_test_control.marker (kind text PRIMARY KEY);
INSERT INTO vinyl_test_control.marker VALUES ('vinyl-shop-disposable-v1');
GRANT USAGE ON SCHEMA vinyl_test_control TO vinyl_shop_test;
GRANT SELECT ON vinyl_test_control.marker TO vinyl_shop_test;

-- Atomically check/drop a registered fixture namespace while preventing namespace
-- rename/recreation. Restricted callers cannot lock system catalogs themselves.
CREATE FUNCTION vinyl_test_control.drop_test_schema(target_name text, target_oid oid, target_owner oid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
SET lock_timeout = '5s'
AS $$
BEGIN
  IF session_user <> 'vinyl_shop_test' OR current_database() <> 'vinyl_shop_test'
     OR target_name !~ '^vinyl_test_[0-9a-f]{32}$' THEN
    RAISE EXCEPTION 'Unsafe disposable schema cleanup';
  END IF;
  LOCK TABLE pg_catalog.pg_namespace IN SHARE ROW EXCLUSIVE MODE;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_namespace n JOIN pg_catalog.pg_roles r ON r.oid = n.nspowner
    WHERE n.nspname = target_name AND n.oid = target_oid AND n.nspowner = target_owner
      AND r.rolname = session_user
  ) THEN
    RAISE EXCEPTION 'Test schema identity changed; cleanup refused';
  END IF;
  EXECUTE format('DROP SCHEMA %I CASCADE', target_name);
END;
$$;
REVOKE ALL ON FUNCTION vinyl_test_control.drop_test_schema(text, oid, oid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION vinyl_test_control.drop_test_schema(text, oid, oid) TO vinyl_shop_test;
