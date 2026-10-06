import { defineConfig } from "vitest/config";

// DESIGN.md §10: gateway keeps at least 90% line coverage from unit tests. I/O shells are
// covered by the integration suite instead and are excluded here.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/health.ts",
        "src/index.ts",
        "src/contract/introspect.ts",
        "src/query/execute.ts",
      ],
      thresholds: { lines: 90 },
    },
  },
});
