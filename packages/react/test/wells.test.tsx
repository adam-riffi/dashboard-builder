// @vitest-environment jsdom
import { type ContractColumn, type DashboardSpec, dashboardSpec } from "@adam-riffi/dash-core";
import { DndContext } from "@dnd-kit/core";
import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { addVisual, type Draggable, dropFromEvent, dropItem, SlotWells } from "../src/index.ts";

afterEach(cleanup);

const column = (
  name: string,
  type: ContractColumn["type"],
  role: ContractColumn["role"],
): Draggable => ({
  kind: "column",
  table: "dash_demo.products",
  column: {
    name,
    pgType: type,
    type,
    nullable: false,
    role,
    ...(role === "measure" ? { aggregation: "SUM" as const } : {}),
    distinct: null,
    highCardinality: false,
  },
});
const category = column("category", "string", "dimension");
const revenue: Draggable = { kind: "measure", name: "Revenue" };

const empty: DashboardSpec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Untitled",
  layout: [],
  visuals: [],
});
const { spec: withBar, id: bar = "" } = addVisual(empty, "bar");

const wells = (spec: DashboardSpec, picked: Draggable | undefined, onChange = vi.fn()) => {
  render(
    <DndContext>
      <SlotWells spec={spec} visualId={bar} picked={picked} onChange={onChange} />
    </DndContext>,
  );
  return onChange;
};

describe("SlotWells", () => {
  it("shows a well for each of the visual's slots", () => {
    wells(withBar, undefined);
    expect(screen.getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual([
      "Category",
      "Value",
    ]);
  });

  it("puts a picked field into a well that accepts it, updating the spec", async () => {
    const onChange = wells(withBar, category);
    await userEvent.click(screen.getByRole("button", { name: "Add Category to Category" }));
    expect(onChange).toHaveBeenCalledWith(dropItem(withBar, bar, "category", category));
  });

  it("does not let a field into a well that refuses it", () => {
    wells(withBar, category);
    const refused = screen.getByRole("button", {
      name: "Add Category to Value",
    }) as HTMLButtonElement;
    expect(refused.disabled).toBe(true);
  });

  it("lists a well's items and removes one", async () => {
    const filled = dropItem(withBar, bar, "value", revenue);
    const onChange = wells(filled, undefined);
    expect(screen.getByRole("group", { name: "Value" }).textContent).toContain("Revenue");
    await userEvent.click(screen.getByRole("button", { name: "Remove Revenue from Value" }));
    expect(onChange.mock.calls[0]?.[0].visuals[0].slots.value).toEqual([]);
  });
});

describe("dropFromEvent", () => {
  const event = (item: Draggable | undefined, slot: string | undefined) => ({
    active: { data: { current: item ? { item } : undefined } },
    over: slot ? { data: { current: { visualId: bar, slot } } } : null,
  });

  it("drops a dragged field into the well it lands on", () => {
    expect(dropFromEvent(withBar, event(revenue, "value"))).toEqual(
      dropItem(withBar, bar, "value", revenue),
    );
  });

  it("changes nothing when dropped outside a well, or when the well refuses", () => {
    expect(dropFromEvent(withBar, event(revenue, undefined))).toBe(withBar);
    expect(dropFromEvent(withBar, event(revenue, "category"))).toBe(withBar);
  });
});
