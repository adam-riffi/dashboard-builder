// @vitest-environment jsdom
import { type DashboardSpec, dashboardSpec, dataContract } from "@adam-riffi/dash-core";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardBuilder, DashProvider, type Transport } from "../src/index.ts";

afterEach(cleanup);

const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [
    {
      name: "dash_demo.products",
      rowCount: null,
      primaryKey: ["id"],
      columns: [
        {
          name: "category",
          pgType: "text",
          type: "string",
          nullable: false,
          role: "dimension",
          distinct: null,
          highCardinality: false,
        },
      ],
    },
  ],
  relationships: [],
  measures: [{ name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" }],
});
const transport: Transport = {
  contract: async () => contract,
  query: async (request) => request.queries.map(() => ({ errors: ["preview unavailable"] })),
};
const empty: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Untitled",
  layout: [],
  visuals: [],
});

function Harness({ onSave }: { onSave: (spec: DashboardSpec) => void }) {
  const [spec, setSpec] = useState(empty);
  return (
    <DashProvider transport={transport}>
      <DashboardBuilder spec={spec} onChange={setSpec} onSave={onSave} />
    </DashProvider>
  );
}

describe("DashboardBuilder", () => {
  it("builds a bar chart from picked fields and saves it", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Bar" }));
    await userEvent.click(await screen.findByRole("button", { name: "Category, dimension" }));
    await userEvent.click(screen.getByRole("button", { name: "Add Category to Category" }));
    await userEvent.click(screen.getByRole("button", { name: "Revenue" }));
    await userEvent.click(screen.getByRole("button", { name: "Add Revenue to Value" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0].visuals).toEqual([
      {
        id: "bar-1",
        type: "bar",
        slots: {
          category: [{ field: "dash_demo.products.category" }],
          value: [{ name: "Revenue" }],
        },
        options: {},
      },
    ]);
  });

  it("titles, configures and removes the selected visual", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Bar" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Visual title" }), "Top categories");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Sort" }), "category");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0].visuals[0]).toMatchObject({
      title: "Top categories",
      options: { sort: "category" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove Top categories" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[1]?.[0].visuals).toEqual([]);
  });

  it("renames the dashboard", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    const title = screen.getByRole("textbox", { name: "Dashboard title" });
    await userEvent.clear(title);
    await userEvent.type(title, "Weekly sales");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0].title).toBe("Weekly sales");
  });
});
