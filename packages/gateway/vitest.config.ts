import { defineConfig } from "vitest/config";

// DESIGN.md §10 asks for 90% line coverage from unit tests; M9 holds the gateway at 93%, where it
// stood before the planner moved to core. I/O shells are covered by the integration suite
// instead and are excluded here.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "src/health.ts",
        "src/index.ts",
        "src/contract/introspect.ts",
        "src/query/execute.ts",
      ],
      thresholds: { lines: 93 },
    },
  },
});
