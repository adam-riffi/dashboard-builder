import {
  calls,
  type FactPlan,
  type JoinPlan,
  type ResultColumn,
  type TimeGrain,
  type Typed,
  tablesOf,
  type ValidQuery,
} from "@adam-riffi/dash-core";

/** A row policy (DESIGN.md §6): `table.column` must be in the scope list named by `in`. */
export interface Policy {
  table: string;
  column: string;
  in: string;
}

/** One result column, in select order: dimensions `d0…`, then measures `m0…`. */
export type OutputColumn = ResultColumn;

export interface CompiledQuery {
  text: string;
  params: unknown[];
  columns: OutputColumn[];
}

export type Compilation = { ok: true; query: CompiledQuery } | { ok: false; errors: string[] };

const OPERATORS = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;
const AGGREGATES = new Set(["SUM", "AVG", "MIN", "MAX", "COUNT"]);
/** The functions that need a grouped CTE and an outer query (ADR 0013). */
const TWO_STAGE = new Set(["PREVIOUSPERIOD", "RUNNINGSUM", "ALL"]);
const PREVIOUS = new Set(["PREVIOUSPERIOD"]);
/** A column, as `ALL` names it and filters and dimensions hold it. */
interface Field {
  table: string;
  column: string;
}

/** One bucket of each grain as an interval; Postgres has no 'quarter' interval unit. */
const STEP: Record<TimeGrain, string> = {
  day: "1 day",
  week: "7 days",
  month: "1 month",
  quarter: "3 months",
  year: "1 year",
};

/**
 * How a two-stage compile renders a measure over the grouped CTE `g` (ADR 0013): an aggregate
 * becomes one of its columns (or of `p`, the previous window, inside `PREVIOUSPERIOD`), and
 * `RUNNINGSUM` becomes a window along the time axis. Over several fact tables, an aggregate
 * becomes a column of its fact's CTE instead (ADR 0014).
 */
export interface Stage {
  /**
   * Records an aggregate's SQL as a CTE column and returns the outer reference to it: in `g`,
   * in `p` for the previous window, or in a total CTE for the fields `ALL` lifted.
   */
  column: (sql: string, previous: boolean, lifted: Field[], aggregate: Typed) => string;
  previous: boolean;
  lifted: Field[];
  /** The outer references of the time axis and of the other dimensions. */
  time: string;
  others: string[];
}

/**
 * Renders a checked formula as a Postgres expression (DESIGN.md §6). Every binary operation is
 * parenthesized; literals are bound with a cast so Postgres never infers an integer type for
 * them; division is numeric so integers do not truncate, and `DIVIDE` returns null on zero.
 * `filter` is the row condition of the `CALCULATE`s around this node (ADR 0013): every aggregate
 * inside gets it as `filter (where …)`.
 */
export function renderFormula(
  t: Typed,
  ref: (table: string, column: string) => string,
  bind: (value: unknown) => string,
  filter?: string,
  stage?: Stage,
): string {
  const r = (e: Typed) => renderFormula(e, ref, bind, filter, stage);
  // An aggregate's argument is row-level: base-table columns, no filter, no stage.
  const row = (e: Typed) => renderFormula(e, ref, bind);
  const filtered = (aggregate: string) => {
    const sql = filter === undefined ? aggregate : `${aggregate} filter (where ${filter})`;
    return stage ? stage.column(sql, stage.previous, stage.lifted, t) : sql;
  };
  switch (t.kind) {
    case "number":
      return `${bind(t.value)}::numeric`;
    case "string":
      return `${bind(t.value)}::text`;
    case "column":
      // The contract types enum, uuid and char columns as strings; as text they compare with
      // string literals and with each other (a no-op for text columns).
      return t.type === "string" ? `${ref(t.table, t.column)}::text` : ref(t.table, t.column);
    case "unary":
      return t.op === "-" ? `(-${r(t.operand)})` : `(not ${r(t.operand)})`;
    case "binary":
      if (t.op === "/") return `((${r(t.left)})::numeric / ${r(t.right)})`;
      return `(${r(t.left)} ${t.op === "AND" || t.op === "OR" ? t.op.toLowerCase() : t.op} ${r(t.right)})`;
    case "call": {
      const [a, b, c] = t.args as [Typed, Typed | undefined, Typed | undefined];
      if (AGGREGATES.has(t.name)) return filtered(`${t.name.toLowerCase()}(${row(a)})`);
      switch (t.name) {
        case "COUNTDISTINCT":
          return filtered(`count(distinct ${row(a)})`);
        case "CALCULATE": {
          const isLift = (c: Typed) => c.kind === "call" && c.name === "ALL";
          const lifts = t.args.slice(1).filter(isLift);
          // Conditions are row-level: they render without the surrounding filter, then join it.
          const conditions = t.args
            .slice(1)
            .filter((c) => !isLift(c))
            .map(row);
          const all = filter === undefined ? conditions : [filter, ...conditions];
          let inner = stage;
          if (lifts.length > 0) {
            if (!stage) throw new Error("ALL needs the two-stage compile");
            const fields = lifts.map((l) => l.kind === "call" && l.args[0]);
            const lifted = fields.flatMap((f) =>
              f && f.kind === "column" ? [{ table: f.table, column: f.column }] : [],
            );
            inner = { ...stage, lifted: [...stage.lifted, ...lifted] };
          }
          return renderFormula(a, ref, bind, all.length > 0 ? all.join(" and ") : undefined, inner);
        }
        case "PREVIOUSPERIOD":
          if (!stage) throw new Error("PREVIOUSPERIOD needs the two-stage compile");
          return renderFormula(a, ref, bind, filter, { ...stage, previous: true });
        case "RUNNINGSUM": {
          if (!stage) throw new Error("RUNNINGSUM needs the two-stage compile");
          const partition =
            stage.others.length > 0 ? `partition by ${stage.others.join(", ")} ` : "";
          const frame = "rows between unbounded preceding and current row";
          return `sum(${r(a)}) over (${partition}order by ${stage.time} ${frame})`;
        }
        case "DIVIDE":
          return `((${r(a)})::numeric / nullif(${r(b as Typed)}, 0))`;
        case "IF":
          return `case when ${r(a)} then ${r(b as Typed)}${c ? ` else ${r(c)}` : ""} end`;
        case "COALESCE":
          return `coalesce(${t.args.map(r).join(", ")})`;
        case "ROUND":
          // The checker only lets a whole-number literal through as the digits.
          return `round((${r(a)})::numeric${b?.kind === "number" ? `, ${bind(b.value)}::int` : ""})`;
        case "DATE_TRUNC":
          return `date_trunc(${r(a)}, ${r(b as Typed)})`;
      }
      throw new Error(`no SQL for function ${t.name}`);
    }
  }
}

/** Identifiers only ever come from the contract, and are always quoted. */
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
const quoteTable = (table: string) => table.split(".").map(quote).join(".");

/**
 * `a` equals `b`, nulls included, in a form Postgres can hash-join: `is not distinct from` can't
 * be hashed or merged, so joining grouped CTEs with it plans a nested loop (M10 review).
 */
const sameKey = (a: string, b: string) =>
  `coalesce(${a}::text, '') = coalesce(${b}::text, '') and (${a} is null) = (${b} is null)`;

/**
 * Compiles a validated, planned query to parameterized Postgres SQL (DESIGN.md §6). Every table in
 * the query that has a policy gets a mandatory `column = any($n)` predicate bound to the caller's
 * scope; a policy whose scope list is missing fails closed. Values are never part of the text.
 * The limit is one above the requested rows so the executor can report truncation.
 */
export function compileQuery(
  query: ValidQuery,
  plan: JoinPlan,
  policies: Policy[],
  scope: Record<string, unknown>,
): Compilation {
  const params: unknown[] = [];
  const bind = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  const facts = plan.facts ?? [plan];
  const tablesIn = (f: FactPlan) => [f.base, ...f.joins.map((j) => j.to.table)];
  // One alias per table across the facts, so a column reads the same in each fact's CTE.
  const tables = [...new Set(facts.flatMap(tablesIn))];
  const alias = new Map(tables.map((t, i) => [t, quote(`t${i}`)]));
  const ref = (table: string, column: string) => `${alias.get(table)}.${quote(column)}`;

  const errors = tables.flatMap((table) =>
    policies
      .filter((p) => p.table === table && !Array.isArray(scope[p.in]))
      .map((p) => `scope has no list ${p.in} for the policy on ${table}`),
  );
  if (errors.length > 0) return { ok: false, errors };
  /** The policies' predicates, bound again for each grouped query that reads the tables. */
  const policyPredicates = (read = tables) =>
    read.flatMap((table) =>
      policies
        .filter((p) => p.table === table)
        .map((p) => `${ref(table, p.column)} = any(${bind(scope[p.in])})`),
    );

  const columns: OutputColumn[] = [];
  const dimensions = query.dimensions.map((d, i) => {
    const key = `d${i}`;
    const column = ref(d.table, d.column.name);
    columns.push({
      key,
      kind: "dimension",
      field: d.field,
      ...(d.timeGrain ? { timeGrain: d.timeGrain } : {}),
      type: d.column.type,
    });
    // The grain comes from a fixed enum, never from free text.
    return `${d.timeGrain ? `date_trunc('${d.timeGrain}', ${column})` : column} as ${quote(key)}`;
  });
  query.measures.forEach((m, i) => {
    const echo =
      "field" in m
        ? { field: m.field, aggregation: m.aggregation }
        : "formula" in m
          ? { formula: m.formula }
          : { name: m.name };
    columns.push({ key: `m${i}`, kind: "measure", ...echo, type: m.expr.type });
  });

  /**
   * The filters' predicates. `shift` moves one column a bucket later before comparing, so the
   * filter selects the window one bucket earlier (PREVIOUSPERIOD, ADR 0013).
   */
  const filterPredicates = (
    shift?: { table: string; column: string; step: string },
    lifted: Field[] = [],
  ) =>
    query.filters.flatMap((f) => {
      if (lifted.some((l) => l.table === f.table && l.column === f.column.name)) return [];
      const base = ref(f.table, f.column.name);
      const shifted =
        shift !== undefined && shift.table === f.table && shift.column === f.column.name;
      // A Postgres `date` plus an interval is a timestamp: cast back, so values compare as before.
      const moved = `(${base} + interval '${shift?.step}')`;
      const column = !shifted ? base : f.column.pgType === "date" ? `(${moved})::date` : moved;
      // postgres.js mangles boolean lists (a list of booleans is typed as one boolean, and
      // strings in an inferred boolean[] all become 'f'), so booleans go as an array literal.
      const list = () =>
        f.column.type === "boolean"
          ? `${bind(`{${f.values.map((v) => (v === true ? "t" : "f")).join(",")}}`)}::boolean[]`
          : bind(f.values);
      switch (f.op) {
        case "in":
          return `${column} = any(${list()})`;
        case "not_in":
          return `not (${column} = any(${list()}))`;
        case "between":
          return `${column} between ${bind(f.values[0])} and ${bind(f.values[1])}`;
        default:
          return `${column} ${OPERATORS[f.op]} ${bind(f.values[0])}`;
      }
    });

  const fromOf = (f: FactPlan) => [
    `from ${quoteTable(f.base)} as ${alias.get(f.base)}`,
    ...f.joins.map((j) => {
      const on = j.to.columns
        .map((c, i) => `${ref(j.to.table, c)} = ${ref(j.from.table, j.from.columns[i] as string)}`)
        .join(" and ");
      return `left join ${quoteTable(j.to.table)} as ${alias.get(j.to.table)} on ${on}`;
    }),
  ];
  const where = (predicates: string[]) =>
    predicates.length > 0 ? [`where ${predicates.join(" and ")}`] : [];
  const groupBy =
    query.dimensions.length > 0
      ? [`group by ${query.dimensions.map((_, i) => i + 1).join(", ")}`]
      : [];
  const orderAndLimit = () => {
    const lines: string[] = [];
    if (query.sort.length > 0) {
      // Rows without a value go last in either direction, so a limit keeps the rows that have
      // one (Postgres puts nulls first when descending).
      const keys = query.sort.map(
        (s) => `${quote(`${s.by === "dimension" ? "d" : "m"}${s.index}`)} ${s.dir} nulls last`,
      );
      // Ties fall back to the dimensions, so the rows kept at the limit are always the same.
      const tiebreak = query.dimensions.map((_, i) => String(i + 1));
      lines.push(`order by ${[...keys, ...tiebreak].join(", ")}`);
    } else if (query.dimensions.length > 0) {
      lines.push(`order by ${query.dimensions.map((_, i) => i + 1).join(", ")}`);
    }
    lines.push(`limit ${bind(query.limit + 1)}`);
    return lines;
  };

  /** A grouped CTE body over `kept` dimensions (all of them unless `ALL` lifted some). */
  const grouped = (
    aggregates: string[],
    prefix: string,
    predicates: string[],
    kept = query.dimensions.map((_, i) => i),
    source: FactPlan = plan,
  ) => {
    const select = [
      ...kept.map((i) => dimensions[i]),
      ...aggregates.map((sql, k) => `${sql} as ${quote(`${prefix}${k}`)}`),
    ];
    return [
      select.length > 0 ? `select ${select.join(", ")}` : "select",
      ...fromOf(source),
      ...where(predicates),
      // Without dimensions, `group by ()` still makes one row: one per fact row otherwise, and
      // none when the filters match nothing (M10 review).
      `group by ${kept.length > 0 ? kept.map((_, j) => j + 1).join(", ") : "()"}`,
    ];
  };
  if (plan.facts) {
    // Several facts (ADR 0014): each aggregate goes in the CTE `f…` of the fact its argument
    // reads, the one whose plan reaches all its tables; the keys `k` are every fact's dimension
    // values, and the outer query renders each measure over the facts' columns. The planner
    // refuses time functions and ALL here, so `previous`, `lifted`, `time` and `others` are unused.
    const read = facts.map(tablesIn);
    const aggregates = facts.map(() => [] as string[]);
    const stage: Stage = {
      column: (sql, _previous, _lifted, aggregate) => {
        const used = tablesOf(aggregate);
        const j = facts.findIndex(
          (f, j) => used.includes(f.base) && used.every((t) => read[j]?.includes(t)),
        );
        const list = aggregates[j];
        if (!list) throw new Error(`no fact reads ${used.join(" and ")}`);
        list.push(sql);
        const column = `${quote(`f${j}`)}.${quote(`a${list.length - 1}`)}`;
        // A key only other facts have counts nothing here: 0, as a count of no rows is.
        const counts = aggregate.kind === "call" && aggregate.name.startsWith("COUNT");
        return counts ? `coalesce(${column}, 0)` : column;
      },
      previous: false,
      lifted: [],
      time: "",
      others: [],
    };
    const measures = query.measures.map(
      (m, i) => `${renderFormula(m.expr, ref, bind, undefined, stage)} as ${quote(`m${i}`)}`,
    );
    const keys = query.dimensions.map((_, i) => quote(`d${i}`));
    const ctes = facts.flatMap((f, j) => [
      `${j === 0 ? "with" : "),"} ${quote(`f${j}`)} as (`,
      ...grouped(
        aggregates[j] ?? [],
        "a",
        [...policyPredicates(read[j]), ...filterPredicates()],
        undefined,
        f,
      ),
    ]);
    const union = facts.map((_, j) => `select ${keys.join(", ")} from ${quote(`f${j}`)}`);
    const lines = [
      ...ctes,
      ...(keys.length > 0
        ? ['), "k" as (', ...union.flatMap((u, j) => (j > 0 ? ["union", u] : [u]))]
        : []),
      ")",
      `select ${[...keys.map((k) => `"k".${k} as ${k}`), ...measures].join(", ")}`,
      ...(keys.length > 0
        ? [
            'from "k"',
            ...facts.map((_, j) => {
              const f = quote(`f${j}`);
              return `left join ${f} on ${keys.map((k) => sameKey(`${f}.${k}`, `"k".${k}`)).join(" and ")}`;
            }),
          ]
        : [`from ${facts.map((_, j) => quote(`f${j}`)).join(", ")}`]),
      ...orderAndLimit(),
    ];
    return { ok: true, query: { text: lines.join("\n"), params, columns } };
  }

  if (!query.measures.some((m) => calls(m.expr, TWO_STAGE))) {
    const policyWhere = policyPredicates();
    const measures = query.measures.map(
      (m, i) => `${renderFormula(m.expr, ref, bind)} as ${quote(`m${i}`)}`,
    );
    const lines = [
      `select ${[...dimensions, ...measures].join(", ")}`,
      ...fromOf(plan),
      ...where([...policyWhere, ...filterPredicates()]),
      ...groupBy,
      ...orderAndLimit(),
    ];
    return { ok: true, query: { text: lines.join("\n"), params, columns } };
  }

  // Two stages (ADR 0013): `g` groups the aggregates, `p` the ones read one bucket earlier, `w…`
  // the totals `ALL` lifts fields from, and the outer query renders each measure over them.
  // validateQuery made sure of one time axis wherever a time function needs it.
  const t = query.dimensions.findIndex((d) => d.timeGrain !== undefined);
  const axis = query.dimensions[t];
  const step = axis?.timeGrain ? STEP[axis.timeGrain] : "";
  const current: string[] = [];
  const previous: string[] = [];
  /** ALL's totals, one CTE per set of lifted fields, in the order the measures need them. */
  const totals = new Map<string, { lifted: Field[]; aggregates: string[] }>();
  const others = query.dimensions.flatMap((_, i) => (i === t ? [] : [i]));
  const g = (i: number) => `"g".${quote(`d${i}`)}`;
  const stage: Stage = {
    column: (sql, earlier, lifted) => {
      // The checker refuses ALL with PREVIOUSPERIOD; a total of the previous window has no CTE.
      if (earlier && lifted.length > 0) throw new Error("ALL and PREVIOUSPERIOD don't combine");
      if (lifted.length > 0) {
        const key = lifted
          .map((f) => `${f.table}.${f.column}`)
          .sort()
          .join(",");
        const total = totals.get(key) ?? { lifted, aggregates: [] };
        totals.set(key, total);
        total.aggregates.push(sql);
        const name = quote(`w${[...totals.keys()].indexOf(key)}`);
        return `${name}.${quote(`c${total.aggregates.length - 1}`)}`;
      }
      const list = earlier ? previous : current;
      list.push(sql);
      return earlier
        ? `"p".${quote(`b${list.length - 1}`)}`
        : `"g".${quote(`a${list.length - 1}`)}`;
    },
    previous: false,
    lifted: [],
    time: g(t),
    others: others.map(g),
  };
  const measures = query.measures.map(
    (m, i) => `${renderFormula(m.expr, ref, bind, undefined, stage)} as ${quote(`m${i}`)}`,
  );
  const usesPrevious = query.measures.some((m) => calls(m.expr, PREVIOUS));
  const previousCte = (): string[] => {
    if (!usesPrevious || !axis) return [];
    const window = { table: axis.table, column: axis.column.name, step };
    return [
      '), "p" as (',
      ...grouped(previous, "b", [...policyPredicates(), ...filterPredicates(window)]),
    ];
  };
  const joinPrevious = [
    `("p".${quote(`d${t}`)} + interval '${step}') = ${g(t)}`,
    ...others.map((i) => sameKey(`"p".${quote(`d${i}`)}`, g(i))),
  ].join(" and ");
  // The policies always apply; ALL lifts the grouping and the filters on its fields only.
  const keptBy = (lifted: Field[]) =>
    query.dimensions.flatMap((d, i) =>
      lifted.some((f) => f.table === d.table && f.column === d.column.name) ? [] : [i],
    );
  const totalCtes = () =>
    [...totals.values()].flatMap(({ lifted, aggregates }, k) => [
      `), ${quote(`w${k}`)} as (`,
      ...grouped(
        aggregates,
        "c",
        [...policyPredicates(), ...filterPredicates(undefined, lifted)],
        keptBy(lifted),
      ),
    ]);
  const totalJoins = [...totals.values()].map(({ lifted }, k) => {
    const w = quote(`w${k}`);
    const kept = keptBy(lifted);
    const on = kept.map((i) => sameKey(`${w}.${quote(`d${i}`)}`, g(i)));
    return `left join ${w} on ${on.length > 0 ? on.join(" and ") : "true"}`;
  });
  const lines = [
    'with "g" as (',
    ...grouped(current, "a", [...policyPredicates(), ...filterPredicates()]),
    ...previousCte(),
    ...totalCtes(),
    ")",
    `select ${[...query.dimensions.map((_, i) => `${g(i)} as ${quote(`d${i}`)}`), ...measures].join(", ")}`,
    'from "g"',
    ...(usesPrevious ? [`left join "p" on ${joinPrevious}`] : []),
    ...totalJoins,
    ...orderAndLimit(),
  ];
  return { ok: true, query: { text: lines.join("\n"), params, columns } };
}
