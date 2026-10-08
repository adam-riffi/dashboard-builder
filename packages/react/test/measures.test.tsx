// @vitest-environment jsdom
import {
  type DashboardSpec,
  type DataContract,
  dashboardSpec,
  dataContract,
  MAX_FORMULA_LENGTH,
  MAX_NAMED_MEASURES,
} from "@adam-riffi/dash-core";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MeasureEditor } from "../src/builder-entry.ts";

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

function Harness({
  initial,
  spy,
  host = contract,
}: {
  initial: DashboardSpec;
  spy: (spec: DashboardSpec) => void;
  host?: DataContract;
}) {
  const [spec, setSpec] = useState(initial);
  return (
    <MeasureEditor
      spec={spec}
      contract={host}
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

  it("refuses a host measure's name, which the dashboard measure would shadow (ADR 0007)", async () => {
    const host = {
      ...contract,
      measures: [{ name: "Revenue", formula: "SUM(order_items.quantity)", type: "number" }],
    } as DataContract;
    render(
      <Harness
        initial={withMeasures([{ name: "Units", formula: "SUM(order_items.quantity)" }])}
        spy={vi.fn()}
        host={host}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Edit Units" }));
    const name = screen.getByRole("textbox", { name: "Measure name" });
    await userEvent.clear(name);
    await userEvent.type(name, "Revenue");
    expect(screen.getByText("The host has a measure with this name.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Apply" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it(`offers no new measure past ${MAX_NAMED_MEASURES}`, () => {
    const many = Array.from({ length: MAX_NAMED_MEASURES }, (_, i) => ({
      name: `M${i}`,
      formula: "SUM(order_items.quantity)",
    }));
    render(<Harness initial={withMeasures(many)} spy={vi.fn()} />);
    expect(
      (screen.getByRole("button", { name: "New measure" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it(`keeps Apply off for a formula over ${MAX_FORMULA_LENGTH} characters`, async () => {
    // One long number: a formula the checker accepts, only too long for a spec.
    const long = `SUM(order_items.quantity) + 0.${"0".repeat(MAX_FORMULA_LENGTH)}`;
    const spec = { ...withMeasures([]), measures: [{ name: "Long", formula: long }] };
    render(<Harness initial={spec} spy={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Long" }));
    expect(
      screen.getByText(`Formulas have at most ${MAX_FORMULA_LENGTH} characters.`),
    ).toBeTruthy();
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
