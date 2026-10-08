import { type DashboardSpec, dashboardSpec } from "@adam-riffi/dash-core";
import type postgres from "postgres";

/** The largest dashboard the demo stores. */
export const MAX_SPEC_BYTES = 256 * 1024;

export interface DashboardSummary {
  id: string;
  title: string;
  updatedAt: string;
}

/**
 * Runs as `dash_app` for one user: the transaction-local `app.user_id` is what the
 * `dashboards_owner` policy compares with `owner_id`, so other users' rows stay invisible and
 * unwritable (ADR 0001). Without a user, nothing matches.
 */
const asUser = <T>(
  sql: postgres.Sql,
  userId: string,
  run: (tx: postgres.TransactionSql) => Promise<T>,
) =>
  sql.begin(async (tx) => {
    await tx`select set_config('app.user_id', ${userId}, true)`;
    return run(tx);
  }) as Promise<T>;

/** The user's dashboards, most recently changed first. */
export async function listDashboards(
  sql: postgres.Sql,
  userId: string,
): Promise<DashboardSummary[]> {
  const rows = await asUser(
    sql,
    userId,
    (tx) => tx<{ id: string; title: string; updated_at: Date }[]>`
      select id, title, updated_at from dash.dashboards order by updated_at desc`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, updatedAt: r.updated_at.toISOString() }));
}

/** One of the user's dashboards, or nothing when it is not theirs or does not exist. */
export async function getDashboard(sql: postgres.Sql, userId: string, id: string) {
  const [row] = await asUser(
    sql,
    userId,
    (tx) => tx<{ id: string; spec: unknown; updated_at: Date }[]>`
      select id, spec, updated_at from dash.dashboards where id = ${id}`,
  );
  if (!row) return undefined;
  return {
    id: row.id,
    spec: dashboardSpec.parse(row.spec),
    updatedAt: row.updated_at.toISOString(),
  };
}

/**
 * Creates or updates a dashboard. Another user's id is refused by the policy (an insert that
 * conflicts with a row the user may not update), and reported as forbidden.
 */
export async function saveDashboard(
  sql: postgres.Sql,
  userId: string,
  id: string,
  spec: DashboardSpec,
): Promise<"saved" | "forbidden"> {
  try {
    await asUser(
      sql,
      userId,
      (tx) => tx`
        insert into dash.dashboards (id, owner_id, title, spec, contract_version)
        values (${id}, ${userId}, ${spec.title}, ${tx.json(spec as never)}, ${spec.contractVersion})
        on conflict (id) do update set
          title = excluded.title, spec = excluded.spec,
          contract_version = excluded.contract_version, updated_at = now()`,
    );
    return "saved";
  } catch (error) {
    // 42501: insufficient_privilege, raised by a row-level security policy.
    if ((error as { code?: string }).code === "42501") return "forbidden";
    throw error;
  }
}

/** Deletes one of the user's dashboards; false when there was none of theirs to delete. */
export async function deleteDashboard(
  sql: postgres.Sql,
  userId: string,
  id: string,
): Promise<boolean> {
  const result = await asUser(
    sql,
    userId,
    (tx) => tx`delete from dash.dashboards where id = ${id}`,
  );
  return result.count > 0;
}

/** A save request's body: a valid DashboardSpec of reasonable size. */
export function parseSave(
  body: string,
):
  | { ok: true; spec: DashboardSpec }
  | { ok: false; status: 400 | 413; error: string; issues?: string[] } {
  if (new TextEncoder().encode(body).length > MAX_SPEC_BYTES) {
    return { ok: false, status: 413, error: "Dashboard too large" };
  }
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { ok: false, status: 400, error: "Request body must be JSON" };
  }
  const spec = dashboardSpec.safeParse(json);
  if (!spec.success) {
    const issues = spec.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    return { ok: false, status: 400, error: "Invalid dashboard", issues };
  }
  return { ok: true, spec: spec.data };
}
