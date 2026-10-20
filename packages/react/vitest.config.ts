import { defineConfig } from "vitest/config";

// Request assembly is pure and fully tested; components are covered by the visual tests.
export default defineConfig({
  test: {
    setupFiles: ["./vitest.setup.ts"],
    // A file's first jsdom test also loads the environment and the chart chunk; under the
    // parallel load of `pnpm check` that went past the 5 s default.
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 90 },
    },
  },
});
