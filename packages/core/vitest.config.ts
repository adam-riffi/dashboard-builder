import { defineConfig } from "vitest/config";

// DESIGN.md §10: core and gateway keep at least 90% line coverage.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    coverage: { provider: "v8", include: ["src/**"], thresholds: { lines: 90 } },
  },
});
