import type postgres from "postgres";
import type { Catalog, CatalogTable } from "./catalog.ts";

interface TableRow {
  oid: string;
  name: string;
  reltuples: number;
}
interface ColumnRow {
  oid: string;
  name: string;
  pg_type: string;
  is_enum: boolean;
  nullable: boolean;
}
interface ConstraintRow {
  oid: string;
  contype: "p" | "f";
  columns: string[];
  references: string | null;
  referenced_columns: string[];
}
interface StatRow {
  table: string;
  column: string;
  n_distinct: number;
}

/**
 * Reads the allowlisted tables from `pg_catalog` (DESIGN.md §6). `information_schema` is not
 * used: it hides foreign keys from roles that cannot write the referencing table, and the
 * source role is read-only. `pg_stats` returns nothing for tables where row-level security
 * applies to the caller, so `nDistinct` is null there.
 */
export async function introspect(sql: postgres.Sql, tables: string[]): Promise<Catalog> {
  const found = await sql<TableRow[]>`
    select c.oid::text as oid, n.nspname || '.' || c.relname as name, c.reltuples::float8 as reltuples
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p') and n.nspname || '.' || c.relname = any(${tables})
      and has_schema_privilege(n.oid, 'usage') and has_table_privilege(c.oid, 'select')`;
  const missing = tables.filter((t) => !found.some((f) => f.name === t));
  if (missing.length > 0) {
    throw new Error(`Tables not found or not readable: ${missing.join(", ")}`);
  }
  const oids = found.map((f) => f.oid);

  const columns = await sql<ColumnRow[]>`
    select a.attrelid::text as oid, a.attname as name, t.typname as pg_type,
      t.typtype = 'e' as is_enum, not a.attnotnull as nullable
    from pg_attribute a join pg_type t on t.oid = a.atttypid
    where a.attrelid = any(${oids}::oid[]) and a.attnum > 0 and not a.attisdropped
      and has_column_privilege(a.attrelid, a.attnum, 'select')
    order by a.attrelid, a.attnum`;

  const constraints = await sql<ConstraintRow[]>`
    select con.conrelid::text as oid, con.contype,
      array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
        join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as columns,
      fn.nspname || '.' || fc.relname as references,
      array(select a.attname::text from unnest(con.confkey) with ordinality k(n, i)
        join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i)
        as referenced_columns
    from pg_constraint con
    left join pg_class fc on fc.oid = con.confrelid
    left join pg_namespace fn on fn.oid = fc.relnamespace
    where con.conrelid = any(${oids}::oid[]) and con.contype in ('p', 'f')
    order by con.conname`;

  const stats = await sql<StatRow[]>`
    select schemaname || '.' || tablename as table, attname as column, n_distinct::float8 as n_distinct
    from pg_stats
    where schemaname || '.' || tablename = any(${tables}) and not inherited`;
  const nDistinct = new Map(stats.map((s) => [`${s.table}\0${s.column}`, s.n_distinct]));

  return {
    tables: tables.map((name): CatalogTable => {
      const t = found.find((f) => f.name === name) as TableRow;
      const own = constraints.filter((c) => c.oid === t.oid);
      return {
        name,
        // reltuples is -1 until the table is first vacuumed or analyzed.
        rowCount: t.reltuples < 0 ? null : Math.round(t.reltuples),
        primaryKey: own.find((c) => c.contype === "p")?.columns ?? [],
        columns: columns
          .filter((c) => c.oid === t.oid)
          .map((c) => ({
            name: c.name,
            pgType: c.pg_type,
            isEnum: c.is_enum,
            nullable: c.nullable,
            nDistinct: nDistinct.get(`${name}\0${c.name}`) ?? null,
          })),
        foreignKeys: own
          .filter((c) => c.contype === "f")
          .map((c) => ({
            columns: c.columns,
            references: c.references as string,
            referencedColumns: c.referenced_columns,
          })),
      };
    }),
  };
}
