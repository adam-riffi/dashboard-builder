import { createGateway } from "@adam-riffi/dash-gateway";
import config from "../../../../dash.config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gateway = createGateway(config);

/** Mounts the gateway at /api/dash (DESIGN.md §7). */
export const GET = gateway;
export const POST = gateway;
