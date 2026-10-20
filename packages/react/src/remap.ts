import {
  type ContractColumn,
  type DashboardSpec,
  type DataContract,
  type Expr,
  isIsoDate,
  parse,
  resolveField,
  type SlotItem,
} from "@adam-riffi/dash-core";
import { getVisual } from "@adam-riffi/dash-visuals";
import { accepts, renameRefs } from "./builder.ts";

/** Where a dashboard uses a reference: a slot item, a formula in a slot, a filter, a measure. */
export type Usage =
  | { kind: "slot" | "formula"; visualId: string; slot: string; index: number }
  | { kind: "filter"; index: number }
  | { kind: "measure"; name: string };

/**
 * A table, column or measure the dashboard names and the contract no longer has (ADR 0011).
 * A field is named `schema.table.column` when its table can be found. It is `removable` when no
 * dashboard measure uses it: slot items and filters can go, a measure's formula can't lose a term.
 */
export interface LostRef {
  kind: "field" | "measure";
  name: string;
  usages: Usage[];
  removable: boolean;
}

type FormulaRef = Expr & ({ kind: "field" } | { kind: "measure" });

/** The field and measure references in a formula, in source order; none if it doesn't parse. */
function refsIn(formula: string): FormulaRef[] {
  const parsed = parse(formula);
  const out: FormulaRef[] = [];
  const visit = (e: Expr) => {
    if (e.kind === "field" || e.kind === "measure") out.push(e);
    else if (e.kind === "unary") visit(e.operand);
    else if (e.kind === "binary") {
      visit(e.left);
      visit(e.right);
    } else if (e.kind === "call") for (const a of e.args) visit(a);
  };
  if (parsed.ok) visit(parsed.expr);
  return out;
}

/**
 * A field's name if the contract lacks it, or if it became ambiguous (a `table.column` whose
 * table another schema also has, named as written); undefined when it resolves. A dropped
 * table's `table.column` takes the contract's schema when there is only one, so both spellings of
 * the field are one lost reference.
 */
function lostField(path: string[], contract: DataContract): string | undefined {
  const r = resolveField(path, contract);
  if (r.ok) return undefined;
  if (r.reason === "ambiguous") return path.join(".");
  if (r.table) return `${r.table.name}.${path.at(-1)}`;
  const schemas = new Set(contract.tables.map((t) => t.name.slice(0, t.name.indexOf("."))));
  const [schema] = schemas;
  return path.length === 2 && schemas.size === 1 ? `${schema}.${path.join(".")}` : path.join(".");
}

/** Every lost reference in the dashboard, in the order it first appears, with all its uses. */
export function lostRefs(spec: DashboardSpec, contract: DataContract): LostRef[] {
  const measures = new Set([...contract.measures, ...spec.measures].map((m) => m.name));
  const found = new Map<string, LostRef>();
  const note = (kind: LostRef["kind"], name: string, usage: Usage) => {
    const key = `${kind}:${name}`;
    const ref = found.get(key) ?? { kind, name, usages: [], removable: true };
    found.set(key, ref);
    if (!ref.usages.some((u) => JSON.stringify(u) === JSON.stringify(usage)))
      ref.usages.push(usage);
    if (usage.kind === "measure") ref.removable = false;
  };
  const inFormula = (formula: string, usage: Usage) => {
    for (const r of refsIn(formula)) {
      if (r.kind === "measure" && !measures.has(r.name)) note("measure", r.name, usage);
      const field = r.kind === "field" ? lostField(r.path, contract) : undefined;
      if (field) note("field", field, usage);
    }
  };
  for (const v of spec.visuals) {
    for (const [slot, items] of Object.entries(v.slots)) {
      items.forEach((item, index) => {
        const at = { visualId: v.id, slot, index };
        if ("field" in item) {
          const field = lostField(item.field.split("."), contract);
          if (field) note("field", field, { kind: "slot", ...at });
        } else if ("name" in item) {
          if (!measures.has(item.name)) note("measure", item.name, { kind: "slot", ...at });
        } else inFormula(item.formula, { kind: "formula", ...at });
      });
    }
  }
  spec.filters.forEach((f, index) => {
    const field = lostField(f.field.split("."), contract);
    if (field) note("field", field, { kind: "filter", index });
  });
  for (const m of spec.measures) inFormula(m.formula, { kind: "measure", name: m.name });
  return [...found.values()];
}

/** A name's parts, split at `_` and camelCase, lower-cased, plural `s` dropped (ADR 0004). */
const parts = (name: string) =>
  new Set(
    name
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .toLowerCase()
      .split(/[_\s]+/)
      .filter(Boolean)
      .map((p) => p.replace(/s$/, "")),
  );
const shared = (a: string, b: string) => {
  const of = parts(b);
  return [...parts(a)].filter((p) => of.has(p)).length;
};

/** Whether a column can take a lost field's place in one use, by the gateway's rules. */
function fits(usage: Usage, table: string, column: ContractColumn, spec: DashboardSpec): boolean {
  if (usage.kind === "filter") {
    const values = spec.filters[usage.index]?.values ?? [];
    const type = typeof values[0];
    if (type === "number") return column.type === "number";
    if (type === "boolean") return column.type === "boolean";
    return column.type === "string" || (column.type === "date" && values.every(isIsoDate));
  }
  if (usage.kind !== "slot") return true;
  const visual = spec.visuals.find((v) => v.id === usage.visualId);
  const item = visual?.slots[usage.slot]?.[usage.index];
  const slot = visual && getVisual(visual.type)?.slots.find((s) => s.name === usage.slot);
  if (!item || !slot) return true;
  if (slot.accepts !== "measure") {
    const timed = "timeGrain" in item && item.timeGrain !== undefined;
    return accepts(slot, { kind: "column", table, column }) && (!timed || column.type === "date");
  }
  const aggregation = "aggregation" in item ? item.aggregation : undefined;
  if (aggregation === "COUNT" || aggregation === "COUNT_DISTINCT") return true;
  if (aggregation === "SUM" || aggregation === "AVG") return column.type === "number";
  if (aggregation === "MIN" || aggregation === "MAX") return column.type !== "boolean";
  return column.role === "measure";
}

/** The column role a use asks for, to rank candidates: a measure inside formulas. */
function roleFor(usage: Usage | undefined, spec: DashboardSpec): ContractColumn["role"] {
  if (usage?.kind === "filter") return "dimension";
  if (usage?.kind !== "slot") return "measure";
  const visual = spec.visuals.find((v) => v.id === usage.visualId);
  const slot = visual && getVisual(visual.type)?.slots.find((s) => s.name === usage.slot);
  return slot?.accepts ?? "dimension";
}

/** Sorts best first by each rank in turn, then by original order. */
const ranked = <T extends { rank: number[]; order: number }>(list: T[]) =>
  list.sort((a, b) => {
    for (let i = 0; i < a.rank.length; i++) {
      const d = (b.rank[i] ?? 0) - (a.rank[i] ?? 0);
      if (d !== 0) return d;
    }
    return a.order - b.order;
  });

/**
 * What can replace a lost reference, best first (ADR 0011). For a field: the columns that fit
 * every use, ranked by name parts shared with the lost name, then the lost field's own table,
 * then the role its first use asks for, then contract order. For a measure: the other measures,
 * never one that uses it, ranked by shared name parts.
 */
export function replacements(lost: LostRef, spec: DashboardSpec, contract: DataContract): string[] {
  if (lost.kind === "measure") {
    // The dashboard measures that use it, directly or through each other, would make a cycle.
    const users = new Set([lost.name]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const m of spec.measures) {
        if (users.has(m.name)) continue;
        if (refsIn(m.formula).some((r) => r.kind === "measure" && users.has(r.name))) {
          users.add(m.name);
          grew = true;
        }
      }
    }
    const names = [...new Set([...contract.measures, ...spec.measures].map((m) => m.name))].filter(
      (name) => !users.has(name),
    );
    return ranked(
      names.map((name, order) => ({ name, order, rank: [shared(name, lost.name)] })),
    ).map((c) => c.name);
  }
  const dot = lost.name.lastIndexOf(".");
  const table = lost.name.slice(0, dot);
  const column = lost.name.slice(dot + 1);
  const role = roleFor(lost.usages[0], spec);
  // A field that became ambiguous is most likely one schema's column of the same name, and most
  // likely in the schema the dashboard reads most (alphabetical when nothing tells them apart).
  const resolved = resolveField(lost.name.split("."), contract);
  const used = schemasIn(spec, contract);
  const schemaOf = (field: string) => field.slice(0, field.indexOf("."));
  const first = (!resolved.ok && resolved.reason === "ambiguous" ? resolved.choices : [])
    .map((name, order) => ({ name, order }))
    .sort(
      (a, b) =>
        (used.get(schemaOf(b.name)) ?? 0) - (used.get(schemaOf(a.name)) ?? 0) || a.order - b.order,
    )
    .map((c) => c.name);
  const columns = contract.tables
    .flatMap((t) => t.columns.map((c) => ({ table: t.name, column: c })))
    .filter((c) => lost.usages.every((u) => fits(u, c.table, c.column, spec)));
  const rest = ranked(
    columns.map((c, order) => ({
      name: `${c.table}.${c.column.name}`,
      order,
      rank: [
        shared(c.column.name, column),
        c.table === table ? 1 : 0,
        c.column.role === role ? 1 : 0,
      ],
    })),
  ).map((c) => c.name);
  return [...first, ...rest.filter((name) => !first.includes(name))];
}

/** How many of the dashboard's fields each schema holds, counting only those that resolve. */
function schemasIn(spec: DashboardSpec, contract: DataContract): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (path: string[]) => {
    const r = resolveField(path, contract);
    if (!r.ok) return;
    const schema = r.table.name.slice(0, r.table.name.indexOf("."));
    counts.set(schema, (counts.get(schema) ?? 0) + 1);
  };
  const fromFormula = (formula: string) => {
    for (const r of refsIn(formula)) if (r.kind === "field") add(r.path);
  };
  for (const v of spec.visuals) {
    for (const items of Object.values(v.slots)) {
      for (const i of items) {
        if ("field" in i) add(i.field.split("."));
        else if ("formula" in i) fromFormula(i.formula);
      }
    }
  }
  for (const f of spec.filters) add(f.field.split("."));
  for (const m of spec.measures) fromFormula(m.formula);
  return counts;
}

/** A formula with each reference to the lost field or measure written as `to`. */
function rewrite(formula: string, lost: LostRef, to: string, contract: DataContract): string {
  if (lost.kind === "measure") return renameRefs(formula, lost.name, to);
  let out = "";
  let at = 0;
  for (const r of refsIn(formula)) {
    if (r.kind !== "field" || lostField(r.path, contract) !== lost.name) continue;
    out += formula.slice(at, r.start) + to;
    at = r.end;
  }
  return out + formula.slice(at);
}

/**
 * The dashboard with a lost reference replaced by `to` everywhere, or, when `to` is null (for a
 * `removable` one), with the slot items and filters that used it removed.
 */
export function remap(
  spec: DashboardSpec,
  lost: LostRef,
  to: string | null,
  contract: DataContract,
): DashboardSpec {
  const hits = (field: string) => lostField(field.split("."), contract) === lost.name;
  const mentions = (formula: string) =>
    refsIn(formula).some((r) =>
      r.kind === "field"
        ? lost.kind === "field" && lostField(r.path, contract) === lost.name
        : lost.kind === "measure" && r.name === lost.name,
    );
  const item = (i: SlotItem): SlotItem[] => {
    if (lost.kind === "field" && "field" in i && hits(i.field)) {
      return to ? [{ ...i, field: to }] : [];
    }
    if (lost.kind === "measure" && "name" in i && i.name === lost.name) {
      return to ? [{ name: to }] : [];
    }
    if ("formula" in i && mentions(i.formula)) {
      return to ? [{ formula: rewrite(i.formula, lost, to, contract) }] : [];
    }
    return [i];
  };
  return {
    ...spec,
    measures: to
      ? spec.measures.map((m) => ({ ...m, formula: rewrite(m.formula, lost, to, contract) }))
      : spec.measures,
    filters: spec.filters.flatMap((f) =>
      lost.kind === "field" && hits(f.field) ? (to ? [{ ...f, field: to }] : []) : [f],
    ),
    visuals: spec.visuals.map((v) => ({
      ...v,
      slots: Object.fromEntries(
        Object.entries(v.slots).map(([slot, items]) => [slot, items.flatMap(item)]),
      ),
    })),
  };
}
