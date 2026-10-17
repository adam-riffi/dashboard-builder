/** How long an instance trusts its contract before introspecting again (DESIGN.md §6). */
export const CONTRACT_TTL_MS = 60_000;

/**
 * The contract cache (DESIGN.md §6): one load at a time, shared by every request that arrives
 * while it runs; the result is kept for `CONTRACT_TTL_MS`, then checked again while the last
 * contract keeps serving requests. A failed load is never kept: the next request tries again.
 */
export function cachedContract<T>(load: () => Promise<T>, now: () => number = Date.now) {
  let last: { value: T } | undefined;
  let checkedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<T> | undefined;
  return (): Promise<T> => {
    if (!pending && now() - checkedAt >= CONTRACT_TTL_MS) {
      checkedAt = now();
      // Settled state is recorded before any caller resumes, so the next call sees it.
      const loading = load().then(
        (value) => {
          last = { value };
          pending = undefined;
          return value;
        },
        (error: unknown) => {
          checkedAt = Number.NEGATIVE_INFINITY;
          pending = undefined;
          throw error;
        },
      );
      pending = loading;
      // Requests served the last contract never await this one; its failure is not unhandled.
      loading.catch(() => {});
    }
    return last ? Promise.resolve(last.value) : (pending as Promise<T>);
  };
}
