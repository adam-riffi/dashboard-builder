import postgres from "postgres";
import { afterAll, expect, it } from "vitest";

const admin = postgres(
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
  { onnotice: () => {} },
);

afterAll(() => admin.end());

// Without a pinned search_path a function resolves names through its caller's path
// (Supabase advisor lint 0011, function_search_path_mutable).
it("pins an empty search_path on every dash_demo function", async () => {
  const functions = await admin`select p.proname, p.proconfig from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'dash_demo'`;
  expect(functions.length).toBeGreaterThan(0);
  for (const f of functions) expect(f.proconfig, f.proname).toContain('search_path=""');
});

it("still runs the tick with that search_path", async () => {
  const rollback = new Error("rollback");
  await expect(
    admin.begin(async (sql) => {
      await sql`select dash_demo.tick()`;
      throw rollback;
    }),
  ).rejects.toBe(rollback);
});
