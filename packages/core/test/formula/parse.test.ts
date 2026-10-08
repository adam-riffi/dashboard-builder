import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { type Expr, parse, print } from "../../src/index.ts";

const ok = (source: string): Expr => {
  const result = parse(source);
  if (!result.ok) throw new Error(result.error.message);
  return result.expr;
};

/** Prefix notation, so precedence is visible in a single string. */
const tree = (e: Expr): string => {
  switch (e.kind) {
    case "number":
      return String(e.value);
    case "string":
      return JSON.stringify(e.value);
    case "field":
      return e.path.join(".");
    case "measure":
      return `[${e.name}]`;
    case "unary":
      return `(${e.op} ${tree(e.operand)})`;
    case "binary":
      return `(${e.op} ${tree(e.left)} ${tree(e.right)})`;
    case "call":
      return `${e.name}(${e.args.map(tree).join(" ")})`;
  }
};

const withoutSpans = (e: Expr) =>
  JSON.parse(JSON.stringify(e, (k, v) => (k === "start" || k === "end" ? undefined : v)));

describe("parse", () => {
  it.each([
    ["1 + 2 * 3", "(+ 1 (* 2 3))"],
    ["(1 + 2) * 3", "(* (+ 1 2) 3)"],
    ["1 - 2 - 3", "(- (- 1 2) 3)"],
    ["8 / 4 / 2", "(/ (/ 8 4) 2)"],
    ["-a.b * 2", "(* (- a.b) 2)"],
    ["- -1", "(- (- 1))"],
    ["a.b + 1 > 2 * c.d", "(> (+ a.b 1) (* 2 c.d))"],
    ["a.x = 1 OR b.y <> 2 AND c.z <= 3", "(OR (= a.x 1) (AND (<> b.y 2) (<= c.z 3)))"],
    ["NOT a.x = 1 AND b.y", "(AND (NOT (= a.x 1)) b.y)"],
    ["not not a.x or b.y", "(OR (NOT (NOT a.x)) b.y)"],
    ['IF(o.status = "paid", o.total, 0)', 'IF((= o.status "paid") o.total 0)'],
    ["sum(dash_demo.order_items.quantity)", "SUM(dash_demo.order_items.quantity)"],
    ["DIVIDE([Revenue], [Orders]) >= 10.5", "(>= DIVIDE([Revenue] [Orders]) 10.5)"],
    ["COUNT()", "COUNT()"],
  ])("reads %s as %s", (source, expected) => {
    expect(tree(ok(source))).toEqual(expected);
  });

  it("gives every node the span of its source text", () => {
    const e = ok("SUM(o.qty) * 2");
    expect(e).toMatchObject({
      kind: "binary",
      start: 0,
      end: 14,
      left: { kind: "call", start: 0, end: 10, args: [{ kind: "field", start: 4, end: 9 }] },
      right: { kind: "number", value: 2, start: 13, end: 14 },
    });
    expect(ok("NOT [Big]")).toMatchObject({ start: 0, end: 9, operand: { start: 4, end: 9 } });
  });

  it.each([
    ["SUM(", "unexpected end of formula", 4, 4],
    ["1 +", "unexpected end of formula", 3, 3],
    ["(1 + 2", "this ( is never closed", 0, 1],
    ["SUM(1, 2", "this ( is never closed", 3, 4],
    ["SUM(1 2)", "expected , or ) but found 2", 6, 7],
    ["1 2", "unexpected 2", 2, 3],
    [")", "unexpected )", 0, 1],
    ["AND 1", "unexpected AND", 0, 3],
    ["orders", "expected a field like table.column or a function call", 0, 6],
    ["orders.", "expected a column name after .", 7, 7],
    ["orders.1", "expected a column name after .", 7, 8],
    ["a.b.c.d", "a field is table.column or schema.table.column", 0, 7],
    ['"open', "unterminated string", 0, 5],
    ["1e999", "number out of range", 0, 5],
    [
      `${"(".repeat(200)}1${")".repeat(200)}`,
      "the formula nests more than 100 levels deep",
      100,
      101,
    ],
    [`${"-".repeat(150)}1`, "the formula nests more than 100 levels deep", 100, 101],
  ])("reports %j at its span", (source, message, start, end) => {
    const result = parse(source);
    expect(result).toMatchObject({ ok: false, error: { start, end } });
    if (!result.ok) expect(result.error.message).toContain(message);
  });
});

it("parses formulas nested up to 100 levels deep", () => {
  expect(parse(`${"(".repeat(99)}1${")".repeat(99)}`).ok).toBe(true);
});

describe("print", () => {
  it.each([
    ["(1 + 2) * 3", "(1 + 2) * 3"],
    ["1 - (2 - 3)", "1 - (2 - 3)"],
    ["(1 - 2) - 3", "1 - 2 - 3"],
    ["-(a.b + 1)", "-(a.b + 1)"],
    ["not (a.x or b.y)", "NOT (a.x OR b.y)"],
    ["(NOT a.x) = b.y", "(NOT a.x) = b.y"],
    ['if(a.b,"say ""hi""",[Big Sales])', 'IF(a.b, "say ""hi""", [Big Sales])'],
  ])("prints %s as %s", (source, expected) => {
    expect(print(ok(source))).toEqual(expected);
  });

  it("round-trips: parsing the printed formula gives the same tree", () => {
    const keyword = (s: string) => ["and", "or", "not"].includes(s.toLowerCase());
    const name = fc.stringMatching(/^[A-Za-z_]\w{0,6}$/).filter((s) => !keyword(s));
    const span = { start: 0, end: 0 };
    const { expr } = fc.letrec<{ expr: Expr }>((tie) => ({
      expr: fc.oneof(
        { depthSize: "small", withCrossShrink: true },
        fc
          .oneof(
            fc.tuple(fc.nat(1_000_000), fc.nat(999)).map(([i, d]) => i + d / 1000),
            // Printed with exponents: 1e-7, 1.5e+300.
            fc.double({ min: 0, noNaN: true, noDefaultInfinity: true }).map(Math.abs),
          )
          .map((value) => ({ kind: "number", value, ...span }) as Expr),
        fc.string().map((value) => ({ kind: "string", value, ...span }) as Expr),
        fc
          .array(name, { minLength: 2, maxLength: 3 })
          .map((path) => ({ kind: "field", path, ...span }) as Expr),
        fc
          .string({ minLength: 1 })
          .filter((s) => !s.includes("]") && s.trim() !== "")
          .map((n) => ({ kind: "measure", name: n, ...span }) as Expr),
        fc
          .tuple(fc.constantFrom("-", "NOT"), tie("expr"))
          .map(([op, operand]) => ({ kind: "unary", op, operand, ...span }) as Expr),
        fc
          .tuple(
            fc.constantFrom("OR", "AND", "=", "<>", "<", "<=", ">", ">=", "+", "-", "*", "/"),
            tie("expr"),
            tie("expr"),
          )
          .map(([op, left, right]) => ({ kind: "binary", op, left, right, ...span }) as Expr),
        fc
          .tuple(
            fc.constantFrom("SUM", "IF", "DIVIDE", "ROUND"),
            fc.array(tie("expr"), { maxLength: 3 }),
          )
          .map(([n, args]) => ({ kind: "call", name: n, args, ...span }) as Expr),
      ),
    }));
    fc.assert(
      fc.property(expr, (e) => {
        expect(withoutSpans(ok(print(e)))).toEqual(withoutSpans(e));
      }),
    );
  });
});
