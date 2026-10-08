import { expect, type Locator, type Page, test } from "@playwright/test";

// M5 acceptance (DESIGN.md §9): build and save a dashboard, dragging fields into wells and
// writing a measure in the formula editor.

/** A pointer drag dnd-kit recognizes: press, move past its 6 px threshold, glide, release. */
async function drag(page: Page, source: Locator, target: Locator) {
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag source or target is not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** Adds a bar chart and fills it by dragging, then writes a measure and drags it in too. */
async function buildBar(page: Page) {
  await page.getByRole("button", { name: "Add Bar" }).click();
  const category = page.getByRole("group", { name: "Category", exact: true });
  const value = page.getByRole("group", { name: "Value", exact: true });
  await drag(page, page.getByRole("button", { name: "Category, dimension" }), category);
  await expect(category).toContainText("Category");
  await drag(page, page.getByRole("button", { name: "Revenue", exact: true }), value);
  await expect(value).toContainText("Revenue");

  await page.getByRole("button", { name: "New measure" }).click();
  await page.getByRole("textbox", { name: "Measure name" }).fill("Units");
  await page.getByRole("textbox", { name: "Formula" }).click();
  await page.keyboard.type("SUM(order_items.qua");
  await expect(page.getByRole("option", { name: /quantity/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.keyboard.type(")");
  await page.getByRole("button", { name: "Apply" }).click();
  await drag(page, page.getByRole("button", { name: "Units", exact: true }), value);
  await expect(value).toContainText("Units");
}

test("the builder fills wells by dragging and writes measures with completions", async ({
  page,
}) => {
  await page.goto("/fixtures/builder");
  await buildBar(page);
  // The refused drop: a measure never lands in the category well.
  const category = page.getByRole("group", { name: "Category", exact: true });
  await drag(page, page.getByRole("button", { name: "Orders", exact: true }), category);
  await expect(category).not.toContainText("Orders");
});

test("a visitor builds and saves a dashboard (M5 acceptance)", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New dashboard" }).click();
  await page.getByRole("textbox", { name: "Dashboard title" }).fill("Built by hand");
  await buildBar(page);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Built by hand" })).toBeVisible();
  await expect(page.locator('[data-visual="bar-1"] [data-ready="true"]')).toBeVisible();

  await page.reload();
  await page.getByRole("button", { name: "Open Built by hand" }).click();
  await expect(page.locator('[data-visual="bar-1"] [data-ready="true"]')).toBeVisible();
  await page.getByRole("button", { name: "Delete dashboard" }).click();
});
