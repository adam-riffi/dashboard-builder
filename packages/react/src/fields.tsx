"use client";

import type { DataContract, NamedMeasure } from "@adam-riffi/dash-core";
import { itemLabel } from "@adam-riffi/dash-visuals";
import type { Draggable } from "./builder.ts";

/** `order_items` → `Order items`. */
const humanize = (name: string) => {
  const words = name
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
};

const BADGE = { measure: "Σ", time: "◷", id: "#", dimension: "Aa" } as const;

/** One field: a button that hands it to the builder (and, with PR 3, a drag source). */
function FieldItem({
  item,
  label,
  badge,
  ariaLabel,
  onPick,
}: {
  item: Draggable;
  label: string;
  badge?: string;
  ariaLabel?: string;
  onPick?: ((item: Draggable) => void) | undefined;
}) {
  return (
    <li style={{ listStyle: "none" }}>
      <button
        type="button"
        className="dash-field"
        aria-label={ariaLabel}
        onClick={() => onPick?.(item)}
      >
        {badge && (
          <span aria-hidden="true" className="dash-badge">
            {badge}
          </span>
        )}
        {label}
      </button>
    </li>
  );
}

/**
 * The fields a user can build with (DESIGN.md §7): the host's and the dashboard's measures, then
 * every table's columns marked by role. Picking a field hands it to the builder.
 */
export function FieldList({
  contract,
  measures,
  onPick,
}: {
  contract: DataContract;
  measures: NamedMeasure[];
  onPick?: (item: Draggable) => void;
}) {
  const named = [
    ...contract.measures.map((m) => m.name),
    ...measures.map((m) => m.name).filter((n) => !contract.measures.some((m) => m.name === n)),
  ];
  return (
    <nav aria-label="Fields" className="dash-fields">
      <fieldset className="dash-group">
        <legend>Measures</legend>
        <ul style={{ padding: 0, margin: 0 }}>
          {named.map((name) => (
            <FieldItem key={name} item={{ kind: "measure", name }} label={name} onPick={onPick} />
          ))}
        </ul>
      </fieldset>
      {contract.tables.map((table) => {
        const title = humanize(table.name.slice(table.name.indexOf(".") + 1));
        return (
          <fieldset key={table.name} className="dash-group">
            <legend>{title}</legend>
            <ul style={{ padding: 0, margin: 0 }}>
              {table.columns.map((column) => {
                const label = itemLabel({ field: `${table.name}.${column.name}` });
                return (
                  <FieldItem
                    key={column.name}
                    item={{ kind: "column", table: table.name, column }}
                    label={label}
                    badge={BADGE[column.role]}
                    ariaLabel={`${label}, ${column.role}`}
                    onPick={onPick}
                  />
                );
              })}
            </ul>
          </fieldset>
        );
      })}
    </nav>
  );
}
