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
