import { defineConfig } from "vitest/config";

// Integration files share one database and truncate tables, so they must not run in parallel.
export default defineConfig({ test: { fileParallelism: false, globalSetup: ["test/setup.ts"] } });
