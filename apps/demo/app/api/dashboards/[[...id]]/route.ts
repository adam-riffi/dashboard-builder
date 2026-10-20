import { AuthError, authenticate, withDeadline } from "@adam-riffi/dash-gateway";
import type postgres from "postgres";
import config, { appDb } from "../../../../dash.config";
import {
  deleteDashboard,
  getDashboard,
  listDashboards,
  MAX_DASHBOARDS_PER_USER,
  MAX_SPEC_BYTES,
  parseSave,
  saveDashboard,
} from "../../../../lib/dashboards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A stuck request fails in 30 s, not Vercel's 300 s default; the client retries once.
export const maxDuration = 30;

/**
 * The demo's dashboard storage (M5: the host stores dashboards, DESIGN.md §7). `GET` lists the
 * visitor's dashboards, `GET /id` returns one, `PUT /id` saves the spec in the body, `DELETE /id`
 * removes one. The visitor is the verified JWT's subject; rows are owner-only (ADR 0001).
 */
type Context = { params: Promise<{ id?: string[] }> };

/**
 * The visitor's dashboards with the gateway's 5 s deadline and one retry: a lost connection
 * behind the pooler would otherwise hang until `maxDuration`. Saving is an upsert and deleting
 * is by key, so a retry is safe.
 */
const db = <T>(run: (sql: postgres.Sql) => Promise<T>) => withDeadline(appDb, "dashboards", run);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

async function handle(
  request: Request,
  context: Context,
  run: (user: string, id?: string) => Promise<Response>,
) {
  const { id: segments = [] } = await context.params;
  const [id, ...rest] = segments;
  if (rest.length > 0 || (id !== undefined && !UUID.test(id)))
    return json({ error: "Not found" }, 404);
  try {
    const { id: user } = await authenticate(request, config.auth, config.identity);
    return await run(user, id);
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json(
        { error: error.message },
        { status: 401, headers: { "www-authenticate": "Bearer", "cache-control": "no-store" } },
      );
    }
    console.error(
      JSON.stringify({ level: "error", msg: "dashboards failed", cause: String(error) }),
    );
    return json({ error: "Internal error" }, 500);
  }
}

export const GET = (request: Request, context: Context) =>
  handle(request, context, async (user, id) => {
    if (id === undefined) return json({ dashboards: await db((sql) => listDashboards(sql, user)) });
    const dashboard = await db((sql) => getDashboard(sql, user, id));
    return dashboard ? json(dashboard) : json({ error: "Not found" }, 404);
  });

export const PUT = async (request: Request, context: Context) => {
  // An oversized body is refused from its declared size, before anyone reads it.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_SPEC_BYTES) {
    return json({ error: "Dashboard too large" }, 413);
  }
  return handle(request, context, async (user, id) => {
    if (id === undefined) return json({ error: "Not found" }, 404);
    const parsed = parseSave(await request.text());
    if (!parsed.ok) return json({ error: parsed.error, issues: parsed.issues }, parsed.status);
    const saved = await db((sql) => saveDashboard(sql, user, id, parsed.spec));
    if (saved === "full") {
      return json({ error: `You keep ${MAX_DASHBOARDS_PER_USER} dashboards already` }, 409);
    }
    return saved === "saved" ? json({ id }) : json({ error: "Not found" }, 404);
  });
};

export const DELETE = (request: Request, context: Context) =>
  handle(request, context, async (user, id) => {
    if (id === undefined) return json({ error: "Not found" }, 404);
    // Gone either way: a retry after a slow first attempt finds nothing left to delete, and
    // row-level security hides other visitors' dashboards, so nothing leaks.
    await db((sql) => deleteDashboard(sql, user, id));
    return new Response(null, { status: 204 });
  });
