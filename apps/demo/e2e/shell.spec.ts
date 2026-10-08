import { expect, test } from "@playwright/test";

test("a visitor is signed in anonymously @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/signed in as guest/i)).toBeVisible();
});

test("health reports the database as ok @smoke", async ({ request }) => {
  const res = await request.get("/api/dash/health");
  expect(res.status()).toBe(200);
  expect(await res.json()).toEqual({ status: "ok", db: "ok" });
});

test("pages send the security headers @smoke", async ({ request }) => {
  const headers = (await request.get("/")).headers();
  expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(headers["x-content-type-options"]).toBe("nosniff");
});

test("a signed-in visitor sees the tables of the data contract @smoke", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/4 tables available/i)).toBeVisible();
});

test("the contract is refused without a token @smoke", async ({ request }) => {
  const res = await request.get("/api/dash/contract");
  expect(res.status()).toBe(401);
});

test("a signed-in visitor sees the sample dashboard with live revenue @smoke", async ({ page }) => {
  await page.goto("/");
  const revenue = page.locator('[data-visual="kpi-revenue"]');
  await expect(revenue).toHaveAttribute("data-state", "ready");
  // Revenue is a host measure formatted as currency: a non-zero amount with cents.
  await expect(revenue).toContainText(/\$[1-9][\d,]*\.\d{2}/);
  await expect(page.locator('[data-visual="bar-category"] [data-ready="true"]')).toBeVisible();
});
