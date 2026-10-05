-- Deterministic demo data (setseed) with fixed ids, so a second run inserts nothing.
select setseed(0.42);

insert into dash_demo.tenants (id, name, region) values
  (1, 'Northwind', 'eu-west'),
  (2, 'Globex', 'us-east'),
  (3, 'Initech', 'us-west'),
  (4, 'Umbrella', 'eu-central'),
  (5, 'Hooli', 'ap-south')
on conflict do nothing;

-- Customer and product ids are interleaved by tenant: id = tenant_id + 5k.
insert into dash_demo.customers (id, tenant_id, name, country, segment, created_at)
select id, (id - 1) % 5 + 1, 'Customer ' || id,
  (array['FR', 'DE', 'US', 'GB', 'ES', 'IN'])[1 + floor(random() * 6)::int],
  (array['consumer', 'smb', 'enterprise'])[1 + floor(random() * 3)::int],
  now() - random() * interval '365 days'
from generate_series(1, 250) as id
on conflict do nothing;

insert into dash_demo.products (id, tenant_id, name, category, unit_price)
select id, (id - 1) % 5 + 1, 'Product ' || id,
  (array['Books', 'Electronics', 'Garden', 'Kitchen', 'Toys'])[1 + floor(random() * 5)::int],
  round((5 + random() * 195)::numeric, 2)
from generate_series(1, 100) as id
on conflict do nothing;

insert into dash_demo.orders (id, tenant_id, customer_id, ordered_at, status, channel)
select id, (id - 1) % 5 + 1, (id - 1) % 5 + 1 + 5 * floor(random() * 50)::int,
  now() - random() * interval '90 days',
  (array['paid', 'paid', 'paid', 'shipped', 'refunded'])[1 + floor(random() * 5)::int],
  (array['web', 'mobile', 'store'])[1 + floor(random() * 3)::int]
from generate_series(1, 12000) as id
on conflict do nothing;

-- One to three items per order; item id = order_id * 4 + n.
insert into dash_demo.order_items (id, order_id, tenant_id, product_id, quantity, unit_price)
select i.id, i.order_id, i.tenant_id, p.id, i.quantity, p.unit_price
from (
  select o.id * 4 + n as id, o.id as order_id, o.tenant_id,
    o.tenant_id + 5 * floor(random() * 20)::int as product_id,
    1 + floor(random() * 4)::int as quantity
  from dash_demo.orders o
  cross join lateral generate_series(1, 1 + (o.id % 3)::int) as n
  where o.id <= 12000
) as i
join dash_demo.products p on p.id = i.product_id
on conflict do nothing;

-- Keep pg_cron inserts clear of the seeded ids.
select setval(pg_get_serial_sequence('dash_demo.orders', 'id'),
  greatest((select max(id) from dash_demo.orders), 12000));
select setval(pg_get_serial_sequence('dash_demo.order_items', 'id'),
  greatest((select max(id) from dash_demo.order_items), 12000 * 4 + 3));
