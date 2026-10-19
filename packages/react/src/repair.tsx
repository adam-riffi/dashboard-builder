"use client";

import type { DashboardSpec, DataContract } from "@adam-riffi/dash-core";
import { useId, useMemo, useState } from "react";
import { type LostRef, lostRefs, remap, replacements, type Usage } from "./remap.ts";

/** A field as people read it, `table.column`, or a measure as formulas write it, `[Name]`. */
const labelOf = (kind: LostRef["kind"], name: string) =>
  kind === "measure" ? `[${name}]` : name.split(".").slice(-2).join(".");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Used by 2 visuals, 1 filter and the measure Units." */
function usedBy(usages: Usage[]): string {
  const visuals = new Set(usages.flatMap((u) => ("visualId" in u ? [u.visualId] : [])));
  const filters = usages.filter((u) => u.kind === "filter").length;
  const measures = usages.flatMap((u) => (u.kind === "measure" ? [u.name] : []));
  const parts = [
    ...(visuals.size > 0 ? [plural(visuals.size, "visual")] : []),
    ...(filters > 0 ? [plural(filters, "filter")] : []),
    ...measures.map((m) => `the measure ${m}`),
  ];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0];
  return `Used by ${list}.`;
}

/** The value of the "Remove it" choice. */
const REMOVE = "";

function LostRow({
  lost,
  spec,
  contract,
  onChange,
}: {
  lost: LostRef;
  spec: DashboardSpec;
  contract: DataContract;
  onChange: (spec: DashboardSpec) => void;
}) {
  const id = useId();
  const options = replacements(lost, spec, contract);
  const [choice, setChoice] = useState(options[0] ?? REMOVE);
  const label = labelOf(lost.kind, lost.name);
  const none = options.length === 0 && !lost.removable;
  return (
    <li>
      {none ? (
        <span>{label}: nothing in the data fits; edit what uses it instead.</span>
      ) : (
        <>
          <label htmlFor={id}>Replace {label} with</label>{" "}
          <select id={id} value={choice} onChange={(e) => setChoice(e.target.value)}>
            {options.map((o) => (
              <option key={o} value={o}>
                {labelOf(lost.kind, o)}
              </option>
            ))}
            {lost.removable && <option value={REMOVE}>Remove it</option>}
          </select>{" "}
          <button
            type="button"
            aria-label={`Apply to ${label}`}
            onClick={() => onChange(remap(spec, lost, choice === REMOVE ? null : choice, contract))}
          >
            Apply
          </button>
        </>
      )}
      <br />
      <small>{usedBy(lost.usages)}</small>
    </li>
  );
}

/**
 * Lists the tables, columns and measures the dashboard names that the contract no longer has,
 * each with its best replacement chosen (ADR 0011). Applying one rewrites the dashboard through
 * `onChange`; the panel renders nothing once nothing is lost.
 */
export function RepairPanel({
  spec,
  contract,
  onChange,
}: {
  spec: DashboardSpec;
  contract: DataContract;
  onChange: (spec: DashboardSpec) => void;
}) {
  const titleId = useId();
  const lost = useMemo(() => lostRefs(spec, contract), [spec, contract]);
  if (lost.length === 0) return null;
  return (
    <section className="dash-repair" aria-labelledby={titleId}>
      <h2 id={titleId}>Fields this dashboard lost</h2>
      <p>The data changed since this dashboard was saved. Choose what takes each one's place.</p>
      <ul>
        {lost.map((l) => (
          <LostRow
            key={`${l.kind}:${l.name}`}
            lost={l}
            spec={spec}
            contract={contract}
            onChange={onChange}
          />
        ))}
      </ul>
    </section>
  );
}
