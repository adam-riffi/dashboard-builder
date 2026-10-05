import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  retries: process.env.CI ? 1 : 0,
  // Screenshots of every test feed the screenshots required on UI pull requests.
  use: { baseURL, trace: "retain-on-failure", screenshot: "on" },
  // Against a deployed URL (BASE_URL set) there is no local server to start.
  ...(process.env.BASE_URL
    ? {}
    : { webServer: { command: "pnpm start", url: baseURL, reuseExistingServer: !process.env.CI } }),
});
