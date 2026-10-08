import { expect, test } from "@playwright/test";

// The demo stores each visitor's dashboards (M5): create from the sample, save, reload, delete.

test("a visitor saves a new dashboard, finds it after reloading, and deletes it", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New dashboard" }).click();
  const title = page.getByRole("textbox", { name: "Dashboard title" });
  await title.fill("My sales");
  await page.getByRole("button", { name: "Save" }).click();
  // Saved dashboards open in the viewer.
  await expect(page.getByRole("heading", { level: 2, name: "My sales" })).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Open My sales" }).click();
  await expect(page.locator('[data-visual="kpi-revenue"]')).toHaveAttribute("data-state", "ready");

  await page.getByRole("button", { name: "Delete dashboard" }).click();
  await expect(page.getByRole("button", { name: "Open My sales" })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Open My sales" })).toHaveCount(0);
});

test("a save the store refuses is reported, never shown as saved", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New dashboard" }).click();
  const save = page.getByRole("button", { name: "Save" });

  // Someone else's id, or a dashboard gone meanwhile: the store answers 404.
  await page.route("**/api/dashboards/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 404, json: {} })
      : route.continue(),
  );
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "could not be saved" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Dashboard title" })).toBeVisible();

  // At the cap, the store answers 409, and the visitor learns what to do.
  await page.unroute("**/api/dashboards/*");
  await page.route("**/api/dashboards/*", (route) =>
    route.request().method() === "PUT"
      ? route.fulfill({ status: 409, json: {} })
      : route.continue(),
  );
  await save.click();
  await expect(page.getByRole("alert").filter({ hasText: "delete one" })).toBeVisible();
});

test("an oversized dashboard is refused from its declared size, before anything is read", async ({
  request,
}) => {
  const id = "00000000-0000-4000-8000-000000000000";
  const res = await request.put(`/api/dashboards/${id}`, { data: "x".repeat(300 * 1024) });
  expect(res.status()).toBe(413);
});
