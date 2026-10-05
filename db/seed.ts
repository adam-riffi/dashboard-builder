import { fileURLToPath } from "node:url";
import postgres from "postgres";

/** Loads the deterministic demo data; safe to run repeatedly (DESIGN.md §8). */
export async function seed(sql: postgres.Sql): Promise<void> {
  await sql.file(fileURLToPath(new URL("seed.sql", import.meta.url)));
}

if (import.meta.main) {
  const sql = postgres(
    process.env.DATABASE_URL_MIGRATIONS ?? "postgres://postgres:postgres@localhost:54322/postgres",
    { onnotice: () => {} },
  );
  await seed(sql);
  await sql.end();
}
