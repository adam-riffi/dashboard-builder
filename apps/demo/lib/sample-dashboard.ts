import { type DashboardSpec, dashboardSpec } from "@adam-riffi/dash-core";

const revenue = { name: "Revenue" };
const orders = { name: "Orders" };

/**
 * The demo's sample dashboard (DESIGN.md §3, §12): the host measures by category, by day and by
 * product. Saving dashboards arrives with the builder (M5), so its contract version is a stand-in.
 */
export const sampleDashboard: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Acme Shop overview",
  layout: [
    { i: "kpi-revenue", x: 0, y: 0, w: 4, h: 2 },
    { i: "kpi-orders", x: 4, y: 0, w: 4, h: 2 },
    { i: "kpi-aov", x: 8, y: 0, w: 4, h: 2 },
    { i: "bar-category", x: 0, y: 2, w: 6, h: 5 },
    { i: "line-orders", x: 6, y: 2, w: 6, h: 5 },
    { i: "table-products", x: 0, y: 7, w: 12, h: 5 },
  ],
  visuals: [
    { id: "kpi-revenue", type: "kpi", slots: { value: [revenue] } },
    { id: "kpi-orders", type: "kpi", slots: { value: [orders] } },
    { id: "kpi-aov", type: "kpi", slots: { value: [{ name: "Average order value" }] } },
    {
      id: "bar-category",
      type: "bar",
      slots: { category: [{ field: "dash_demo.products.category" }], value: [revenue] },
    },
    {
      id: "line-orders",
      type: "line",
      slots: { axis: [{ field: "dash_demo.orders.ordered_at" }], value: [orders] },
      options: { grain: "day" },
    },
    {
      id: "table-products",
      type: "table",
      title: "Top products",
      slots: {
        rows: [{ field: "dash_demo.products.name" }],
        values: [revenue, { field: "dash_demo.order_items.quantity", aggregation: "SUM" }],
      },
      options: { limit: 10 },
    },
  ],
});
