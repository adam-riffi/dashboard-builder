import { AuthError, authenticate } from "@adam-riffi/dash-gateway";
import config, { appDb } from "../../../../dash.config";
import {
  deleteDashboard,
  getDashboard,
  listDashboards,
  parseSave,
  saveDashboard,
} from "../../../../lib/dashboards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The demo's dashboard storage (M5: the host stores dashboards, DESIGN.md §7). `GET` lists the
 * visitor's dashboards, `GET /id` returns one, `PUT /id` saves the spec in the body, `DELETE /id`
 * removes one. The visitor is the verified JWT's subject; rows are owner-only (ADR 0001).
 */
type Context = { params: Promise<{ id?: string[] }> };

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
    if (id === undefined) return json({ dashboards: await listDashboards(appDb(), user) });
    const dashboard = await getDashboard(appDb(), user, id);
    return dashboard ? json(dashboard) : json({ error: "Not found" }, 404);
  });

export const PUT = (request: Request, context: Context) =>
  handle(request, context, async (user, id) => {
    if (id === undefined) return json({ error: "Not found" }, 404);
    const parsed = parseSave(await request.text());
    if (!parsed.ok) return json({ error: parsed.error, issues: parsed.issues }, parsed.status);
    const saved = await saveDashboard(appDb(), user, id, parsed.spec);
    return saved === "saved" ? json({ id }) : json({ error: "Not found" }, 404);
  });

export const DELETE = (request: Request, context: Context) =>
  handle(request, context, async (user, id) => {
    if (id === undefined) return json({ error: "Not found" }, 404);
    return (await deleteDashboard(appDb(), user, id))
      ? new Response(null, { status: 204 })
      : json({ error: "Not found" }, 404);
  });
