import { describe, expect, it, vi } from "vitest";
import { CONTRACT_TTL_MS, cachedContract } from "../../src/contract/cache.ts";

/** A contract load that counts its calls and resolves when the test says so. */
function loads() {
  const pending: { resolve: (v: string) => void; reject: (e: Error) => void }[] = [];
  const load = vi.fn(
    () =>
      new Promise<string>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { load, pending };
}

describe("contract cache (DESIGN.md §6)", () => {
  it("introspects once for concurrent first requests", async () => {
    const { load, pending } = loads();
    const contract = cachedContract(load, () => 0);
    const both = Promise.all([contract(), contract(), contract()]);
    pending[0]?.resolve("v1");
    expect(await both).toEqual(["v1", "v1", "v1"]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it(`keeps the contract for ${CONTRACT_TTL_MS / 1000} s, then checks again while serving the last one`, async () => {
    const { load, pending } = loads();
    let now = 0;
    const contract = cachedContract(load, () => now);
    const first = contract();
    pending[0]?.resolve("v1");
    await first;

    now = CONTRACT_TTL_MS - 1;
    expect(await contract()).toBe("v1");
    expect(load).toHaveBeenCalledTimes(1);

    now = CONTRACT_TTL_MS;
    // The check is under way: requests are not held up by it.
    expect(await contract()).toBe("v1");
    expect(await contract()).toBe("v1");
    expect(load).toHaveBeenCalledTimes(2);
    pending[1]?.resolve("v2");
    await vi.waitFor(async () => expect(await contract()).toBe("v2"));
  });

  it("does not keep a failed introspection: the next request tries again", async () => {
    const { load, pending } = loads();
    const contract = cachedContract(load, () => 0);
    const failed = contract();
    pending[0]?.reject(new Error("database down"));
    await expect(failed).rejects.toThrow("database down");
    const retry = contract();
    pending[1]?.resolve("v1");
    expect(await retry).toBe("v1");
  });

  it("keeps serving the last contract when a later check fails", async () => {
    const { load, pending } = loads();
    let now = 0;
    const contract = cachedContract(load, () => now);
    const first = contract();
    pending[0]?.resolve("v1");
    await first;
    now = CONTRACT_TTL_MS;
    expect(await contract()).toBe("v1");
    pending[1]?.reject(new Error("database down"));
    // Let the failed check settle (a macrotask runs every pending microtask first).
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await contract()).toBe("v1");
    // The failed check is retried by the next request rather than waiting another minute.
    expect(load).toHaveBeenCalledTimes(3);
  });
});
