import { defineConfig } from "@playwright/test";

const baseURL = process.env.BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  // Visual baselines (ADR 0008): one set, made on CI's Linux runner, no platform suffix.
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.002, animations: "disabled" } },
  retries: process.env.CI ? 1 : 0,
  // Screenshots of every test feed the screenshots required on UI pull requests.
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "on",
    // Lets smoke tests through Vercel preview Deployment Protection when it is enabled.
    ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET && {
      extraHTTPHeaders: {
        "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET,
      },
    }),
  },
  // Against a deployed URL (BASE_URL set) there is no local server to start.
  ...(process.env.BASE_URL
    ? {}
    : { webServer: { command: "pnpm start", url: baseURL, reuseExistingServer: !process.env.CI } }),
});
