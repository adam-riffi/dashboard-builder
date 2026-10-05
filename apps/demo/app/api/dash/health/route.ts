import { health } from "@adam-riffi/dash-gateway";
import { sourceDb } from "../../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { status, body } = await health(sourceDb());
  return Response.json(body, { status });
}
