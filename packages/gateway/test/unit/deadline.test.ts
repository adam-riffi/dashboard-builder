import { afterEach, describe, expect, it, vi } from "vitest";
import { withDeadline } from "../../src/index.ts";

/** A client whose calls answer with `value`, or never when `value` is undefined. */
const client = (value?: string) =>
  Object.assign(() => (value === undefined ? new Promise(() => {}) : Promise.resolve(value)), {
    end: async () => {},
  });
/** A source handing out `clients` in turn, one more on each reset. */
function source(...clients: ReturnType<typeof client>[]) {
  let current = 0;
  return Object.assign(() => clients[current] as never, {
    reset: vi.fn(() => {
      current += 1;
    }),
  });
}
const ask = (sql: unknown) => (sql as () => Promise<string>)();

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withDeadline (database calls that may never answer)", () => {
  it("answers as the database does when it answers in time", async () => {
    expect(await withDeadline(source(client("rows")), "scope", ask)).toBe("rows");
  });

  it("replaces a connection that missed the deadline and tries once more", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const db = source(client(), client("rows"));
    const answer = withDeadline(db, "scope", ask);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await answer).toBe("rows");
    expect(db.reset).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toMatchObject({
      msg: "database connection replaced",
      stage: "scope",
    });
  });

  it("gives up after the second try, and at once without a way to reset", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const twice = withDeadline(source(client(), client()), "dashboards", ask);
    const failed = expect(twice).rejects.toThrow("dashboards took over 5 s");
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;

    const once = withDeadline(
      Object.assign(() => client() as never, {}),
      "dashboards",
      ask,
    );
    const failedOnce = expect(once).rejects.toThrow("dashboards took over 5 s");
    await vi.advanceTimersByTimeAsync(5_000);
    await failedOnce;
  });
});
