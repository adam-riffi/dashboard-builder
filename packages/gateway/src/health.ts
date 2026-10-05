import type postgres from "postgres";

export interface HealthResponse {
  status: number;
  body: { status: "ok" | "error"; db: "ok" | "error" };
}

/** `GET /health` (DESIGN.md §7). The driver error is never returned to the caller. */
export async function health(sql: postgres.Sql): Promise<HealthResponse> {
  try {
    await sql`select 1`;
    return { status: 200, body: { status: "ok", db: "ok" } };
  } catch {
    return { status: 503, body: { status: "error", db: "error" } };
  }
}
