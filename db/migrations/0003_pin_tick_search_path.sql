-- Supabase advisor lint 0011: without a pinned search_path, tick() resolves names through its
-- caller's path. Every name in it is already schema-qualified (dash_demo.*, cron.*), and
-- built-ins resolve through pg_catalog regardless, so an empty path changes nothing it does.
alter function dash_demo.tick() set search_path = '';
