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
