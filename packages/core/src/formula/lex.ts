/** A range of characters in a formula, `start` inclusive, `end` exclusive. */
export interface Span {
  start: number;
  end: number;
}

/** A problem in a formula, located at the characters it is about. */
export interface FormulaError extends Span {
  message: string;
}

export interface Token extends Span {
  kind: "number" | "string" | "name" | "measure" | "symbol" | "end";
  /** The number or name as written, a string's unescaped content, a measure's name. */
  value: string;
}

export type Lexing = { ok: true; tokens: Token[] } | { ok: false; error: FormulaError };

// Two-character operators come first so that `<=` is never read as `<` then `=`.
const TOKEN = /(\d+(?:\.\d+)?)|([A-Za-z_]\w*)|(<>|<=|>=|[-+*/=<>(),.])/y;

/**
 * Splits a formula into tokens (DESIGN.md §6, hand-written core). Strings use double quotes,
 * with `""` for a quote inside; measure references are `[Name]`. The list ends with an `end`
 * token so the parser can point at the end of the formula.
 */
export function lex(source: string): Lexing {
  const tokens: Token[] = [];
  const fail = (message: string, start: number, end: number): Lexing => ({
    ok: false,
    error: { message, start, end },
  });

  let i = 0;
  while (i < source.length) {
    const start = i;
    const c = source[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (c === '"') {
      let value = "";
      for (i++; source[i] !== '"' || source[i + 1] === '"'; i++) {
        if (i >= source.length) return fail('unterminated string; close it with "', start, i);
        if (source[i] === '"') i++;
        value += source[i];
      }
      i++;
      tokens.push({ kind: "string", value, start, end: i });
    } else if (c === "[") {
      const close = source.indexOf("]", i);
      if (close < 0) {
        return fail("unterminated measure reference; close it with ]", start, source.length);
      }
      const value = source.slice(i + 1, close);
      i = close + 1;
      if (value.trim() === "") return fail("empty measure name", start, i);
      tokens.push({ kind: "measure", value, start, end: i });
    } else {
      TOKEN.lastIndex = i;
      const match = TOKEN.exec(source);
      if (!match) return fail(`unexpected character ${c}`, start, start + 1);
      i = TOKEN.lastIndex;
      const kind = match[1] ? "number" : match[2] ? "name" : "symbol";
      tokens.push({ kind, value: match[0], start, end: i });
    }
  }
  tokens.push({ kind: "end", value: "", start: source.length, end: source.length });
  return { ok: true, tokens };
}
