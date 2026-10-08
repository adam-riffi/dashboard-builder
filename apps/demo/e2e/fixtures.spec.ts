import { expect, test } from "@playwright/test";

// The fixture gallery renders saved specs with recorded results: no database, no sign-in.

test("the overview fixture renders every visual", async ({ page }) => {
  await page.goto("/fixtures/overview");
  await expect(page.locator('[data-state="ready"]')).toHaveCount(6);
  await expect(page.locator('[data-visual="kpi-revenue"]')).toContainText("$305,386.85");
  await expect(page.locator('[data-visual="kpi-orders"]')).toContainText("1,978");
  await expect(page.locator('[data-ready="true"]')).toHaveCount(2);
  await expect(page.locator('[data-visual="table-products"] tbody tr')).toHaveCount(10);
});

test("the states fixture shows empty and error visuals", async ({ page }) => {
  await page.goto("/fixtures/states");
  await expect(page.locator('[data-state="ready"]')).toHaveCount(1);
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

test("unknown fixtures are not found", async ({ request }) => {
  expect((await request.get("/fixtures/nope")).status()).toBe(404);
});
