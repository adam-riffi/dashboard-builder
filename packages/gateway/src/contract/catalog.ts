/** Raw catalog facts read by the introspector, before any inference (DESIGN.md §6). */
export interface CatalogColumn {
  name: string;
  /** `pg_type.typname`, e.g. `int8`, `timestamptz`, `_int4` for arrays. */
  pgType: string;
  /** User-defined enum types are treated as strings. */
  isEnum: boolean;
  nullable: boolean;
  /** `pg_stats.n_distinct`: absolute when >= 0, a fraction of rows when < 0; null when hidden. */
  nDistinct: number | null;
}

export interface CatalogForeignKey {
  columns: string[];
  /** `schema.table`. */
  references: string;
  referencedColumns: string[];
}

export interface CatalogTable {
  /** `schema.table`. */
  name: string;
  /** `pg_class.reltuples`; null when the table was never analyzed. */
  rowCount: number | null;
  primaryKey: string[];
  /** In ordinal order. */
  columns: CatalogColumn[];
  foreignKeys: CatalogForeignKey[];
}

export interface Catalog {
  tables: CatalogTable[];
}
