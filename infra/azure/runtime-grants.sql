-- Run only in an approved private-network bootstrap session, after all three explicit initializers.
-- The LOGIN role is created/passworded out of band; no password may appear in this file.
-- psql -v runtime_role=vinyl_runtime ... -f infra/azure/runtime-grants.sql
\set ON_ERROR_STOP on
BEGIN;
GRANT CONNECT ON DATABASE vinyl_shop TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT ON TABLE public.products TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON TABLE public.users TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cart_items, public.user_sessions, public.auth_abuse_counters TO :"runtime_role";
GRANT USAGE ON SEQUENCE public.users_id_seq, public.cart_items_id_seq TO :"runtime_role";
COMMIT;
