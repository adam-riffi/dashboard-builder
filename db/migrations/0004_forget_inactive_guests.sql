-- DESIGN.md §14, ADR 0012: this app's data for guests unseen for 30 days goes away weekly. The
-- shared project's anonymous users belong to every app on it and stay with portfolio-infra.

-- When a guest last resolved their scope, refreshed at most daily (apps/demo/lib/tenants.ts).
-- Existing guests count as seen now, so nobody is forgotten before 30 days have passed.
alter table dash.memberships add column last_seen_at timestamptz not null default now();

create function dash.forget_inactive_guests() returns void
language sql
set search_path = ''
as $$
  -- pg_cron logs every run and never purges; keep a few weeks of this job's history only.
  delete from cron.job_run_details
  where jobid in (select jobid from cron.job where jobname = 'dash_forget_guests')
    and end_time < now() - interval '30 days';

  -- Their dashboards, and dashboards whose owner has no membership left after 30 days.
  delete from dash.dashboards d
  where d.owner_id in (
      select m.user_id from dash.memberships m
      group by m.user_id
      having max(m.last_seen_at) < now() - interval '30 days')
    or (not exists (select 1 from dash.memberships m where m.user_id = d.owner_id)
        and d.updated_at < now() - interval '30 days');

  delete from dash.memberships
  where user_id in (
    select m.user_id from dash.memberships m
    group by m.user_id
    having max(m.last_seen_at) < now() - interval '30 days');
$$;

-- Only the scheduler runs it: dash_app reads and writes one guest at a time.
revoke execute on function dash.forget_inactive_guests() from public;

-- Mondays at 04:00 UTC; cron.schedule upserts by job name, so re-running this is harmless.
select cron.schedule('dash_forget_guests', '0 4 * * 1', 'select dash.forget_inactive_guests()');
