-- Local and CI only. In the shared Supabase project these roles come from
-- portfolio-infra/supabase/bootstrap.sql, with passwords set by hand.
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
