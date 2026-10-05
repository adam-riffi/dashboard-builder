-- Local and CI only: mirrors the dashboard-builder section of
-- portfolio-infra/supabase/bootstrap.sql, which creates these roles in the shared Supabase
-- project (passwords set by hand there). Keep the two in sync.
do $$
begin
  if not exists (select from pg_roles where rolname = 'dash_app') then
    create role dash_app login password 'password';
  end if;
  if not exists (select from pg_roles where rolname = 'dash_reader') then
    create role dash_reader login password 'password';
  end if;
end
$$;

create schema if not exists dash;
create schema if not exists dash_demo;
revoke all on schema dash from public;
revoke all on schema dash_demo from public;
grant usage, create on schema dash to dash_app;
grant usage on schema dash_demo to dash_reader;
alter default privileges for role postgres in schema dash
  grant select, insert, update, delete on tables to dash_app;
alter default privileges for role postgres in schema dash
  grant usage, select on sequences to dash_app;
alter default privileges for role postgres in schema dash_demo grant select on tables to dash_reader;
