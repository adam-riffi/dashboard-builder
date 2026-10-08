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
