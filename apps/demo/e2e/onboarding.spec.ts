import { expect, test } from "@playwright/test";

// M7 (DESIGN.md §3, §9): a first visit shows the 60-second script; a visitor who has seen it can
// hide it, and it stays hidden on this browser.

test("a first visit shows how to try the demo, and hiding it is remembered", async ({ page }) => {
  await page.goto("/");
  const panel = page.getByRole("region", { name: "Try it in a minute" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(6);
  await expect(panel.getByRole("link", { name: "Source on GitHub" })).toHaveAttribute(
    "href",
    "https://github.com/adam-riffi/dashboard-builder",
  );

  await panel.getByRole("button", { name: "Hide these steps" }).click();
  await expect(panel).toHaveCount(0);
  // Focus moves to the page, not to nowhere.
  await expect(page.locator("main")).toBeFocused();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "Acme Shop" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Try it in a minute" })).toHaveCount(0);
});
