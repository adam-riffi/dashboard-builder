import { check, type DataContract, FUNCTIONS, type NamedMeasure } from "@adam-riffi/dash-core";

export interface Completion {
  label: string;
  type: "function" | "class" | "property" | "variable" | "keyword";
  detail?: string;
  /** What is inserted, when it differs from the label. */
  apply?: string;
}

const KEYWORDS = ["AND", "OR", "NOT"];

/**
 * What the formula editor offers at a position (DESIGN.md §6): measure names inside `[`, a
 * table's columns after `table.`, otherwise functions, tables and keywords. Nothing inside a
 * string. The editor filters the options against what was typed since `from`.
 */
export function completionsAt(
  doc: string,
  pos: number,
  contract: DataContract,
  measures: NamedMeasure[],
): { from: number; options: Completion[] } | null {
  const before = doc.slice(0, pos);
  // Strings escape a quote by doubling it, so an odd count means the cursor is inside one.
  if ((before.match(/"/g)?.length ?? 0) % 2 === 1) return null;
  const open = before.lastIndexOf("[");
  if (open > before.lastIndexOf("]")) {
    const names = [...new Set([...contract.measures, ...measures].map((m) => m.name))];
    return {
      from: open + 1,
      options: names.map((name) => ({ label: name, type: "variable", apply: `${name}]` })),
    };
  }
  const word = before.match(/[A-Za-z_][\w.]*$/)?.[0];
  if (!word || /\d/.test(before.charAt(pos - word.length - 1))) return null;
  const dot = word.lastIndexOf(".");
  if (dot >= 0) {
    const table = word.slice(0, dot);
    const options = contract.tables
      .filter((t) => t.name === table || t.name.slice(t.name.indexOf(".") + 1) === table)
      .flatMap((t) =>
        t.columns.map((c): Completion => ({ label: c.name, type: "property", detail: c.type })),
      );
    return options.length > 0 ? { from: pos - (word.length - dot - 1), options } : null;
  }
  const tables = [...new Set(contract.tables.map((t) => t.name.slice(t.name.indexOf(".") + 1)))];
  return {
    from: pos - word.length,
    options: [
      ...FUNCTIONS.map((f): Completion => ({ label: f, type: "function", apply: `${f}(` })),
      ...tables.map((t): Completion => ({ label: t, type: "class", apply: `${t}.` })),
      ...KEYWORDS.map((k): Completion => ({ label: k, type: "keyword" })),
    ],
  };
}

/** The checker's errors as the editor's diagnostics, at the characters they are about. */
export function diagnosticsOf(formula: string, contract: DataContract, measures: NamedMeasure[]) {
  const named = new Map([...contract.measures, ...measures].map((m) => [m.name, m.formula]));
  const checked = check(formula, { contract, measures: named });
  if (checked.ok) return [];
  return checked.errors.map((e) => ({
    from: e.start,
    to: e.end,
    severity: "error" as const,
    message: e.message,
  }));
}
