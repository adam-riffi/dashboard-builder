// @vitest-environment jsdom
import { type DashboardSpec, dashboardSpec, dataContract } from "@adam-riffi/dash-core";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FiltersEditor, filterFrom, inputsOf } from "../src/index.ts";

afterEach(cleanup);

const col = (name: string, type: "number" | "string" | "date" | "boolean") => ({
  name,
  pgType: type,
  type,
  nullable: false,
  role: "dimension" as const,
  distinct: null,
  highCardinality: false,
});
const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [
    {
      name: "dash_demo.orders",
      rowCount: null,
      primaryKey: [],
      columns: [
        col("status", "string"),
        col("ordered_at", "date"),
        col("refunded", "boolean"),
        col("total", "number"),
      ],
    },
  ],
  relationships: [],
  measures: [],
});
const [status, orderedAt, refunded, total] = contract.tables[0]?.columns ?? [];

describe("filterFrom", () => {
  it.each([
    [
      "a list of strings",
      status,
      "in",
      ["paid, shipped ,"],
      { op: "in", values: ["paid", "shipped"] },
    ],
    ["a list of numbers", total, "not_in", ["10, 20"], { op: "not_in", values: [10, 20] }],
    [
      "a range of dates",
      orderedAt,
      "between",
      ["2026-01-01", "2026-03-31"],
      { op: "between", values: ["2026-01-01", "2026-03-31"] },
    ],
    ["a lower bound", total, "gte", ["100"], { op: "gte", values: [100] }],
    ["true/false values", refunded, "in", ["true"], { op: "in", values: [true] }],
  ] as const)("builds %s", (_, column, op, inputs, expected) => {
    expect(filterFrom("dash_demo.orders.x", column as never, op, [...inputs])).toEqual({
      field: "dash_demo.orders.x",
      ...expected,
    });
  });

  it.each([
    ["an empty list", status, "in", [" , "]],
    ["a word where a number goes", total, "gt", ["many"]],
    ["half a range", orderedAt, "between", ["2026-01-01", ""]],
    ["a date that is not one", orderedAt, "lt", ["2026-02-30"]],
    ["a maybe", refunded, "in", ["maybe"]],
  ] as const)("refuses %s", (_, column, op, inputs) => {
    expect(filterFrom("dash_demo.orders.x", column as never, op, [...inputs])).toBeUndefined();
  });

  it("turns a filter back into its inputs", () => {
    expect(inputsOf({ field: "f", op: "in", values: ["paid", "shipped"] })).toEqual([
      "paid, shipped",
    ]);
    expect(inputsOf({ field: "f", op: "between", values: [1, 5] })).toEqual(["1", "5"]);
  });
});

const empty: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Untitled",
  layout: [],
  visuals: [],
});

function Harness({ spy }: { spy: (spec: DashboardSpec) => void }) {
  const [spec, setSpec] = useState(empty);
  return (
    <FiltersEditor
      spec={spec}
      contract={contract}
      onChange={(s) => {
        setSpec(s);
        spy(s);
      }}
    />
  );
}

describe("FiltersEditor", () => {
  it("adds a filter only once it is complete, then removes it", async () => {
    const spy = vi.fn();
    render(<Harness spy={spy} />);
    await userEvent.click(screen.getByRole("button", { name: "New filter" }));
    const add = screen.getByRole("button", { name: "Add filter" }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: "Field" }),
      "dash_demo.orders.status",
    );
    await userEvent.type(screen.getByRole("textbox", { name: "Values" }), "paid, shipped");
    await userEvent.click(add);
    expect(spy.mock.lastCall?.[0].filters).toEqual([
      { field: "dash_demo.orders.status", op: "in", values: ["paid", "shipped"] },
    ]);
    await userEvent.click(screen.getByRole("button", { name: "Remove filter on Status" }));
    expect(spy.mock.lastCall?.[0].filters).toEqual([]);
  });
});
