import { AuthError, authenticate } from "./auth.ts";
import type { GatewayConfig } from "./config.ts";
import { inferContract } from "./contract/index.ts";
import { introspect } from "./contract/introspect.ts";
import { health } from "./health.ts";

type Handler = (request: Request) => Promise<Response>;

const json = (body: unknown, status: number, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

/**
 * The gateway HTTP API (DESIGN.md §7) as a Fetch handler. Routes are matched on the last path
 * segment, so the handler mounts under any prefix (`/api/dash` in the demo).
 */
export function createGateway(config: GatewayConfig): Handler {
  const routes = new Map<string, Handler>([
    [
      "health",
      async () => {
        const { status, body } = await health(config.source());
        return json(body, status);
      },
    ],
    [
      "contract",
      async (request) => {
        await authenticate(request, config.auth, config.identity);
        const catalog = await introspect(config.source(), config.tables);
        const contract = inferContract(catalog, { tables: config.tables });
        // The contract cache arrives in M6; until then every request introspects.
        const headers = {
          etag: `"${contract.contractVersion}"`,
          "cache-control": "private, no-cache",
        };
        if (request.headers.get("if-none-match") === headers.etag) {
          return new Response(null, { status: 304, headers });
        }
        return json(contract, 200, headers);
      },
    ],
  ]);

  return async (request) => {
    const name = new URL(request.url).pathname.split("/").at(-1) ?? "";
    const route = routes.get(name);
    if (!route) return json({ error: "Not found" }, 404);
    if (request.method !== "GET")
      return json({ error: "Method not allowed" }, 405, { allow: "GET" });
    try {
      return await route(request);
    } catch (error) {
      if (error instanceof AuthError) {
        const cause = error.cause instanceof Error ? error.cause.message : error.message;
        console.warn(
          JSON.stringify({ level: "warn", msg: "request unauthorized", route: name, cause }),
        );
        return json({ error: error.message }, 401, { "www-authenticate": "Bearer" });
      }
      const cause = error instanceof Error ? error.message : String(error);
      console.error(
        JSON.stringify({ level: "error", msg: "gateway request failed", route: name, cause }),
      );
      return json({ error: "Internal error" }, 500);
    }
  };
}
