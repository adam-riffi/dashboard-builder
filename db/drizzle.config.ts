import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./schema.ts",
  out: "./migrations",
  dbCredentials: {
    url:
      process.env.DATABASE_URL_MIGRATIONS ??
      "postgres://postgres:postgres@localhost:54322/postgres",
  },
  migrations: { schema: "dash", table: "__drizzle_migrations" },
});
