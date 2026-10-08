// @vitest-environment jsdom
import { type DashboardSpec, dashboardSpec, dataContract } from "@adam-riffi/dash-core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DashboardBuilder } from "../src/builder-entry.ts";
import { DashProvider, type Transport } from "../src/index.ts";

afterEach(cleanup);

const contract = dataContract.parse({
  contractVersion: "c".repeat(64),
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

function Harness({
  onSave,
  initial = empty,
}: {
  onSave: (spec: DashboardSpec) => void;
  initial?: DashboardSpec;
}) {
  const [spec, setSpec] = useState(initial);
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
    // An unset limit is empty, not 0 (which the input would refuse anyway: min is 1).
    expect((screen.getByRole("spinbutton", { name: "Rows" }) as HTMLInputElement).value).toBe("");
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

  it("saves with the contract version the dashboard was built on", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await screen.findByRole("button", { name: "Category, dimension" });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0].contractVersion).toBe("c".repeat(64));
  });

  it("does not hand the host a spec it would refuse, and says why", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} initial={{ ...empty, title: "x".repeat(201) }} />);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole("alert").textContent).toContain("title");
  });

  it("shows the title of the dashboard the host passes in, when it changes", () => {
    const view = (spec: DashboardSpec) => (
      <DashProvider transport={transport}>
        <DashboardBuilder spec={spec} onChange={vi.fn()} onSave={vi.fn()} />
      </DashProvider>
    );
    const { rerender } = render(view(empty));
    rerender(view({ ...empty, title: "Weekly sales" }));
    expect(
      (screen.getByRole("textbox", { name: "Dashboard title" }) as HTMLInputElement).value,
    ).toBe("Weekly sales");
  });

  it("selects a visual from the keyboard, so its wells are reachable without a pointer", async () => {
    render(<Harness onSave={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Bar" }));
    await userEvent.click(screen.getByRole("button", { name: "Add KPI" }));
    screen.getByRole("button", { name: "Select A Bar visual" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("group", { name: "Category" })).toBeTruthy();
  });

  it("takes whole rows only, and no limit when Rows is cleared", async () => {
    const onSave = vi.fn();
    render(<Harness onSave={onSave} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Table" }));
    const rows = screen.getByRole("spinbutton", { name: "Rows" });
    fireEvent.change(rows, { target: { value: "2.5" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[0]?.[0].visuals[0].options).toEqual({ limit: 2 });
    fireEvent.change(rows, { target: { value: "" } });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave.mock.calls[1]?.[0].visuals[0].options).toEqual({});
  });
});
