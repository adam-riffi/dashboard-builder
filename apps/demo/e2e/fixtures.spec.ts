import { expect, test } from "@playwright/test";

// The fixture gallery renders saved specs with recorded results: no database, no sign-in.

test("the overview fixture renders every visual", async ({ page }) => {
  await page.goto("/fixtures/overview");
  await expect(page.locator('[data-state="ready"]')).toHaveCount(6);
  await expect(page.locator('[data-visual="kpi-revenue"]')).toContainText("$305,386.85");
  await expect(page.locator('[data-visual="kpi-orders"]')).toContainText("1,978");
  await expect(page.locator('[data-ready="true"]')).toHaveCount(2);
  await expect(page.locator('[data-visual="table-products"] tbody tr')).toHaveCount(10);
  // Charts carry a spoken summary of their data.
  await expect(
    page.getByRole("img", { name: /^Revenue by Category: Garden \$83,495\.78; Kitchen/ }),
  ).toBeVisible();
});

test("the states fixture shows empty and error visuals", async ({ page }) => {
  await page.goto("/fixtures/states");
  // The answered KPI, and the visual whose renderer throws (its answer came back fine).
  await expect(page.locator('[data-state="ready"]')).toHaveCount(2);
  await expect(page.locator('[data-visual="throws"]')).toContainText(
    "This visual could not be shown.",
  );
  await expect(page.locator('[data-state="empty"]')).toContainText("No data for this selection.");
  await expect(page.locator('[data-visual="kpi-broken"]')).toContainText(
    "dash_demo.orders.nope: unknown column",
  );
  await expect(page.locator('[data-visual="pie"]')).toContainText("unknown visual type pie");
});

test("the loading fixture shows every visual loading", async ({ page }) => {
  await page.goto("/fixtures/loading");
  await expect(page.locator('[data-state="loading"]')).toHaveCount(2);
});

test("the failed fixture shows the dashboard could not load, in every visual", async ({ page }) => {
  await page.goto("/fixtures/failed");
  await expect(page.locator('[data-state="error"]')).toHaveCount(2);
  await expect(page.locator('[data-state="error"]').first()).toContainText(
    "This dashboard could not load. Try again shortly.",
  );
});

test("unknown fixtures are not found", async ({ request }) => {
  expect((await request.get("/fixtures/nope")).status()).toBe(404);
});
