"use client";

import type { DashboardSpec, DashboardVisual } from "@adam-riffi/dash-core";
import { getVisual, itemLabel, type SlotDefinition } from "@adam-riffi/dash-visuals";
import { useDroppable } from "@dnd-kit/core";
import { accepts, type Draggable, dropItem, removeItem } from "./builder.ts";

/** What a well carries for dnd-kit, and what a field carries while dragged. */
interface WellData {
  visualId: string;
  slot: string;
}

/** The minimum of a dnd-kit drag end event the drop needs. */
interface DropEvent {
  active: { data: { current?: { item?: Draggable } | undefined } };
  over: { data: { current?: WellData | Record<string, unknown> | undefined } } | null;
}

/**
 * The spec after a drag ends: the dragged field dropped into the well it landed on. Outside a
 * well, or in a well that refuses the field, nothing changes (`dropItem` decides).
 */
export function dropFromEvent(spec: DashboardSpec, event: DropEvent): DashboardSpec {
  const item = event.active.data.current?.item;
  const well = event.over?.data.current as WellData | undefined;
  if (!item || !well?.visualId || !well.slot) return spec;
  return dropItem(spec, well.visualId, well.slot, item);
}

export const labelOfDraggable = (d: Draggable) =>
  d.kind === "measure" ? d.name : itemLabel({ field: `${d.table}.${d.column.name}` });

function Well({
  spec,
  visual,
  slot,
  picked,
  onChange,
}: {
  spec: DashboardSpec;
  visual: DashboardVisual;
  slot: SlotDefinition;
  picked: Draggable | undefined;
  onChange: (spec: DashboardSpec) => void;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: `${visual.id}:${slot.name}`,
    data: { visualId: visual.id, slot: slot.name } satisfies WellData,
  });
  const dragged = active?.data.current?.item as Draggable | undefined;
  const state = !dragged ? "idle" : accepts(slot, dragged) ? "accepts" : "refuses";
  const items = visual.slots[slot.name] ?? [];
  return (
    <fieldset
      ref={setNodeRef}
      aria-label={slot.label}
      className="dash-well"
      data-state={state}
      data-over={isOver || undefined}
    >
      <legend>
        {slot.label}
        {slot.max > 1 ? ` (up to ${slot.max})` : ""}
      </legend>
      <ul style={{ padding: 0, margin: 0 }}>
        {items.map((item, index) => {
          const label = itemLabel(item);
          return (
            <li key={JSON.stringify(item)} style={{ listStyle: "none" }}>
              {label}{" "}
              <button
                type="button"
                aria-label={`Remove ${label} from ${slot.label}`}
                onClick={() => onChange(removeItem(spec, visual.id, slot.name, index))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {items.length === 0 && !picked && <p className="dash-note">Drop a field here</p>}
      {picked && (
        // The keyboard and click path: the same drop, without dragging.
        <button
          type="button"
          disabled={!accepts(slot, picked)}
          onClick={() => onChange(dropItem(spec, visual.id, slot.name, picked))}
        >
          Add {labelOfDraggable(picked)} to {slot.label}
        </button>
      )}
    </fieldset>
  );
}

/**
 * The selected visual's wells, one per slot of its plugin (DESIGN.md §7). Fields arrive by
 * dragging (dnd-kit, in the builder's drag context) or by picking a field, then "Add".
 */
export function SlotWells({
  spec,
  visualId,
  picked,
  onChange,
}: {
  spec: DashboardSpec;
  visualId: string;
  picked: Draggable | undefined;
  onChange: (spec: DashboardSpec) => void;
}) {
  const visual = spec.visuals.find((v) => v.id === visualId);
  const plugin = visual && getVisual(visual.type);
  if (!visual || !plugin) return null;
  return (
    <div className="dash-wells">
      {plugin.slots.map((slot) => (
        <Well
          key={slot.name}
          spec={spec}
          visual={visual}
          slot={slot}
          picked={picked}
          onChange={onChange}
        />
      ))}
    </div>
  );
}
