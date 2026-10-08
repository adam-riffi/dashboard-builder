import { expect, type Page, test } from "@playwright/test";

// M4 acceptance (DESIGN.md §9): saved fixture specs render identically. Fonts render differently
// on each system, so the baselines come from CI's Linux runner and the comparison runs there only
// (ADR 0008). To refresh them, delete e2e/__screenshots__ and commit the CI artifact.
test.skip(process.platform !== "linux", "screenshot baselines are made on CI's Linux runner");
test.use({ viewport: { width: 1100, height: 1200 } });

/** Waits until every visual has settled and every chart is drawn. */
async function settled(page: Page, charts: number) {
  await expect(page.locator('[data-ready="true"]')).toHaveCount(charts);
}

test("the overview fixture renders identically", async ({ page }) => {
  await page.goto("/fixtures/overview");
  await settled(page, 2);
  await expect(page).toHaveScreenshot("overview.png", { fullPage: true });
});

test("the overview fixture renders identically in dark mode", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/fixtures/overview");
  await settled(page, 2);
  await expect(page).toHaveScreenshot("overview-dark.png", { fullPage: true });
});

test("the states fixture renders identically", async ({ page }) => {
  await page.goto("/fixtures/states");
  await expect(page.locator('[data-state="empty"]')).toBeVisible();
  await expect(page).toHaveScreenshot("states.png", { fullPage: true });
});

test("the loading fixture renders identically", async ({ page }) => {
  await page.goto("/fixtures/loading");
  await expect(page.locator('[data-state="loading"]')).toHaveCount(2);
  await expect(page).toHaveScreenshot("loading.png", { fullPage: true });
});

test("the overview stacks to one column on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/fixtures/overview");
  await settled(page, 2);
  await expect(page).toHaveScreenshot("overview-phone.png", { fullPage: true });
});
