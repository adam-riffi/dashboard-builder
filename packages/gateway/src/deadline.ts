import type { GatewayConfig } from "./config.ts";

/**
 * A database call still unanswered after this long is abandoned. On fresh deployments a first
 * query through the pooler sometimes never answers (the pooler sees the connection idle), and
 * with one connection per instance every later call would wait behind it.
 */
const DEADLINE_MS = 5_000;

class DatabaseTimeout extends Error {}

/**
 * Runs a database call with a deadline. A call that misses it gets a new connection and one more
 * try, so only calls that are safe to repeat belong here: reads, upserts, deletes by key. The
 * gateway runs its own reads this way; hosts can too, for their own tables.
 */
export async function withDeadline<T>(
  source: GatewayConfig["source"],
  stage: string,
  run: (sql: ReturnType<GatewayConfig["source"]>) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const pending = run(source());
    // A call abandoned below rejects when its connection closes: nobody is waiting for it.
    pending.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new DatabaseTimeout(`${stage} took over 5 s`)), DEADLINE_MS);
    });
    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      if (!(error instanceof DatabaseTimeout) || attempt > 1 || !source.reset) throw error;
      console.warn(JSON.stringify({ level: "warn", msg: "database connection replaced", stage }));
      source.reset();
    } finally {
      clearTimeout(timer);
    }
  }
}
