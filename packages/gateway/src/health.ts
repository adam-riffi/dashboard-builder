import type postgres from "postgres";

export interface HealthResponse {
  status: number;
  body: { status: "ok" | "error"; db: "ok" | "error" };
}

/** `GET /health` (DESIGN.md §7). */
export async function health(_sql: postgres.Sql): Promise<HealthResponse> {
  throw new Error("not implemented");
}
