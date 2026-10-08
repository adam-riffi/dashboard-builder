import { defineConfig } from "vitest/config";

// Slot checks, queries and formats are pure and fully tested; rendering (the .tsx files and the
// lazily loaded ECharts setup) is covered by the visual tests.
export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/echarts.ts"],
      thresholds: { lines: 90 },
    },
  },
});
