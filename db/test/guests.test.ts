import postgres from "postgres";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { tenantsOf } from "../../apps/demo/lib/tenants.ts";

// DESIGN.md §14, ADR 0012: a weekly job deletes this app's data for guests unseen for 30 days.
const admin = postgres(
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
  { onnotice: () => {} },
);
const app = postgres(
  process.env.DASH_APP_DATABASE_URL ?? "postgres://dash_app:password@localhost:54322/postgres",
);
const gone = "e5555555-5555-4555-8555-555555555555";
const back = "f6666666-6666-4666-8666-666666666666";
const orphan = "a7777777-7777-4777-8777-777777777777";
const fresh = "b8888888-8888-4888-8888-888888888888";
const users = [gone, back, orphan, fresh];

const forget = () =>
  Promise.all([
    admin`delete from dash.dashboards where owner_id in ${admin(users)}`,
    admin`delete from dash.memberships where user_id in ${admin(users)}`,
  ]);
const dashboard = (owner: string, age: string) =>
  admin`insert into dash.dashboards (owner_id, title, spec, contract_version, updated_at)
    values (${owner}, 'Kept?', '{}'::jsonb, ${"0".repeat(64)}, now() - ${age}::interval)`;
const count = async (table: "dashboards" | "memberships", user: string) => {
  const [row] =
    table === "dashboards"
      ? await admin`select count(*)::int as n from dash.dashboards where owner_id = ${user}`
      : await admin`select count(*)::int as n from dash.memberships where user_id = ${user}`;
  return row?.n;
};

afterEach(forget);
afterAll(() => Promise.all([admin.end(), app.end()]));

describe("dash.forget_inactive_guests()", () => {
  it("deletes the memberships and dashboards of guests unseen for 30 days, and nothing else", async () => {
    await admin`insert into dash.memberships (user_id, tenant_id, last_seen_at) values
      (${gone}, 1, now() - interval '31 days'), (${gone}, 2, now() - interval '31 days'),
      (${back}, 1, now() - interval '31 days'), (${back}, 2, now())`;
    await dashboard(gone, "1 day");
    await dashboard(back, "40 days");
    // Dashboards whose owner has no membership left go after 30 days too.
    await dashboard(orphan, "31 days");
    await dashboard(fresh, "1 day");

    await admin`select dash.forget_inactive_guests()`;

    expect(await count("memberships", gone)).toBe(0);
    expect(await count("dashboards", gone)).toBe(0);
    // Seen today through one of their memberships: everything stays.
    expect(await count("memberships", back)).toBe(2);
    expect(await count("dashboards", back)).toBe(1);
    expect(await count("dashboards", orphan)).toBe(0);
    expect(await count("dashboards", fresh)).toBe(1);
  });

  it("runs weekly through pg_cron", async () => {
    const [job] = await admin`select schedule, command from cron.job
      where jobname = 'dash_forget_guests'`;
    expect(job).toEqual({
      schedule: "0 4 * * 1",
      command: "select dash.forget_inactive_guests()",
    });
  });
});

describe("last seen (tenantsOf)", () => {
  const lastSeen = async () => {
    const [row] = await admin`select extract(epoch from now() - max(last_seen_at))::int as age
      from dash.memberships where user_id = ${back}`;
    return row?.age as number;
  };

  it("records a returning guest at most once a day", async () => {
    await admin`insert into dash.memberships (user_id, tenant_id, last_seen_at) values
      (${back}, 1, now() - interval '2 days'), (${back}, 3, now() - interval '2 days')`;
    expect(await tenantsOf(app, back)).toEqual([1, 3]);
    expect(await lastSeen()).toBeLessThan(60);

    await admin`update dash.memberships set last_seen_at = now() - interval '2 hours'
      where user_id = ${back}`;
    await tenantsOf(app, back);
    expect(await lastSeen()).toBeGreaterThanOrEqual(2 * 3600 - 60);
  });
});
