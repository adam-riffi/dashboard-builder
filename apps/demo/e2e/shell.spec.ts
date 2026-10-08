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

test("a signed-in visitor sees revenue by category, a host measure, for their tenants @smoke", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByText(/revenue by category/i)).toBeVisible();
  // Revenue is SUM(quantity * unit_price), so it is a non-zero amount with cents.
  await expect(page.getByRole("listitem").first()).toHaveText(/\S+: \$[1-9][\d,]*\.\d{2}/);
});
