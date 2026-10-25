# @adam-riffi/dash-visuals

The visuals of [dashboard-builder](https://github.com/adam-riffi/dashboard-builder):
- KPI, bar, line, table, scatter and a world map (countries by ISO alpha-2 code), each a plugin with slots, options, a query and a renderer;
- charts drawn with ECharts, loaded lazily.

## Your own visual

```tsx
import { kpi, registerVisual } from "@adam-riffi/dash-visuals";

registerVisual({
  ...kpi, // its slots, options and query
  type: "big-number",
  label: "Big number",
  render: ({ result, formatters }) => <strong>{formatters[0]?.(result.data[0]?.[0])}</strong>,
});
```

A plugin declares:
- **`slots`:** what each slot accepts (a dimension, a time field or measures) and how many;
- **`options`:** a schema;
- **`toQuery(slots, options)`:** returns the `QuerySpec` for its result.

The builder only offers fields a slot accepts. Renderers get `result`, `options`, `formatters`, and for cross-filtering `selected` and `onSelect`.

MIT licensed.
