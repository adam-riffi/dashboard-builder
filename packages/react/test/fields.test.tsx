// @vitest-environment jsdom
import { dataContract } from "@adam-riffi/dash-core";
import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FieldList } from "../src/index.ts";

afterEach(cleanup);

const col = (
  name: string,
  type: "number" | "string" | "date",
  role: "id" | "time" | "measure" | "dimension",
) => ({
  name,
  pgType: type,
  type,
  nullable: false,
  role,
  ...(role === "measure" ? { aggregation: "SUM" } : {}),
  distinct: null,
  highCardinality: false,
});
const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [
    {
      name: "dash_demo.order_items",
      rowCount: null,
      primaryKey: ["id"],
      columns: [col("id", "number", "id"), col("quantity", "number", "measure")],
    },
    {
      name: "dash_demo.orders",
      rowCount: null,
      primaryKey: ["id"],
      columns: [col("status", "string", "dimension"), col("ordered_at", "date", "time")],
    },
  ],
  relationships: [],
  measures: [
    { name: "Revenue", formula: "SUM(order_items.quantity)", type: "number", format: "currency" },
  ],
});

describe("FieldList", () => {
  const dashboardMeasures = [{ name: "Units", formula: "SUM(order_items.quantity)" }];

  it("lists the host's and the dashboard's measures, then each table's columns", () => {
    render(<FieldList contract={contract} measures={dashboardMeasures} />);
    const measures = screen.getByRole("group", { name: "Measures" });
    expect(
      within(measures)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toEqual(["Revenue", "Units"]);
    const orders = screen.getByRole("group", { name: "Orders" });
    expect(
      within(orders)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Status, dimension", "Ordered at, time"]);
    expect(screen.getByRole("group", { name: "Order items" })).toBeTruthy();
  });

  it("hands the picked field to the builder, as a column or a measure", async () => {
    const onPick = vi.fn();
    render(<FieldList contract={contract} measures={dashboardMeasures} onPick={onPick} />);
    await userEvent.click(screen.getByRole("button", { name: "Quantity, measure" }));
    await userEvent.click(screen.getByRole("button", { name: "Revenue" }));
    expect(
      onPick.mock.calls.map(([d]) =>
        d.kind === "column" ? `${d.table}.${d.column.name}` : d.name,
      ),
    ).toEqual(["dash_demo.order_items.quantity", "Revenue"]);
  });
});
