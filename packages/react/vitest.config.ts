import { defineConfig } from "vitest/config";

// Request assembly is pure and fully tested; components are covered by the visual tests.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 90 },
    },
  },
});
