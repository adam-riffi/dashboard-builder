import postgres from "postgres";

let source: postgres.Sql | undefined;

/** One connection per function instance; the transaction pooler needs prepared statements off. */
export function sourceDb(): postgres.Sql {
  source ??= postgres(process.env.DASH_SOURCE_URL ?? "", {
    max: 1,
    prepare: false,
    connect_timeout: 5,
  });
  return source;
}
