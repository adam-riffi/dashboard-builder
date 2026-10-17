// @vitest-environment jsdom
import {
  type DashboardSpec,
  dashboardSpec,
  dataContract,
  type QueryAnswer,
} from "@adam-riffi/dash-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DashboardViewer, DashProvider, type Transport } from "../src/index.ts";

afterEach(cleanup);

const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [],
  relationships: [],
  measures: [{ name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" }],
});
const spec: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Explained",
  layout: [{ i: "revenue", x: 0, y: 0, w: 6, h: 2 }],
  visuals: [{ id: "revenue", type: "kpi", slots: { value: [{ name: "Revenue" }] }, options: {} }],
});
const answer: QueryAnswer = {
  columns: [{ key: "m0", kind: "measure", name: "Revenue", type: "number" }],
  data: [[120]],
  meta: {
    cache: "hit",
    ms: 3,
    truncated: false,
    explain: {
      sql: 'select sum("t0"."quantity") as "m0" from "dash_demo"."order_items" as "t0"',
      params: [[1, 2]],
      scope: { userId: "4f1c2d3e", tenantIds: [1, 2] },
    },
  },
};
const transport: Transport = {
  contract: async () => contract,
  query: async () => [answer],
};

describe("the Under the hood drawer (DESIGN.md §2, §13)", () => {
  it("shows each visual's cache status, time, rows and SQL, and the security context", async () => {
    render(
      <DashProvider transport={transport}>
        <DashboardViewer spec={spec} underTheHood />
      </DashProvider>,
    );
    const drawer = within(await screen.findByRole("group", { name: "Under the hood" }));
    // The drawer is there at once; its lines arrive with the answers.
    expect(await drawer.findByText(/Revenue: cache hit, 3 ms, 1 row/)).toBeTruthy();
    expect(drawer.getByText(/from "dash_demo"."order_items"/)).toBeTruthy();
    expect(drawer.getByText(/"tenantIds":\s*\[\s*1,\s*2\s*\]/)).toBeTruthy();
  });

  it("is not there unless the host asks for it", async () => {
    render(
      <DashProvider transport={transport}>
        <DashboardViewer spec={spec} />
      </DashProvider>,
    );
    await screen.findByText("Explained");
    expect(screen.queryByRole("group", { name: "Under the hood" })).toBeNull();
  });
});
