import { describe, expect, it } from "vitest";
import { lex } from "../../src/index.ts";

const tokens = (source: string) => {
  const result = lex(source);
  if (!result.ok) throw new Error(result.error.message);
  return result.tokens.map((t) => [t.kind, t.value, t.start, t.end]);
};

describe("lex", () => {
  it("reads a measure formula with the span of every token", () => {
    expect(tokens("SUM(order_items.quantity) * 2.5")).toEqual([
      ["name", "SUM", 0, 3],
      ["symbol", "(", 3, 4],
      ["name", "order_items", 4, 15],
      ["symbol", ".", 15, 16],
      ["name", "quantity", 16, 24],
      ["symbol", ")", 24, 25],
      ["symbol", "*", 26, 27],
      ["number", "2.5", 28, 31],
      ["end", "", 31, 31],
    ]);
  });

  it("reads numbers with exponents, as printed for very small and very large values", () => {
    expect(tokens("1e-7 2.5E+21 3e5").map(([kind, value]) => [kind, value])).toEqual([
      ["number", "1e-7"],
      ["number", "2.5E+21"],
      ["number", "3e5"],
      ["end", ""],
    ]);
  });

  it("reads two-character operators before one-character ones", () => {
    expect(
      tokens("a<>b<=c>=d<e>f=g+h-i*j/k,(l)")
        .filter(([kind]) => kind === "symbol")
        .map(([, value]) => value),
    ).toEqual(["<>", "<=", ">=", "<", ">", "=", "+", "-", "*", "/", ",", "(", ")"]);
  });

  it("reads strings in double quotes, with a doubled quote as the escape", () => {
    expect(tokens('"say ""hi"""')).toEqual([
      ["string", 'say "hi"', 0, 12],
      ["end", "", 12, 12],
    ]);
    expect(tokens('""')[0]).toEqual(["string", "", 0, 2]);
  });

  it("reads measure references by their bracketed name, spaces included", () => {
    expect(tokens("[Average order value] / 2")[0]).toEqual([
      "measure",
      "Average order value",
      0,
      21,
    ]);
  });

  it("skips spaces, tabs and newlines", () => {
    expect(tokens("\t1\n +\r\n2 ")).toEqual([
      ["number", "1", 1, 2],
      ["symbol", "+", 4, 5],
      ["number", "2", 7, 8],
      ["end", "", 9, 9],
    ]);
  });

  it("keeps identifiers case as written, digits and underscores included", () => {
    expect(tokens("customerId _x9")).toEqual([
      ["name", "customerId", 0, 10],
      ["name", "_x9", 11, 14],
      ["end", "", 14, 14],
    ]);
  });

  it.each([
    ['"open', "unterminated string", 0, 5],
    ['1 + "a""', "unterminated string", 4, 8],
    ["SUM([Revenue", "unterminated measure reference", 4, 12],
    ["[]", "empty measure name", 0, 2],
    ["[  ]", "empty measure name", 0, 4],
    ["1 # 2", "unexpected character #", 2, 3],
    ["a != b", "unexpected character !", 2, 3],
  ])("reports %j at its span", (source, message, start, end) => {
    const result = lex(source);
    expect(result).toMatchObject({ ok: false, error: { start, end } });
    if (!result.ok) expect(result.error.message).toContain(message);
  });
});
