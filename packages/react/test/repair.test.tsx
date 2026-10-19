// @vitest-environment jsdom
import { type DashboardSpec, dashboardSpec } from "@adam-riffi/dash-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardBuilder, RepairPanel } from "../src/builder-entry.ts";
import { DashProvider, type Transport } from "../src/index.ts";
import { shop } from "./shop.ts";

afterEach(cleanup);

// shop has orders(id, status), order_items(id, order_id, product_id, quantity),
// products(id, category) and the host measure Revenue.
const lost: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "After a schema change",
  measures: [{ name: "Units", formula: "SUM(order_items.qty)" }],
  filters: [{ field: "dash_demo.orders.order_status", op: "in", values: ["paid"] }],
  layout: [{ i: "bar", x: 0, y: 0, w: 12, h: 4 }],
  visuals: [
    {
      id: "bar",
      type: "bar",
      slots: {
        category: [{ field: "dash_demo.products.product_category" }],
        value: [{ name: "Revenue" }, { name: "Units" }],
      },
      options: {},
    },
  ],
});

const panel = () => screen.getByRole("region", { name: "Fields this dashboard lost" });

describe("the repair panel (ADR 0011)", () => {
  it("lists each lost field with what uses it, its best replacement chosen", () => {
    render(<RepairPanel spec={lost} contract={shop} onChange={() => {}} />);
    const rows = within(panel()).getAllByRole("listitem");
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining("Used by 1 visual"),
      expect.stringContaining("Used by 1 filter"),
      expect.stringContaining("Used by the measure Units"),
    ]);
    const pick = screen.getByRole("combobox", { name: "Replace products.product_category" });
    expect((pick as HTMLSelectElement).value).toBe("dash_demo.products.category");
    expect(
      (screen.getByRole("combobox", { name: "Replace orders.order_status" }) as HTMLSelectElement)
        .value,
    ).toBe("dash_demo.orders.status");
  });

  it("applies the chosen replacement through onChange", async () => {
    const onChange = vi.fn();
    render(<RepairPanel spec={lost} contract={shop} onChange={onChange} />);
    await userEvent.click(
      screen.getByRole("button", { name: "Apply to products.product_category" }),
    );
    const fixed = onChange.mock.lastCall?.[0] as DashboardSpec;
    expect(fixed.visuals[0]?.slots.category).toEqual([{ field: "dash_demo.products.category" }]);
  });

  it("offers to remove what only slots and filters use, never a measure's field", async () => {
    const onChange = vi.fn();
    render(<RepairPanel spec={lost} contract={shop} onChange={onChange} />);
    const filter = screen.getByRole("combobox", { name: "Replace orders.order_status" });
    await userEvent.selectOptions(filter, "Remove it");
    await userEvent.click(screen.getByRole("button", { name: "Apply to orders.order_status" }));
    expect((onChange.mock.lastCall?.[0] as DashboardSpec).filters).toEqual([]);
    const units = screen.getByRole("combobox", { name: "Replace order_items.qty" });
    expect(within(units).queryByRole("option", { name: "Remove it" })).toBeNull();
  });

  it("shows nothing when the contract has every field", () => {
    const { container } = render(
      <RepairPanel
        spec={{ ...lost, measures: [], filters: [], visuals: [], layout: [] }}
        contract={shop}
        onChange={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("sits in the builder until every lost field is fixed", async () => {
    const transport: Transport = {
      contract: async () => shop,
      query: async (request) => request.queries.map(() => ({ errors: ["preview unavailable"] })),
    };
    function Harness() {
      const [spec, setSpec] = useState(lost);
      return (
        <DashProvider transport={transport}>
          <DashboardBuilder spec={spec} onChange={setSpec} onSave={() => {}} />
        </DashProvider>
      );
    }
    render(<Harness />);
    await screen.findByRole("region", { name: "Fields this dashboard lost" });
    for (const name of ["products.product_category", "orders.order_status", "order_items.qty"]) {
      await userEvent.click(screen.getByRole("button", { name: `Apply to ${name}` }));
    }
    expect(screen.queryByRole("region", { name: "Fields this dashboard lost" })).toBeNull();
  });
});
