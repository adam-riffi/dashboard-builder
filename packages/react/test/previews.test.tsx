// @vitest-environment jsdom
import {
  type DashboardSpec,
  dashboardSpec,
  dataContract,
  type QueryAnswer,
  type QueryRequest,
} from "@adam-riffi/dash-core";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardViewer, DashProvider, type Transport } from "../src/index.ts";

afterEach(cleanup);

const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [],
  relationships: [],
  measures: [{ name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" }],
});
const units = { name: "Units", formula: "SUM(order_items.quantity)" };
const base: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Previews",
  measures: [units],
  layout: [
    { i: "revenue", x: 0, y: 0, w: 6, h: 2 },
    { i: "units", x: 6, y: 0, w: 6, h: 2 },
  ],
  visuals: [
    { id: "revenue", type: "kpi", slots: { value: [{ name: "Revenue" }] }, options: {} },
    { id: "units", type: "kpi", slots: { value: [{ name: "Units" }] }, options: {} },
  ],
});
const answer = (n: number): QueryAnswer => ({
  columns: [{ key: "m0", kind: "measure", name: "value", type: "number" }],
  data: [[n]],
  meta: { cache: "miss", ms: 1, truncated: false },
});

/** A transport that counts requests; answers follow `next`, which a test may swap. */
function counting() {
  let next = (request: QueryRequest): Promise<QueryAnswer[]> =>
    Promise.resolve(request.queries.map((_, i) => answer(i + 1)));
  const query = vi.fn((request: QueryRequest) => next(request));
  const transport: Transport = { contract: async () => contract, query };
  return {
    query,
    transport,
    answerWith: (f: typeof next) => {
      next = f;
    },
  };
}

const view = (transport: Transport, spec: DashboardSpec) => (
  <DashProvider transport={transport}>
    <DashboardViewer spec={spec} />
  </DashProvider>
);
const stateOf = (id: string) =>
  document.querySelector(`[data-visual="${id}"]`)?.getAttribute("data-state");
const tick = () => new Promise((resolve) => setTimeout(resolve, 30));

describe("previews", () => {
  it("load every visual of a dashboard in one request (ADR 0008)", async () => {
    const { query, transport } = counting();
    render(view(transport, base));
    await waitFor(() => expect(stateOf("units")).toBe("ready"));
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0].queries).toHaveLength(2);
  });

  it("ask again only for the visual an edit changed, with only the measures it uses", async () => {
    const { query, transport } = counting();
    const { rerender } = render(view(transport, base));
    await waitFor(() => expect(stateOf("units")).toBe("ready"));
    const doubled = { ...units, formula: "SUM(order_items.quantity) * 2" };
    rerender(view(transport, { ...base, measures: [doubled] }));
    await waitFor(() => expect(query).toHaveBeenCalledTimes(2));
    expect(query.mock.calls[1]?.[0]).toEqual({
      measures: [doubled],
      queries: [{ dimensions: [], measures: [{ name: "Units" }], filters: [] }],
    });
  });

  it("ask nothing for edits no query sees: a title, a measure no visual uses", async () => {
    const { query, transport } = counting();
    const { rerender } = render(view(transport, base));
    await waitFor(() => expect(stateOf("units")).toBe("ready"));
    const unused = { name: "Unused", formula: "COUNT(order_items.quantity)" };
    rerender(view(transport, { ...base, title: "Renamed", measures: [units, unused] }));
    await tick();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("keep a visual's answer on screen while its edit is asked for", async () => {
    const { transport, answerWith } = counting();
    const { rerender } = render(view(transport, base));
    await waitFor(() => expect(stateOf("units")).toBe("ready"));
    answerWith(() => new Promise(() => {}));
    rerender(
      view(transport, {
        ...base,
        measures: [{ ...units, formula: "COUNT(order_items.quantity)" }],
      }),
    );
    await tick();
    expect(stateOf("units")).toBe("ready");
  });

  it("give each visual its own answer, or its reasons for having none", async () => {
    const { transport, answerWith } = counting();
    // One answer short: the second visual's query goes unanswered.
    answerWith(() => Promise.resolve([answer(7)]));
    const broken = { id: "pie", type: "pie", slots: {}, options: {} };
    const spec = {
      ...base,
      layout: [...base.layout, { i: "pie", x: 0, y: 2, w: 12, h: 2 }],
      visuals: [...base.visuals, broken],
    };
    render(view(transport, spec));
    await waitFor(() => expect(stateOf("revenue")).toBe("ready"));
    expect(document.querySelector('[data-visual="units"]')?.textContent).toContain(
      "No answer for this visual",
    );
    expect(document.querySelector('[data-visual="pie"]')?.textContent).toContain(
      "unknown visual type pie",
    );
  });
});
