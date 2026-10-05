-- Live demo data (DESIGN.md §8): a few new orders per tenant every minute, 90-day retention.
create extension if not exists pg_cron;

create function dash_demo.tick() returns void
language plpgsql
as $$
declare
  t int;
  new_order bigint;
begin
  delete from dash_demo.orders where ordered_at < now() - interval '90 days';

  for t in select id from dash_demo.tenants loop
    for i in 1..(1 + floor(random() * 3)::int) loop
      insert into dash_demo.orders (tenant_id, customer_id, ordered_at, status, channel)
      select t, c.id, now(),
        (array['paid', 'paid', 'paid', 'shipped', 'refunded'])[1 + floor(random() * 5)::int],
        (array['web', 'mobile', 'store'])[1 + floor(random() * 3)::int]
      from dash_demo.customers c
      where c.tenant_id = t
      order by random()
      limit 1
      returning id into new_order;

      continue when new_order is null;

      insert into dash_demo.order_items (order_id, tenant_id, product_id, quantity, unit_price)
      select new_order, t, p.id, 1 + floor(random() * 4)::int, p.unit_price
      from dash_demo.products p
      where p.tenant_id = t
      order by random()
      limit 1 + floor(random() * 3)::int;
    end loop;
  end loop;
end
$$;

-- cron.schedule upserts by job name, so re-running this is harmless.
select cron.schedule('dash_demo_tick', '* * * * *', 'select dash_demo.tick()');
