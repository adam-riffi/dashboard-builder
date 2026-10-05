-- Fixture: a small SaaS billing schema. Exercises enums, averaged measure names, *_id columns
-- without foreign keys, every temporal type, unsupported types and a high-cardinality column.
drop schema if exists fx_saas cascade;
create schema fx_saas;

create type fx_saas.plan_tier as enum ('free', 'pro', 'enterprise');

create table fx_saas.plans (
  id smallint primary key,
  tier fx_saas.plan_tier not null,
  monthly_price numeric(8, 2) not null,
  seat_limit int
);

create table fx_saas.accounts (
  id uuid primary key,
  plan_id smallint not null references fx_saas.plans (id),
  name text not null,
  country char(2) not null,
  stripe_customer_id text,
  churn_score real,
  is_active boolean not null,
  signed_up_on date not null,
  settings jsonb,
  tags text[]
);

create table fx_saas.invoices (
  id bigint generated always as identity primary key,
  account_id uuid not null references fx_saas.accounts (id),
  issued_at timestamp not null,
  paid_at timestamptz,
  amount numeric(12, 2) not null,
  tax_rate numeric(5, 4) not null,
  discount_pct float8,
  seats int not null
);

create table fx_saas.events (
  session_key text not null,
  kind varchar(20) not null,
  happened_at timestamptz not null
);

insert into fx_saas.plans values (1, 'free', 0, 1), (2, 'pro', 29, 10), (3, 'enterprise', 99, null);

insert into fx_saas.accounts
select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 1 + i % 3, 'Account ' || i,
  (array['FR', 'DE', 'US'])[1 + i % 3], case when i % 2 = 0 then 'cus_' || i end,
  (i % 10) / 10.0, i % 4 <> 0, date '2026-01-01' + i, null, null
from generate_series(1, 60) as i;

insert into fx_saas.invoices (account_id, issued_at, paid_at, amount, tax_rate, discount_pct, seats)
select ('00000000-0000-4000-8000-' || lpad((1 + i % 60)::text, 12, '0'))::uuid,
  timestamp '2026-01-01' + i * interval '1 day', case when i % 5 <> 0 then timestamptz '2026-01-02' + i * interval '1 day' end,
  10 * (i % 7), 0.2, case when i % 3 = 0 then 5 end, 1 + i % 10
from generate_series(1, 300) as i;

insert into fx_saas.events
select 'sess-' || i, (array['view', 'click', 'buy'])[1 + i % 3], timestamptz '2026-01-01' + i * interval '1 minute'
from generate_series(1, 12000) as i;

analyze fx_saas.plans, fx_saas.accounts, fx_saas.invoices, fx_saas.events;
