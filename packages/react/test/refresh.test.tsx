// @vitest-environment jsdom
import {
  type DashboardSpec,
  dashboardSpec,
  dataContract,
  type QueryAnswer,
  type QueryRequest,
} from "@adam-riffi/dash-core";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardBuilder } from "../src/builder-entry.ts";
import { DashboardViewer, DashProvider, type Transport } from "../src/index.ts";

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [],
  relationships: [],
  measures: [
    { name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" },
    { name: "Orders", formula: "COUNT(order_items.quantity)", type: "number" },
  ],
});
const spec = (refreshIntervalSec: number): DashboardSpec =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "Live",
    refreshIntervalSec,
    layout: [
      { i: "revenue", x: 0, y: 0, w: 6, h: 2 },
      { i: "orders", x: 6, y: 0, w: 6, h: 2 },
    ],
    visuals: [
      { id: "revenue", type: "kpi", slots: { value: [{ name: "Revenue" }] }, options: {} },
      { id: "orders", type: "kpi", slots: { value: [{ name: "Orders" }] }, options: {} },
    ],
  });
const answer = (n: number): QueryAnswer => ({
  columns: [{ key: "m0", kind: "measure", name: "value", type: "number" }],
  data: [[n]],
  meta: { cache: "miss", ms: 1, truncated: false },
});

function counting() {
  let next = (request: QueryRequest): Promise<QueryAnswer[]> =>
    Promise.resolve(request.queries.map((_, i) => answer(i + 1)));
  const query = vi.fn((request: QueryRequest) => next(request));
  const transport: Transport = { contract: async () => contract, query };
  return { query, transport, answerWith: (f: typeof next) => (next = f) };
}
const stateOf = (id: string) =>
  document.querySelector(`[data-visual="${id}"]`)?.getAttribute("data-state");
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

describe("interval refresh (DESIGN.md §6)", () => {
  it("asks again every refresh interval, every visual in one request, no older than the interval", async () => {
    const { query, transport } = counting();
    render(
      <DashProvider transport={transport}>
        <DashboardViewer spec={spec(5)} />
      </DashProvider>,
    );
    await advance(100);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toMatchObject({ maxAgeSec: 5 });
    await advance(5_000);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1]?.[0].queries).toHaveLength(2);
    expect(query.mock.calls[1]?.[0]).toMatchObject({ maxAgeSec: 5 });
  });

  it("keeps the answers on screen while a refresh is on the way", async () => {
    const { transport, answerWith } = counting();
    render(
      <DashProvider transport={transport}>
        <DashboardViewer spec={spec(5)} />
      </DashProvider>,
    );
    await advance(100);
    expect(stateOf("orders")).toBe("ready");
    answerWith(() => new Promise(() => {}));
    await advance(5_100);
    expect(stateOf("orders")).toBe("ready");
  });

  it("leaves the builder's previews alone: they change only when the dashboard does", async () => {
    const { query, transport } = counting();
    render(
      <DashProvider transport={transport}>
        <DashboardBuilder spec={spec(5)} onChange={() => {}} onSave={() => {}} />
      </DashProvider>,
    );
    await advance(100);
    const asked = query.mock.calls.length;
    await advance(30_000);
    expect(query).toHaveBeenCalledTimes(asked);
  });
});
