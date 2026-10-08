"use client";

import type { ContractColumn, DashboardSpec, DataContract, FilterOp } from "@adam-riffi/dash-core";
import { itemLabel } from "@adam-riffi/dash-visuals";
import { useState } from "react";
import { addFilter, removeFilter } from "./builder.ts";

type Filter = DashboardSpec["filters"][number];

/** How many inputs an operator takes: a comma-separated list, or exactly n values. */
const ARITY: Record<FilterOp, "list" | number> = {
  in: "list",
  not_in: "list",
  between: 2,
  gt: 1,
  gte: 1,
  lt: 1,
  lte: 1,
};
const OP_LABEL: Record<FilterOp, string> = {
  in: "is one of",
  not_in: "is none of",
  between: "is between",
  gt: "is above",
  gte: "is at least",
  lt: "is below",
  lte: "is at most",
};

const calendarDate = (v: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
};

function parseValue(
  v: string,
  type: ContractColumn["type"],
): string | number | boolean | undefined {
  switch (type) {
    case "number": {
      const n = Number(v);
      return v !== "" && Number.isFinite(n) ? n : undefined;
    }
    case "date":
      return calendarDate(v) ? v : undefined;
    case "boolean":
      return v === "true" ? true : v === "false" ? false : undefined;
    default:
      return v;
  }
}

/**
 * A dashboard filter from what the user typed (DESIGN.md §14: equality, ranges and lists), or
 * nothing while it is incomplete or a value does not fit the column's type.
 */
export function filterFrom(
  field: string,
  column: ContractColumn,
  op: FilterOp,
  inputs: string[],
): Filter | undefined {
  const arity = ARITY[op];
  if (column.type === "boolean" && arity !== "list") return undefined;
  const raw =
    arity === "list"
      ? (inputs[0] ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : inputs.slice(0, arity).map((s) => s.trim());
  if (raw.length === 0 || (arity !== "list" && (raw.length !== arity || raw.includes("")))) {
    return undefined;
  }
  const values = raw.map((v) => parseValue(v, column.type));
  if (values.some((v) => v === undefined)) return undefined;
  return { field, op, values: values as (string | number | boolean)[] };
}

/** A filter's values as the inputs that would build it again. */
export const inputsOf = (filter: Filter): string[] =>
  ARITY[filter.op] === "list" ? [filter.values.join(", ")] : filter.values.map(String);

const INPUT_TYPE = { number: "number", date: "date", string: "text", boolean: "text" } as const;

function NewFilter({
  contract,
  onAdd,
  onCancel,
}: {
  contract: DataContract;
  onAdd: (filter: Filter) => void;
  onCancel: () => void;
}) {
  const [field, setField] = useState("");
  const [op, setOp] = useState<FilterOp>("in");
  const [inputs, setInputs] = useState<string[]>([]);
  const column = contract.tables
    .flatMap((t) => t.columns.map((c) => ({ field: `${t.name}.${c.name}`, column: c })))
    .find((c) => c.field === field)?.column;
  const filter = column && filterFrom(field, column, op, inputs);
  const arity = ARITY[op];
  const names = arity === "list" ? ["Values"] : arity === 1 ? ["Value"] : ["From", "To"];
  const ops = (Object.keys(ARITY) as FilterOp[]).filter(
    (o) => column?.type !== "boolean" || ARITY[o] === "list",
  );
  return (
    <fieldset className="dash-group">
      <legend>New filter</legend>
      <select aria-label="Field" value={field} onChange={(e) => setField(e.target.value)}>
        <option value="">Choose a field</option>
        {contract.tables.map((t) => (
          <optgroup key={t.name} label={t.name}>
            {t.columns.map((c) => (
              <option key={c.name} value={`${t.name}.${c.name}`}>
                {itemLabel({ field: `${t.name}.${c.name}` })}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <select aria-label="Operator" value={op} onChange={(e) => setOp(e.target.value as FilterOp)}>
        {ops.map((o) => (
          <option key={o} value={o}>
            {OP_LABEL[o]}
          </option>
        ))}
      </select>
      {names.map((name, i) => (
        <input
          key={name}
          aria-label={name}
          type={arity === "list" ? "text" : INPUT_TYPE[column?.type ?? "string"]}
          placeholder={arity === "list" ? "a, b, c" : undefined}
          value={inputs[i] ?? ""}
          onChange={(e) => setInputs((all) => Object.assign([...all], { [i]: e.target.value }))}
        />
      ))}
      <button type="button" disabled={!filter} onClick={() => filter && onAdd(filter)}>
        Add filter
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </fieldset>
  );
}

/** The dashboard's filters, applied to every visual: listed, removable, and added one by one. */
export function FiltersEditor({
  spec,
  contract,
  onChange,
}: {
  spec: DashboardSpec;
  contract: DataContract;
  onChange: (spec: DashboardSpec) => void;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section aria-label="Dashboard filters" className="dash-filters">
      <h4>Filters</h4>
      <ul style={{ padding: 0, margin: 0 }}>
        {spec.filters.map((f, i) => {
          const label = itemLabel({ field: f.field });
          return (
            <li key={`${f.field}-${f.op}-${inputsOf(f).join("|")}`} style={{ listStyle: "none" }}>
              {label} {OP_LABEL[f.op]} {inputsOf(f).join(" and ")}{" "}
              <button
                type="button"
                aria-label={`Remove filter on ${label}`}
                onClick={() => onChange(removeFilter(spec, i))}
              >
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {adding ? (
        <NewFilter
          contract={contract}
          onAdd={(f) => {
            onChange(addFilter(spec, f));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <button type="button" onClick={() => setAdding(true)} disabled={spec.filters.length >= 20}>
          New filter
        </button>
      )}
    </section>
  );
}
