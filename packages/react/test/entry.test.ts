/// <reference types="node" />
// The test reads the package's sources to follow its imports.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** The packages a source file reaches, following the package's own relative imports. */
function reachable(file: URL, seen = new Set<string>(), found = new Set<string>()) {
  if (seen.has(file.href)) return found;
  seen.add(file.href);
  for (const [, spec = ""] of readFileSync(file, "utf8").matchAll(/(?:from|import)\s+"([^"]+)"/g)) {
    if (spec.startsWith(".")) reachable(new URL(spec, file), seen, found);
    else found.add(spec);
  }
  return found;
}

describe("entry points", () => {
  it("keep the builder's libraries out of the viewer's entry", () => {
    const packages = [...reachable(new URL("../src/index.ts", import.meta.url))];
    expect(packages.filter((p) => /^(@codemirror|@dnd-kit|react-grid-layout)/.test(p))).toEqual([]);
  });

  it("offer the builder from its own entry", async () => {
    const builder = await import("../src/builder-entry.ts");
    expect(builder.DashboardBuilder).toBeTypeOf("function");
  });
});
