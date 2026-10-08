// @vitest-environment jsdom
import { type DashboardSpec, dashboardSpec, dataContract } from "@adam-riffi/dash-core";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeasureEditor } from "../src/index.ts";

afterEach(cleanup);

const contract = dataContract.parse({
  contractVersion: "0".repeat(64),
  tables: [
    {
      name: "dash_demo.order_items",
      rowCount: null,
      primaryKey: [],
      columns: [
        {
          name: "quantity",
          pgType: "int4",
          type: "number",
          nullable: false,
          role: "measure",
          aggregation: "SUM",
          distinct: null,
          highCardinality: false,
        },
      ],
    },
  ],
  relationships: [],
  measures: [],
});
const withMeasures = (measures: DashboardSpec["measures"]) =>
  dashboardSpec.parse({
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "Untitled",
    measures,
    layout: [],
    visuals: [],
  });

function Harness({ initial, spy }: { initial: DashboardSpec; spy: (spec: DashboardSpec) => void }) {
  const [spec, setSpec] = useState(initial);
  return (
    <MeasureEditor
      spec={spec}
      contract={contract}
      onChange={(s) => {
        setSpec(s);
        spy(s);
      }}
    />
  );
}

describe("MeasureEditor", () => {
  it("does not apply a new measure until it has a valid name and formula", async () => {
    render(<Harness initial={withMeasures([])} spy={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "New measure" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Measure name" }), "Units");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("renames a measure and its format", async () => {
    const spy = vi.fn();
    render(
      <Harness
        initial={withMeasures([{ name: "Units", formula: "SUM(order_items.quantity)" }])}
        spy={spy}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Units" }));
    const name = screen.getByRole("textbox", { name: "Measure name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Items");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Format" }), "number");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(spy.mock.lastCall?.[0].measures).toEqual([
      { name: "Items", formula: "SUM(order_items.quantity)", format: "number" },
    ]);
  });

  it("shows a formula's errors and keeps Apply off", async () => {
    render(
      <Harness
        initial={withMeasures([{ name: "Broken", formula: "SUM(order_items.nope)" }])}
        spy={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Broken" }));
    expect(screen.getByRole("alert").textContent).toContain("unknown column order_items.nope");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("refuses a name another measure has, or one with brackets", async () => {
    render(
      <Harness
        initial={withMeasures([
          { name: "Units", formula: "SUM(order_items.quantity)" },
          { name: "Twice", formula: "[Units] * 2" },
        ])}
        spy={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Twice" }));
    const name = screen.getByRole("textbox", { name: "Measure name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Units");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    await userEvent.clear(name);
    // user-event reads "[" as the start of a key name; "[[" types a literal "[".
    await userEvent.type(name, "Twice[[x]");
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("removes a measure", async () => {
    const spy = vi.fn();
    render(
      <Harness
        initial={withMeasures([{ name: "Units", formula: "SUM(order_items.quantity)" }])}
        spy={spy}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Units" }));
    expect(spy.mock.lastCall?.[0].measures).toEqual([]);
  });
});
