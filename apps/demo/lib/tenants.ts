import type postgres from "postgres";

const DEMO_TENANTS = 5;

/** Two of the five demo tenants, derived from the user id so a visitor always gets the same pair. */
export function demoTenantsFor(userId: string): [number, number] {
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const first = hash % DEMO_TENANTS;
  const second = (first + 1 + ((hash >>> 3) % (DEMO_TENANTS - 1))) % DEMO_TENANTS;
  return first < second ? [first + 1, second + 1] : [second + 1, first + 1];
}

/**
 * The visitor's tenants from `dash.memberships`, assigning two at first sign-in (DESIGN.md §8).
 * Runs as `dash_app`; concurrent first requests insert the same pair, so the conflict is harmless.
 */
export async function tenantsOf(sql: postgres.Sql, userId: string): Promise<number[]> {
  return sql.begin(async (tx) => {
    const rows = await tx<{ tenant_id: number; stale: boolean }[]>`
      select tenant_id, last_seen_at < now() - interval '1 day' as stale
      from dash.memberships where user_id = ${userId} order by tenant_id`;
    if (rows.length > 0) {
      // The weekly cleanup forgets guests unseen for 30 days (ADR 0012); a write a day is enough.
      if (rows.some((r) => r.stale)) {
        await tx`update dash.memberships set last_seen_at = now() where user_id = ${userId}`;
      }
      return rows.map((r) => r.tenant_id);
    }
    const pair = demoTenantsFor(userId);
    for (const tenantId of pair) {
      await tx`insert into dash.memberships (user_id, tenant_id) values (${userId}, ${tenantId})
        on conflict do nothing`;
    }
    return pair;
  });
}
