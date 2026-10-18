import { expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

// M6 acceptance (DESIGN.md §9, §10): cross-filtering, live refresh after inserting rows, and the
// "Under the hood" drawer, on the local Supabase stack CI starts.

const adminUrl =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";

/** The visitor's session, read from supabase-js's storage in the page. */
async function session(page: Page): Promise<{ token: string; userId: string }> {
  await expect(page.getByText(/Signed in as/)).toBeVisible();
  return page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.endsWith("-auth-token"));
    const stored = JSON.parse(localStorage.getItem(key ?? "") ?? "{}");
    return { token: stored.access_token, userId: stored.user?.id };
  });
}

const revenueOf = (page: Page) => page.locator('[data-visual="kpi-revenue"]');

test("selecting a category filters every other visual, and clearing it restores them", async ({
  page,
}) => {
  await page.goto("/");
  const revenue = revenueOf(page);
  await expect(revenue).toHaveAttribute("data-state", "ready");
  await expect(revenue).toContainText("$");
  const before = await revenue.textContent();

  const pick = page.getByRole("combobox", { name: "Filter by Category" });
  await pick.selectOption({ label: "Garden" });
  await pick.press("Enter");
  const chip = page.getByRole("button", { name: "Clear filter Category: Garden" });
  await expect(chip).toBeVisible();
  // Garden is part of the revenue, so the KPI changes; the bar itself keeps every category.
  await expect(revenue).not.toHaveText(before ?? "");
  await expect(page.locator('[data-visual="bar-category"] [role="img"]')).toHaveAttribute(
    "aria-label",
    /Toys/,
  );

  await chip.click();
  await expect(revenue).toHaveText(before ?? "");
});

test("clicking a bar filters the other visuals, as in the demo script", async ({ page }) => {
  await page.goto("/");
  const revenue = revenueOf(page);
  await expect(revenue).toHaveAttribute("data-state", "ready");
  await expect(page.locator('[data-visual="bar-category"] [data-ready="true"]')).toBeVisible();
  const before = await revenue.textContent();
  // The first filled shape in the bar chart's SVG is its first bar.
  await page
    .locator('[data-visual="bar-category"] svg path[fill]:not([fill="none"])')
    .first()
    .click();
  await expect(page.getByRole("button", { name: /^Clear filter Category: / })).toBeVisible();
  await expect(revenue).not.toHaveText(before ?? "");
});

test("a dashboard shows new orders within its refresh interval", async ({ page }) => {
  await page.goto("/");
  await expect(revenueOf(page)).toHaveAttribute("data-state", "ready");
  const { token, userId } = await session(page);
  const id = crypto.randomUUID();
  const spec = {
    specVersion: 1,
    contractVersion: "0".repeat(64),
    title: "Live orders",
    refreshIntervalSec: 5,
    layout: [{ i: "kpi-orders", x: 0, y: 0, w: 4, h: 2 }],
    visuals: [
      { id: "kpi-orders", type: "kpi", slots: { value: [{ name: "Orders" }] }, options: {} },
    ],
  };
  const saved = await page.request.put(`/api/dashboards/${id}`, {
    headers: { authorization: `Bearer ${token}` },
    data: spec,
  });
  expect(saved.status()).toBe(200);

  await page.reload();
  await page.getByRole("button", { name: "Open Live orders" }).click();
  const orders = page.locator('[data-visual="kpi-orders"]');
  await expect(orders).toHaveAttribute("data-state", "ready");
  const count = Number((await orders.textContent())?.replace(/\D/g, ""));

  const admin = postgres(adminUrl, { onnotice: () => {} });
  let inserted: number | undefined;
  try {
    const [membership] = await admin<{ tenant_id: number }[]>`
      select tenant_id from dash.memberships where user_id = ${userId} order by tenant_id limit 1`;
    if (!membership) throw new Error("the visitor has no tenant yet");
    const tenant = membership.tenant_id;
    const [order] = await admin<{ id: number }[]>`
      insert into dash_demo.orders (tenant_id, customer_id, ordered_at, status, channel)
      select ${tenant}, c.id, now(), 'paid', 'web' from dash_demo.customers c
      where c.tenant_id = ${tenant} limit 1
      returning id`;
    await admin`
      insert into dash_demo.order_items (order_id, tenant_id, product_id, quantity, unit_price)
      select ${order?.id ?? 0}, ${tenant}, p.id, 1, 10 from dash_demo.products p
      where p.tenant_id = ${tenant} limit 1`;

    inserted = order?.id;
    // Within two intervals the new order has been counted (pg_cron may add one more).
    await expect
      .poll(async () => Number((await orders.textContent())?.replace(/\D/g, "")), {
        timeout: 15_000,
      })
      .toBeGreaterThanOrEqual(count + 1);
  } finally {
    if (inserted !== undefined) await admin`delete from dash_demo.orders where id = ${inserted}`;
    await admin.end();
    await page.request.delete(`/api/dashboards/${id}`, {
      headers: { authorization: `Bearer ${token}` },
    });
  }
});

test("the Under the hood drawer shows each query's SQL, cache status and the security context", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(revenueOf(page)).toHaveAttribute("data-state", "ready");
  // The drawer by its role: the try-it panel mentions "Under the hood" too.
  const drawer = page.getByRole("group", { name: "Under the hood" });
  await drawer.locator("summary").click();
  await expect(drawer.getByText("Security context")).toBeVisible();
  await expect(drawer.getByText(/tenantIds/)).toBeVisible();
  await expect(drawer.getByText(/^Revenue: cache (hit|miss), \d+ ms, 1 row$/)).toBeVisible();
  await expect(drawer.getByText(/select sum/).first()).toBeVisible();
  await testInfo.attach("under-the-hood", {
    body: await drawer.screenshot(),
    contentType: "image/png",
  });
});
