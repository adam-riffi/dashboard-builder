import postgres from "postgres";
import { afterAll, describe, expect, it, vi } from "vitest";
import { health } from "../src/index.ts";

const up = postgres(
  process.env.DASH_SOURCE_URL ?? "postgres://dash_reader:password@localhost:54322/postgres",
);
const down = postgres("postgres://nobody:nothing@127.0.0.1:1/none", { connect_timeout: 1 });

afterAll(() => Promise.all([up.end(), down.end()]));

describe("health", () => {
  it("reports ok when the database answers", async () => {
    expect(await health(up)).toEqual({ status: 200, body: { status: "ok", db: "ok" } });
  });

  it("reports 503 without leaking the driver error when the database is unreachable", async () => {
    expect(await health(down)).toEqual({ status: 503, body: { status: "error", db: "error" } });
  });

  it("logs the failure as structured JSON for operators", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await health(down);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      level: "error",
      msg: "health check failed",
    });
    log.mockRestore();
  });
});
