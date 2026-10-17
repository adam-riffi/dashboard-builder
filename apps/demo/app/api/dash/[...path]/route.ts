import { createGateway } from "@adam-riffi/dash-gateway";
import config from "../../../../dash.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A stuck request fails in 30 s, not Vercel's 300 s default; the client retries once.
export const maxDuration = 30;

const gateway = createGateway(config);

/** Mounts the gateway at /api/dash (DESIGN.md §7). */
export const GET = gateway;
export const POST = gateway;
