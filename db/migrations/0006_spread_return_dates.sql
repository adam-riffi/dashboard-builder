-- 0005 dated a return one to fourteen days after its order, capped at now: about a quarter of
-- them landed on the migration's instant. A return past now moves instead to a point between its
-- order and now, one to nine tenths of the way, picked by its item's id.
update dash_demo.returns r
set returned_at = o.ordered_at + (now() - o.ordered_at) * ((1 + i.id % 9) / 10.0)
from dash_demo.order_items i
join dash_demo.orders o on o.id = i.order_id
where i.id = r.order_item_id
  and hashint8(i.id) % 20 = 0
  and o.ordered_at + (1 + i.id % 14) * interval '1 day' > r.returned_at;
