import { defineConfig } from "vitest/config";

// Slot checks and queries are pure and fully tested; rendering is covered by the visual tests.
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
