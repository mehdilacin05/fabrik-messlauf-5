-- Schema der App (APP_SCHEMA); muss existieren, bevor PostgREST es freigibt (supabase/config.toml)
create schema if not exists inventar;
grant usage on schema inventar to anon, authenticated, service_role;
