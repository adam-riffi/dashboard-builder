import { expect, type Locator, type Page, test } from "@playwright/test";

// M5 acceptance (DESIGN.md §9): build and save a dashboard, dragging fields into wells and
// writing a measure in the formula editor.

/** A pointer drag dnd-kit recognizes: press, move past its 6 px threshold, glide, release. */
async function drag(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const from = await source.boundingBox();
  const to = await target.boundingBox();
  if (!from || !to) throw new Error("drag source or target is not on screen");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 3 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  // dnd-kit swallows clicks until 50 ms after a drop; people never click that fast, tests do.
  await page.waitForTimeout(100);
}

/** Adds a bar chart and fills it by dragging, then writes a measure and drags it in too. */
async function buildBar(page: Page) {
  await page.getByRole("button", { name: "Add Bar" }).click();
  const category = page.getByRole("group", { name: "Category", exact: true });
  const value = page.getByRole("group", { name: "Value", exact: true });
  await drag(page, page.getByRole("button", { name: "Category, dimension" }), category);
  await expect(
    category.getByRole("button", { name: "Remove Category from Category" }),
  ).toBeVisible();
  await drag(page, page.getByRole("button", { name: "Revenue", exact: true }), value);
  await expect(value.getByRole("button", { name: "Remove Revenue from Value" })).toBeVisible();

  await page.getByRole("button", { name: "New measure" }).click();
  await page.getByRole("textbox", { name: "Measure name" }).fill("Units");
  await page.getByRole("textbox", { name: "Formula" }).click();
  await page.keyboard.type("SUM(order_items.qua");
  // CodeMirror ignores Enter for 75 ms after the list opens; picking the option is what people do.
  await page.getByRole("option", { name: /quantity/ }).click();
  await page.keyboard.type(")");
  await page.getByRole("button", { name: "Apply" }).click();
  await drag(page, page.getByRole("button", { name: "Units", exact: true }), value);
  await expect(value.getByRole("button", { name: "Remove Units from Value" })).toBeVisible();
}

test("the builder fills wells by dragging and writes measures with completions", async ({
  page,
}) => {
  await page.goto("/fixtures/builder");
  await buildBar(page);
  // The refused drop: a measure never lands in the category well.
  const category = page.getByRole("group", { name: "Category", exact: true });
  await drag(page, page.getByRole("button", { name: "Orders", exact: true }), category);
  await expect(category.getByRole("button", { name: "Remove Orders from Category" })).toHaveCount(
    0,
  );
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

// M10 acceptance (ADR 0013): a host measure built on PREVIOUSPERIOD draws on a line by day, on the
// live data.
test("a line of revenue growth by day draws from PREVIOUSPERIOD", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New dashboard" }).click();
  await page.getByRole("textbox", { name: "Dashboard title" }).fill("Growth");
  await page.getByRole("button", { name: "Add Line" }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Ordered at, time" }),
    page.getByRole("group", { name: "Axis", exact: true }),
  );
  await drag(
    page,
    page.getByRole("button", { name: "Revenue growth", exact: true }),
    page.getByRole("group", { name: "Value", exact: true }),
  );
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Growth" })).toBeVisible();
  await expect(page.locator('[data-visual="line-1"] [data-ready="true"]')).toBeVisible();
  // The chart's text alternative lists the days' growth: some are amounts, not all empty.
  await expect(
    page.locator('[data-visual="line-1"] [aria-label^="Revenue growth by"]').first(),
  ).toHaveAttribute("aria-label", /\$\d/);
  await page.getByRole("button", { name: "Delete dashboard" }).click();
});

// M11 acceptance (ADR 0014): Revenue and Refunds come from two fact tables (order_items and
// returns), answered in one table; a map shades countries by revenue, and picking one filters
// the table, on the live data.
test("a table of revenue and refunds by category, filtered from a map of countries", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "New dashboard" }).click();
  await page.getByRole("textbox", { name: "Dashboard title" }).fill("Refunds by country");
  await page.getByRole("button", { name: "Add Table" }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Category, dimension" }),
    page.getByRole("group", { name: "Rows", exact: true }),
  );
  const values = page.getByRole("group", { name: "Values", exact: true });
  await drag(page, page.getByRole("button", { name: "Revenue", exact: true }), values);
  await drag(page, page.getByRole("button", { name: "Refunds", exact: true }), values);
  await expect(values.getByRole("button", { name: "Remove Refunds from Values" })).toBeVisible();
  await page.getByRole("button", { name: "Add Map" }).click();
  await drag(
    page,
    page.getByRole("button", { name: "Country, dimension" }),
    page.getByRole("group", { name: "Country", exact: true }),
  );
  await drag(
    page,
    page.getByRole("button", { name: "Revenue", exact: true }),
    page.getByRole("group", { name: "Value", exact: true }),
  );
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Refunds by country" })).toBeVisible();

  // Five categories, each with an amount of revenue and of refunds.
  const table = page.locator('[data-visual="table-1"]');
  await expect(table).toHaveAttribute("data-state", "ready");
  await expect(table.getByRole("columnheader", { name: "Refunds" })).toBeVisible();
  await expect(table.getByRole("cell", { name: /^\$\d/ })).toHaveCount(10);
  const map = page.locator('[data-visual="map-1"]');
  await expect(map.locator('[data-ready="true"]')).toBeVisible();
  await expect(map.locator('[role="img"]')).toHaveAttribute("aria-label", /FR \$\d/);

  const before = await table.textContent();
  const pick = page.getByRole("combobox", { name: "Filter by Country" });
  await pick.selectOption({ label: "FR" });
  await pick.press("Enter");
  await expect(page.getByRole("button", { name: "Clear filter Country: FR" })).toBeVisible();
  await expect(table).not.toHaveText(before ?? "");
  await expect(table.getByRole("cell", { name: /^\$\d/ })).toHaveCount(10);
  await page.getByRole("button", { name: "Delete dashboard" }).click();
});

// M8 acceptance (ADR 0011): a dashboard saved before a column was renamed is repaired in the
// builder, from the replacement it suggests.
test("the builder repairs a field the schema lost", async ({ page }) => {
  await page.goto("/fixtures/builder/lost");
  const panel = page.getByRole("region", { name: "Fields this dashboard lost" });
  const tile = page.locator('[data-visual="bar-category"]');
  await expect(tile).toHaveAttribute("data-state", "error");
  await expect(panel).toContainText("Used by 1 visual.");
  await expect(
    panel.getByRole("combobox", { name: "Replace products.product_category with" }),
  ).toHaveValue("dash_demo.products.category");
  await panel.getByRole("button", { name: "Apply to products.product_category" }).click();
  await expect(panel).toBeHidden();
  await expect(tile).toHaveAttribute("data-state", "ready");
});
