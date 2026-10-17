// @vitest-environment jsdom
import {
  type DashboardSpec,
  dashboardSpec,
  dataContract,
  type QueryAnswer,
  type QueryRequest,
} from "@adam-riffi/dash-core";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardViewer, DashProvider, GatewayError, type Transport } from "../src/index.ts";

afterEach(cleanup);
// jsdom has neither; the chart wrapper uses both (charts themselves never draw here).
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
vi.stubGlobal("matchMedia", () => ({ addEventListener() {}, removeEventListener() {} }));

const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [],
  relationships: [],
  measures: [{ name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" }],
});
const category = { field: "dash_demo.products.category" };
const spec = (type: "bar" | "table"): DashboardSpec =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "Cross-filter",
    layout: [
      { i: "source", x: 0, y: 0, w: 6, h: 4 },
      { i: "total", x: 6, y: 0, w: 6, h: 2 },
    ],
    visuals: [
      {
        id: "source",
        type,
        slots:
          type === "bar"
            ? { category: [category], value: [{ name: "Revenue" }] }
            : { rows: [category], values: [{ name: "Revenue" }] },
        options: {},
      },
      { id: "total", type: "kpi", slots: { value: [{ name: "Revenue" }] }, options: {} },
    ],
  });
/** Grouped queries get two categories, the rest one number. */
const answerTo = (request: QueryRequest): QueryAnswer[] =>
  request.queries.map((q) =>
    q.dimensions.length > 0
      ? {
          columns: [
            { key: "d0", kind: "dimension", field: category.field, type: "string" },
            { key: "m0", kind: "measure", name: "Revenue", type: "number" },
          ],
          data: [
            ["Garden", "Toys"],
            [80, 40],
          ],
          meta: { cache: "miss", ms: 1, truncated: false },
        }
      : {
          columns: [{ key: "m0", kind: "measure", name: "Revenue", type: "number" }],
          data: [[120]],
          meta: { cache: "miss", ms: 1, truncated: false },
        },
  );

function setup(type: "bar" | "table", answer = async (r: QueryRequest) => answerTo(r)) {
  const query = vi.fn(answer);
  const transport: Transport = { contract: async () => contract, query };
  const view = (s: DashboardSpec) => (
    <DashProvider transport={transport}>
      <DashboardViewer spec={s} />
    </DashProvider>
  );
  const { rerender } = render(view(spec(type)));
  /** The filters each query of the latest request carried, by whether it groups. */
  const lastFilters = () =>
    query.mock.lastCall?.[0].queries.map((q) => ({
      grouped: q.dimensions.length > 0,
      filters: q.filters,
    }));
  return { query, lastFilters, show: (s: DashboardSpec) => rerender(view(s)) };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 50));
const garden = { field: category.field, op: "in", values: ["Garden"] };

describe("cross-filtering in the viewer (DESIGN.md §6)", () => {
  it("filters the other visuals by a bar's category, chosen from the keyboard, and clears it", async () => {
    const { query, lastFilters } = setup("bar");
    const pick = await screen.findByRole("combobox", { name: "Filter by Category" });
    const before = query.mock.calls.length;
    await userEvent.selectOptions(pick, "Garden");
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(query.mock.calls.length).toBeGreaterThan(before));
    // Only the KPI asks again: the bar keeps its own answer and highlights.
    expect(lastFilters()).toEqual([{ grouped: false, filters: [garden] }]);

    // The chip names the field and the value as the axis shows it.
    await userEvent.click(screen.getByRole("button", { name: "Clear filter Category: Garden" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Clear filter/ })).toBeNull());
    expect(
      query.mock.calls.map((c) => c[0].queries.flatMap((q) => q.filters)).at(-1) ?? [],
    ).toEqual([]);
  });

  it("filters the other visuals by a table row's first dimension", async () => {
    const { query, lastFilters } = setup("table");
    const row = await screen.findByRole("button", { name: "Garden" });
    const before = query.mock.calls.length;
    await userEvent.click(row);
    await waitFor(() => expect(query.mock.calls.length).toBeGreaterThan(before));
    expect(lastFilters()).toEqual([{ grouped: false, filters: [garden] }]);
    expect(row.getAttribute("aria-pressed")).toBe("true");
  });

  it("applies the keyboard choice on Enter or on leaving it, not on every arrow key", async () => {
    const { query } = setup("bar");
    const pick = await screen.findByRole("combobox", { name: "Filter by Category" });
    await tick();
    const before = query.mock.calls.length;
    // Arrow keys in a closed select fire change: each one must not cross-filter.
    fireEvent.change(pick, { target: { value: "0" } });
    fireEvent.change(pick, { target: { value: "1" } });
    await tick();
    expect(query.mock.calls.length).toBe(before);
    fireEvent.blur(pick);
    await waitFor(() => expect(query.mock.calls.length).toBe(before + 1));
    expect(screen.getByRole("button", { name: "Clear filter Category: Toys" })).toBeTruthy();
  });

  it("shows a filtered visual's failure, never the unfiltered numbers under the chip", async () => {
    setup("bar", async (r) => {
      if (r.queries.some((q) => q.filters.length > 0)) {
        throw new GatewayError("query answered 429", 429);
      }
      return answerTo(r);
    });
    const pick = await screen.findByRole("combobox", { name: "Filter by Category" });
    await userEvent.selectOptions(pick, "Garden");
    await userEvent.keyboard("{Enter}");
    await waitFor(() =>
      expect(document.querySelector('[data-visual="total"]')?.getAttribute("data-state")).toBe(
        "error",
      ),
    );
  });

  it("starts another dashboard with no selection", async () => {
    const { query, show } = setup("bar");
    const pick = await screen.findByRole("combobox", { name: "Filter by Category" });
    await userEvent.selectOptions(pick, "Garden");
    await userEvent.keyboard("{Enter}");
    await screen.findByRole("button", { name: "Clear filter Category: Garden" });
    show({ ...spec("bar"), title: "Another dashboard" });
    await waitFor(() => expect(screen.queryByRole("button", { name: /^Clear filter/ })).toBeNull());
    await tick();
    expect(query.mock.lastCall?.[0].queries.flatMap((q) => q.filters)).toEqual([]);
  });

  it("never brings back a cleared choice when the picker loses focus later", async () => {
    setup("bar");
    const pick = await screen.findByRole("combobox", { name: "Filter by Category" });
    await userEvent.selectOptions(pick, "Garden");
    await userEvent.keyboard("{Enter}");
    await userEvent.click(
      await screen.findByRole("button", { name: "Clear filter Category: Garden" }),
    );
    fireEvent.focus(pick);
    fireEvent.blur(pick);
    await tick();
    expect(screen.queryByRole("button", { name: /^Clear filter/ })).toBeNull();
  });
});
