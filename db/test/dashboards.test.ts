import { dashboardSpec } from "@adam-riffi/dash-core";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteDashboard,
  getDashboard,
  listDashboards,
  MAX_SPEC_BYTES,
  parseSave,
  saveDashboard,
} from "../../apps/demo/lib/dashboards.ts";

// The demo stores dashboards itself (M5, Georges' choice): owner-only through app.user_id (ADR 0001).
const admin = postgres(
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
  { onnotice: () => {} },
);
const app = postgres(
  process.env.DASH_APP_DATABASE_URL ?? "postgres://dash_app:password@localhost:54322/postgres",
);
const alice = "a1111111-1111-4111-8111-111111111111";
const bob = "b2222222-2222-4222-8222-222222222222";
const id = "d3333333-3333-4333-8333-333333333333";
const spec = dashboardSpec.parse({
  specVersion: 1,
  contractVersion: "0".repeat(64),
  title: "Weekly sales",
  layout: [{ i: "kpi-1", x: 0, y: 0, w: 4, h: 2 }],
  visuals: [{ id: "kpi-1", type: "kpi", slots: { value: [{ name: "Revenue" }] } }],
});

beforeAll(() => admin`delete from dash.dashboards where owner_id in (${alice}, ${bob})`);
afterAll(async () => {
  await admin`delete from dash.dashboards where owner_id in (${alice}, ${bob})`;
  await Promise.all([admin.end(), app.end()]);
});

describe("dashboard store", () => {
  it("saves, lists and reads a dashboard for its owner", async () => {
    expect(await saveDashboard(app, alice, id, spec)).toBe("saved");
    expect(await listDashboards(app, alice)).toMatchObject([{ id, title: "Weekly sales" }]);
    expect(await getDashboard(app, alice, id)).toMatchObject({ id, spec });
  });

  it("updates in place on a second save", async () => {
    expect(await saveDashboard(app, alice, id, { ...spec, title: "Weekly sales v2" })).toBe(
      "saved",
    );
    expect((await listDashboards(app, alice)).map((d) => d.title)).toEqual(["Weekly sales v2"]);
  });

  it("shows another user nothing and lets them change nothing", async () => {
    expect(await listDashboards(app, bob)).toEqual([]);
    expect(await getDashboard(app, bob, id)).toBeUndefined();
    expect(await saveDashboard(app, bob, id, { ...spec, title: "Mine now" })).toBe("forbidden");
    expect(await deleteDashboard(app, bob, id)).toBe(false);
    expect((await getDashboard(app, alice, id))?.spec.title).toBe("Weekly sales v2");
  });

  it("deletes a dashboard for its owner", async () => {
    expect(await deleteDashboard(app, alice, id)).toBe(true);
    expect(await getDashboard(app, alice, id)).toBeUndefined();
  });
});

describe("parseSave", () => {
  it("accepts a valid spec", () => {
    expect(parseSave(JSON.stringify(spec))).toEqual({ ok: true, spec });
  });

  it.each([
    ["not JSON", "{", 400, "Request body must be JSON"],
    ["an invalid spec", JSON.stringify({ ...spec, specVersion: 2 }), 400, "Invalid dashboard"],
    [
      "a spec too large to store",
      JSON.stringify({ ...spec, title: "x".repeat(MAX_SPEC_BYTES) }),
      413,
      "Dashboard too large",
    ],
  ])("refuses %s", (_, body, status, error) => {
    expect(parseSave(body)).toMatchObject({ ok: false, status, error });
  });
});
