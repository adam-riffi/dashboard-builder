import postgres from "postgres";

const url =
  process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres";

const pauseTick = async (active: boolean) => {
  const sql = postgres(url, { onnotice: () => {} });
  await sql`select cron.alter_job(jobid, active := ${active})
    from cron.job where jobname = 'dash_demo_tick'`;
  await sql.end();
};

/**
 * Integration tests truncate tables, so they refuse any non-local database. The pg_cron tick
 * is paused while they run so it cannot insert orders between a test's reads.
 */
export async function setup() {
  const host = new URL(url).hostname;
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) {
    throw new Error(`Refusing to run destructive integration tests against ${host}`);
  }
  await pauseTick(false);
  return () => pauseTick(true);
}
