import type postgres from "postgres";

export interface HealthResponse {
  status: number;
  body: { status: "ok" | "error"; db: "ok" | "error" };
}

/** `GET /health` (DESIGN.md §7). The driver error is logged, never returned to the caller. */
export async function health(sql: postgres.Sql): Promise<HealthResponse> {
  try {
    await sql`select 1`;
    return { status: 200, body: { status: "ok", db: "ok" } };
  } catch (error) {
    // Operators get the cause in the logs; the caller never does.
    const cause = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ level: "error", msg: "health check failed", cause }));
    return { status: 503, body: { status: "error", db: "error" } };
  }
}
