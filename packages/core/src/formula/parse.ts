import { type FormulaError, lex, type Span, type Token } from "./lex.ts";

export type BinaryOp = "OR" | "AND" | "=" | "<>" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/";

/** A parsed formula; every node carries the span of its source text. */
export type Expr = Span &
  (
    | { kind: "number"; value: number }
    | { kind: "string"; value: string }
    /** `table.column` or `schema.table.column`, as written. */
    | { kind: "field"; path: string[] }
    | { kind: "measure"; name: string }
    | { kind: "unary"; op: "-" | "NOT"; operand: Expr }
    | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
    /** Function names are upper-cased; arity is the type checker's job. */
    | { kind: "call"; name: string; args: Expr[] }
  );

export type Parsing = { ok: true; expr: Expr } | { ok: false; error: FormulaError };

/** Binding powers: a higher number binds tighter (DESIGN.md §6 precedence). */
const BINARY: Record<BinaryOp, number> = {
  OR: 1,
  AND: 2,
  "=": 4,
  "<>": 4,
  "<": 4,
  "<=": 4,
  ">": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
};
const NOT = 3;
const NEGATE = 7;
const ATOM = 8;

class ParseError extends Error {
  constructor(
    message: string,
    readonly span: Span,
  ) {
    super(message);
  }
}

const keyword = (t: Token) => (t.kind === "name" ? t.value.toUpperCase() : undefined);

function binaryOp(t: Token): BinaryOp | undefined {
  const op = t.kind === "symbol" ? t.value : keyword(t);
  return op !== undefined && op in BINARY ? (op as BinaryOp) : undefined;
}

/**
 * Parses a formula (DESIGN.md §6, hand-written core) with a Pratt parser: binary operators are
 * left-associative, `NOT` sits between `AND` and the comparisons, unary minus binds tightest.
 * The first syntax error stops the parse and is reported at its span.
 */
export function parse(source: string): Parsing {
  const lexed = lex(source);
  if (!lexed.ok) return lexed;
  const tokens = lexed.tokens;
  let at = 0;
  const peek = () => tokens[at] as Token;
  const next = () => tokens[at++] as Token;
  const unexpected = (t: Token) =>
    new ParseError(
      t.kind === "end" ? "unexpected end of formula" : `unexpected ${source.slice(t.start, t.end)}`,
      t,
    );

  const closing = (open: Token) => {
    const t = next();
    if (t.kind === "end") throw new ParseError("this ( is never closed", open);
    if (t.value !== ")" || t.kind !== "symbol") throw unexpected(t);
    return t;
  };

  function expression(minPower: number): Expr {
    let left = prefix();
    for (let op = binaryOp(peek()); op && BINARY[op] > minPower; op = binaryOp(peek())) {
      next();
      const right = expression(BINARY[op]);
      left = { kind: "binary", op, left, right, start: left.start, end: right.end };
    }
    return left;
  }

  function prefix(): Expr {
    const t = next();
    switch (t.kind) {
      case "number":
        return { kind: "number", value: Number(t.value), start: t.start, end: t.end };
      case "string":
        return { kind: "string", value: t.value, start: t.start, end: t.end };
      case "measure":
        return { kind: "measure", name: t.value, start: t.start, end: t.end };
      case "symbol":
        if (t.value === "(") {
          const inner = expression(0);
          closing(t);
          return inner;
        }
        if (t.value === "-") {
          const operand = expression(NEGATE);
          return { kind: "unary", op: "-", operand, start: t.start, end: operand.end };
        }
        throw unexpected(t);
      case "name":
        return named(t);
      default:
        throw unexpected(t);
    }
  }

  function named(t: Token): Expr {
    const word = keyword(t);
    if (word === "NOT") {
      const operand = expression(NOT);
      return { kind: "unary", op: "NOT", operand, start: t.start, end: operand.end };
    }
    if (word === "AND" || word === "OR") throw unexpected(t);
    const after = peek();
    if (after.kind === "symbol" && after.value === "(") {
      next();
      const args: Expr[] = [];
      if (peek().kind !== "symbol" || peek().value !== ")") {
        for (;;) {
          args.push(expression(0));
          const sep = peek();
          if (sep.kind !== "symbol" || sep.value !== ",") break;
          next();
        }
      }
      const sep = peek();
      if (sep.kind !== "end" && (sep.kind !== "symbol" || sep.value !== ")")) {
        throw new ParseError(`expected , or ) but found ${source.slice(sep.start, sep.end)}`, sep);
      }
      const end = closing(after).end;
      return { kind: "call", name: t.value.toUpperCase(), args, start: t.start, end };
    }
    const path = [t.value];
    let end = t.end;
    while (peek().kind === "symbol" && peek().value === ".") {
      next();
      const part = peek();
      if (part.kind !== "name") throw new ParseError("expected a column name after .", part);
      next();
      path.push(part.value);
      end = part.end;
    }
    if (path.length === 1) {
      throw new ParseError("expected a field like table.column or a function call", t);
    }
    if (path.length > 3) {
      throw new ParseError("a field is table.column or schema.table.column", {
        start: t.start,
        end,
      });
    }
    return { kind: "field", path, start: t.start, end };
  }

  try {
    const expr = expression(0);
    if (peek().kind !== "end") throw unexpected(peek());
    return { ok: true, expr };
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    return {
      ok: false,
      error: { message: error.message, start: error.span.start, end: error.span.end },
    };
  }
}

const power = (e: Expr) =>
  e.kind === "binary" ? BINARY[e.op] : e.kind === "unary" ? (e.op === "NOT" ? NOT : NEGATE) : ATOM;

/** `e` as text, in parentheses when its operator binds looser than `min` allows. */
const inside = (e: Expr, min: number) => (power(e) < min ? `(${print(e)})` : print(e));

/**
 * Prints a formula with only the parentheses precedence needs, so that parsing the result gives
 * the same tree back (DESIGN.md §10 round-trip property).
 */
export function print(e: Expr): string {
  switch (e.kind) {
    case "number":
      return String(e.value);
    case "string":
      return `"${e.value.replaceAll('"', '""')}"`;
    case "field":
      return e.path.join(".");
    case "measure":
      return `[${e.name}]`;
    case "unary":
      return e.op === "-" ? `-${inside(e.operand, NEGATE)}` : `NOT ${inside(e.operand, NOT)}`;
    case "binary": {
      const p = BINARY[e.op];
      // Left-associative: an equal operator on the right needs parentheses, on the left not.
      return `${inside(e.left, p)} ${e.op} ${inside(e.right, p + 1)}`;
    }
    case "call":
      return `${e.name}(${e.args.map(print).join(", ")})`;
  }
}
