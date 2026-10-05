import type { ContractColumn, ContractTable, FieldType, Relationship } from "@adam-riffi/dash-core";
import type { Catalog, CatalogColumn, CatalogTable } from "./catalog.ts";

// Column roles and default aggregations (DESIGN.md §6). Pure: no I/O.

const TYPES: Record<string, FieldType> = {
  int2: "number",
  int4: "number",
  int8: "number",
  float4: "number",
  float8: "number",
  numeric: "number",
  text: "string",
  varchar: "string",
  bpchar: "string",
  uuid: "string",
  bool: "boolean",
  date: "date",
  timestamp: "date",
  timestamptz: "date",
};

const AVERAGED = new Set(["price", "rate", "ratio", "pct", "percent", "score"]);
/** Lowercased, singular parts of a snake_case or camelCase name; "duration" is not "ratio". */
const nameParts = (name: string) =>
  name.split(/_|(?<=[a-z0-9])(?=[A-Z])/).map((w) => w.toLowerCase().replace(/s$/, ""));
const HIGH_CARDINALITY = 10_000;

const typeOf = (c: CatalogColumn): FieldType | undefined => (c.isEnum ? "string" : TYPES[c.pgType]);

function distinctOf(c: CatalogColumn, rowCount: number | null): number | null {
  if (c.nDistinct === null || c.nDistinct >= 0) return c.nDistinct;
  return rowCount === null ? null : Math.round(-c.nDistinct * rowCount);
}

function inferColumn(c: CatalogColumn, type: FieldType, t: CatalogTable): ContractColumn {
  const isKey =
    t.primaryKey.includes(c.name) ||
    t.foreignKeys.some((fk) => fk.columns.includes(c.name)) ||
    c.name.endsWith("_id");
  const distinct = distinctOf(c, t.rowCount);
  const base = { name: c.name, pgType: c.pgType, type, nullable: c.nullable, distinct };
  if (isKey) return { ...base, role: "id", highCardinality: false };
  if (type === "date") return { ...base, role: "time", highCardinality: false };
  if (type === "number") {
    const aggregation = nameParts(c.name).some((w) => AVERAGED.has(w)) ? "AVG" : "SUM";
    return { ...base, role: "measure", aggregation, highCardinality: false };
  }
  const highCardinality = distinct !== null && distinct > HIGH_CARDINALITY;
  return { ...base, role: "dimension", highCardinality };
}

function inferTable(t: CatalogTable): ContractTable {
  const columns = t.columns.flatMap((c) => {
    const type = typeOf(c);
    return type ? [inferColumn(c, type, t)] : [];
  });
  return { name: t.name, rowCount: t.rowCount, primaryKey: t.primaryKey, columns };
}

// Code-point order, not localeCompare: goldens and the schema hash must not depend on ICU.
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byKey = (r: Relationship) => `${r.from.table}\0${r.from.columns.join(",")}`;

/**
 * Typed columns with roles, and many-to-one relationships from foreign keys. Columns of
 * unsupported types are omitted, and so are foreign keys that would need them or that point
 * outside the allowlisted catalog.
 */
export function inferTables(catalog: Catalog): {
  tables: ContractTable[];
  relationships: Relationship[];
} {
  const tables = catalog.tables
    .map(inferTable)
    .filter((t) => t.columns.length > 0)
    .sort((a, b) => compare(a.name, b.name));
  const columnsByTable = new Map(
    tables.map((t) => [t.name, new Set(t.columns.map((c) => c.name))]),
  );
  const has = (table: string, columns: string[]) =>
    columns.every((c) => columnsByTable.get(table)?.has(c) ?? false);

  const relationships = catalog.tables
    .flatMap((t) =>
      t.foreignKeys
        .filter((fk) => has(t.name, fk.columns) && has(fk.references, fk.referencedColumns))
        .map(
          (fk): Relationship => ({
            from: { table: t.name, columns: fk.columns },
            to: { table: fk.references, columns: fk.referencedColumns },
            kind: "many-to-one",
          }),
        ),
    )
    .sort((a, b) => compare(byKey(a), byKey(b)));
  return { tables, relationships };
}
