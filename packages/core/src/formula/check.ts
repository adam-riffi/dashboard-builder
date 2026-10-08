import type { DataContract, FieldType } from "../contract.ts";
import type { FormulaError, Span } from "./lex.ts";
import { type BinaryOp, type Expr, parse } from "./parse.ts";

/** Constants combine with anything; row values and aggregates never mix (DESIGN.md §6). */
export type Level = "constant" | "row" | "aggregate";

/**
 * A checked formula: fields resolved to contract columns, measure references inlined, every
 * node typed. This is the SQL expression tree the gateway renders.
 */
export type Typed = { type: FieldType; level: Level } & (
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "unary"; op: "-" | "NOT"; operand: Typed }
  | { kind: "binary"; op: BinaryOp; left: Typed; right: Typed }
  | { kind: "call"; name: string; args: Typed[] }
);

export interface CheckEnv {
  contract: DataContract;
  /** Named measures, as formula text by name. */
  measures?: ReadonlyMap<string, string>;
}

export type Checking = { ok: true; expr: Typed } | { ok: false; errors: FormulaError[] };

/** Nodes a formula may have once its measure references are expanded. */
export const MAX_FORMULA_NODES = 1_000;
/** How deep measure references may chain, so a chain fails with a span, not a stack overflow. */
export const MAX_REFERENCE_DEPTH = 16;

const GRAINS = ["day", "week", "month", "quarter", "year"];
const AGGREGATES = new Set(["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNTDISTINCT"]);
/** [fewest, most] arguments. */
const ARITY: Record<string, [number, number]> = {
  SUM: [1, 1],
  AVG: [1, 1],
  MIN: [1, 1],
  MAX: [1, 1],
  COUNT: [1, 1],
  COUNTDISTINCT: [1, 1],
  DIVIDE: [2, 2],
  IF: [2, 3],
  COALESCE: [2, Number.POSITIVE_INFINITY],
  ROUND: [1, 2],
  DATE_TRUNC: [2, 2],
};
const COMPARISONS = new Set<BinaryOp>(["=", "<>", "<", "<=", ">", ">="]);
const A: Record<FieldType, string> = {
  number: "a number",
  string: "a string",
  date: "a date",
  boolean: "a true/false value",
};
const MIXED = "a row value cannot be mixed with aggregates; aggregate it, e.g. SUM(...)";

/** The direct subexpressions of a checked node. */
export const children = (t: Typed): Typed[] =>
  t.kind === "unary"
    ? [t.operand]
    : t.kind === "binary"
      ? [t.left, t.right]
      : t.kind === "call"
        ? t.args
        : [];

// Inlined measures share nodes, so sizes are cached per node instead of walking the expansion.
const sizes = new WeakMap<Typed, number>();
function size(t: Typed): number {
  let n = sizes.get(t);
  if (n === undefined) {
    n = children(t).reduce((sum, c) => sum + size(c), 1);
    sizes.set(t, n);
  }
  return n;
}

const arity = (name: string, [min, max]: [number, number]) =>
  min === max
    ? `${name} takes ${min} argument${min === 1 ? "" : "s"}`
    : max === Number.POSITIVE_INFINITY
      ? `${name} takes at least ${min} arguments`
      : `${name} takes ${min} or ${max} arguments`;

/**
 * Type-checks a measure formula against the contract and the named measures (DESIGN.md §6,
 * hand-written core). Every error is reported with the span it is about; a measure's top level
 * must aggregate. Errors inside a referenced measure surface at the reference as `in [Name]: …`.
 */
export function check(
  source: string,
  env: CheckEnv,
  /** Shared by calls with the same env, so each named measure is checked once. */
  memo: Map<string, Checking> = new Map(),
): Checking {
  return checkMeasure(source, env, [], memo);
}

function checkMeasure(
  source: string,
  env: CheckEnv,
  active: string[],
  memo: Map<string, Checking>,
): Checking {
  const parsed = parse(source);
  if (!parsed.ok) return { ok: false, errors: [parsed.error] };
  const errors: FormulaError[] = [];
  const report = (message: string, span: Span): undefined => {
    errors.push({ message, start: span.start, end: span.end });
  };

  const combine = (parts: [Typed, Expr][]): Level | undefined => {
    const levels = parts.map(([t]) => t.level);
    if (levels.includes("aggregate") && levels.includes("row")) {
      for (const [t, e] of parts) if (t.level === "row") report(MIXED, e);
      return undefined;
    }
    return levels.includes("aggregate") ? "aggregate" : levels.includes("row") ? "row" : "constant";
  };

  function field(e: Expr & { kind: "field" }): Typed | undefined {
    const column = e.path.at(-1) as string;
    let tableName = e.path.slice(0, -1).join(".");
    if (e.path.length === 2) {
      const found = env.contract.tables
        .map((t) => t.name)
        .filter((name) => name.slice(name.indexOf(".") + 1) === tableName)
        .sort();
      if (found.length > 1) {
        const schemas = found.map((name) => name.slice(0, name.indexOf(".")));
        const choices = found.map((name) => `${name}.${column}`).join(" or ");
        return report(`${tableName} is in ${schemas.join(" and ")}; write ${choices}`, e);
      }
      tableName = found[0] ?? tableName;
    }
    const table = env.contract.tables.find((t) => t.name === tableName);
    if (!table) return report(`unknown table ${e.path.slice(0, -1).join(".")}`, e);
    const found = table.columns.find((c) => c.name === column);
    if (!found) return report(`unknown column ${e.path.join(".")}`, e);
    return { kind: "column", table: table.name, column, type: found.type, level: "row" };
  }

  function measure(e: Expr & { kind: "measure" }): Typed | undefined {
    const formula = env.measures?.get(e.name);
    if (formula === undefined) return report(`unknown measure [${e.name}]`, e);
    if (active.length >= MAX_REFERENCE_DEPTH) {
      return report(`measure references nest more than ${MAX_REFERENCE_DEPTH} levels deep`, e);
    }
    if (active.includes(e.name)) {
      const loop = [...active.slice(active.indexOf(e.name)), e.name];
      return report(`circular reference ${loop.map((n) => `[${n}]`).join(" → ")}`, e);
    }
    let result = memo.get(e.name);
    if (!result) {
      result = checkMeasure(formula, env, [...active, e.name], memo);
      memo.set(e.name, result);
    }
    if (!result.ok) return report(`in [${e.name}]: ${result.errors[0]?.message}`, e);
    return result.expr;
  }

  function binary(e: Expr & { kind: "binary" }): Typed | undefined {
    const left = visit(e.left);
    const right = visit(e.right);
    if (!left || !right) return undefined;
    const before = errors.length;
    const sides: [Typed, Expr][] = [
      [left, e.left],
      [right, e.right],
    ];
    let type: FieldType = "boolean";
    if (e.op === "AND" || e.op === "OR") {
      for (const [t, s] of sides) {
        if (t.type !== "boolean") report(`${e.op} needs true/false values, not ${A[t.type]}`, s);
      }
    } else if (COMPARISONS.has(e.op)) {
      if (left.type !== right.type) {
        report(`cannot compare ${A[left.type]} with ${A[right.type]}`, e);
      } else if (left.type === "boolean" && e.op !== "=" && e.op !== "<>") {
        report(`${e.op} needs numbers, dates or strings`, e);
      }
    } else {
      type = "number";
      for (const [t, s] of sides) {
        if (t.type !== "number") report(`${e.op} needs numbers, not ${A[t.type]}`, s);
      }
    }
    const level = combine(sides);
    if (!level || errors.length > before) return undefined;
    return { kind: "binary", op: e.op, left, right, type, level };
  }

  function call(e: Expr & { kind: "call" }): Typed | undefined {
    const bounds = ARITY[e.name];
    if (!bounds) {
      report(`unknown function ${e.name}`, { start: e.start, end: e.start + e.name.length });
      e.args.forEach(visit);
      return undefined;
    }
    if (e.args.length < bounds[0] || e.args.length > bounds[1]) {
      return report(arity(e.name, bounds), e);
    }
    const typed = e.args.map(visit);
    if (!typed.every((t) => t !== undefined)) return undefined;
    const args = typed as Typed[];
    const parts = args.map((t, i): [Typed, Expr] => [t, e.args[i] as Expr]);
    const [first, second] = parts as [[Typed, Expr], [Typed, Expr] | undefined];
    const node = (type: FieldType, level: Level, list = args): Typed => ({
      kind: "call",
      name: e.name,
      args: list,
      type,
      level,
    });

    if (AGGREGATES.has(e.name)) {
      const [arg, at] = first;
      if (arg.level === "aggregate") return report("aggregates cannot be nested", at);
      if ((e.name === "SUM" || e.name === "AVG") && arg.type !== "number") {
        return report(`${e.name} needs a number, not ${A[arg.type]}`, at);
      }
      if ((e.name === "MIN" || e.name === "MAX") && arg.type === "boolean") {
        return report(`${e.name} needs a number, date or string`, at);
      }
      if (e.name === "COUNT" && arg.type === "boolean") {
        return report(
          "COUNT counts every row with a value, true or false; use COUNT(IF(condition, table.column)) or SUM(IF(condition, 1, 0))",
          at,
        );
      }
      const minMax = e.name === "MIN" || e.name === "MAX";
      return node(minMax ? arg.type : "number", "aggregate");
    }

    const before = errors.length;
    let type: FieldType = first[0].type;
    // ROUND's digits are checked as a literal below, so only its value sets the level.
    const level = e.name === "ROUND" ? first[0].level : combine(parts);
    switch (e.name) {
      case "DIVIDE":
        for (const [t, s] of parts) {
          if (t.type !== "number") report(`DIVIDE needs numbers, not ${A[t.type]}`, s);
        }
        break;
      case "IF": {
        const [, , otherwise] = parts;
        if (first[0].type !== "boolean") {
          report(`IF needs a true/false condition, not ${A[first[0].type]}`, first[1]);
        }
        type = (second as [Typed, Expr])[0].type;
        if (otherwise && otherwise[0].type !== type) {
          const types = `${type} and ${otherwise[0].type}`;
          report(`IF's branches must have the same type: ${types}`, otherwise[1]);
        }
        break;
      }
      case "COALESCE":
        for (const [t, s] of parts.slice(1)) {
          if (t.type !== type) {
            report(`COALESCE's values must have the same type: ${type} and ${t.type}`, s);
          }
        }
        break;
      case "ROUND":
        if (type !== "number") report(`ROUND needs a number, not ${A[type]}`, first[1]);
        if (second) {
          const digits = second[1];
          const whole = digits.kind === "number" && Number.isInteger(digits.value);
          if (!whole || digits.value > 15) {
            report("ROUND's digits must be a whole number from 0 to 15", digits);
          }
        }
        break;
      case "DATE_TRUNC": {
        const date = second as [Typed, Expr];
        const grain = first[1].kind === "string" ? first[1].value.toLowerCase() : "";
        if (!GRAINS.includes(grain)) {
          report(`DATE_TRUNC's grain is one of ${GRAINS.join(", ")}`, first[1]);
        }
        if (date[0].type !== "date") {
          report(`DATE_TRUNC needs a date, not ${A[date[0].type]}`, date[1]);
        }
        if (errors.length > before) return undefined;
        const unit: Typed = { kind: "string", value: grain, type: "string", level: "constant" };
        return node("date", date[0].level, [unit, date[0]]);
      }
    }
    if (!level || errors.length > before) return undefined;
    return node(type, level);
  }

  function visit(e: Expr): Typed | undefined {
    switch (e.kind) {
      case "number":
        return { kind: "number", value: e.value, type: "number", level: "constant" };
      case "string":
        return { kind: "string", value: e.value, type: "string", level: "constant" };
      case "field":
        return field(e);
      case "measure":
        return measure(e);
      case "unary": {
        const operand = visit(e.operand);
        if (!operand) return undefined;
        const type = e.op === "-" ? "number" : "boolean";
        if (operand.type !== type) {
          const needs = e.op === "-" ? "- needs a number" : "NOT needs a true/false value";
          return report(`${needs}, not ${A[operand.type]}`, e.operand);
        }
        return { kind: "unary", op: e.op, operand, type, level: operand.level };
      }
      case "binary":
        return binary(e);
      case "call":
        return call(e);
    }
  }

  const typed = visit(parsed.expr);
  if (typed && typed.level !== "aggregate") {
    report("a measure must aggregate its rows, e.g. SUM(table.column)", parsed.expr);
  } else if (typed && size(typed) > MAX_FORMULA_NODES) {
    report(
      `too large once its measures are expanded (over ${MAX_FORMULA_NODES} parts)`,
      parsed.expr,
    );
  }
  return typed && errors.length === 0 ? { ok: true, expr: typed } : { ok: false, errors };
}
