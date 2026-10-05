import { dataContract } from "@adam-riffi/dash-core";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Catalog, CatalogTable } from "../../src/contract/catalog.ts";
import { schemaHash } from "../../src/contract/hash.ts";
import { inferContract } from "../../src/contract/index.ts";

const SUPPORTED = ["int4", "int8", "numeric", "text", "uuid", "bool", "date", "timestamptz"];

const column = fc.record({
  name: fc.stringMatching(/^[a-z]{1,8}$/),
  pgType: fc.constantFrom(...SUPPORTED, "jsonb"),
  isEnum: fc.constant(false),
  nullable: fc.boolean(),
  nDistinct: fc.option(fc.integer({ min: -1, max: 1_000_000 }), { nil: null }),
});

const table = fc.record({
  name: fc.stringMatching(/^s\.[a-z]{1,8}$/),
  rowCount: fc.option(fc.nat(), { nil: null }),
  primaryKey: fc.constant<string[]>([]),
  columns: fc.uniqueArray(column, { selector: (c) => c.name, minLength: 1, maxLength: 6 }),
  foreignKeys: fc.constant<CatalogTable["foreignKeys"]>([]),
});

/** Random catalogs where every table has at least one supported column. */
const catalog = fc.uniqueArray(table, { selector: (t) => t.name, minLength: 1, maxLength: 5 }).map(
  (tables): Catalog => ({
    tables: tables.map((t) => ({
      ...t,
      columns: [
        { name: "_key", pgType: "int4", isEnum: false, nullable: false, nDistinct: null },
        ...t.columns,
      ],
    })),
  }),
);

const configOf = (c: Catalog) => ({ tables: c.tables.map((t) => t.name) });
const hashOf = (c: Catalog) => schemaHash(c, configOf(c));
const mapTables = (c: Catalog, f: (t: CatalogTable) => CatalogTable): Catalog => ({
  tables: c.tables.map(f),
});

describe("schemaHash", () => {
  it("is a SHA-256 hex digest", () => {
    fc.assert(
      fc.property(catalog, (c) => {
        expect(hashOf(c)).toMatch(/^[0-9a-f]{64}$/);
      }),
    );
  });

  it("ignores the order of tables and of the allowlist", () => {
    fc.assert(
      fc.property(catalog, (c) => {
        const reversed = { tables: [...c.tables].reverse() };
        expect(schemaHash(reversed, { tables: configOf(c).tables.reverse() })).toBe(hashOf(c));
      }),
    );
  });

  it("ignores statistics, so live inserts keep the version", () => {
    fc.assert(
      fc.property(catalog, fc.nat(), fc.integer({ min: 0, max: 1_000_000 }), (c, rows, nd) => {
        const restated = mapTables(c, (t) => ({
          ...t,
          rowCount: rows,
          columns: t.columns.map((col) => ({ ...col, nDistinct: nd })),
        }));
        expect(hashOf(restated)).toBe(hashOf(c));
      }),
    );
  });

  it("changes when a column type, nullability or primary key changes", () => {
    fc.assert(
      fc.property(catalog, (c) => {
        const first = (f: (t: CatalogTable) => CatalogTable) =>
          ({ tables: [f(c.tables[0] as CatalogTable), ...c.tables.slice(1)] }) as Catalog;
        const setKey = (patch: object) =>
          first((t) => ({
            ...t,
            columns: [
              { ...t.columns[0], ...patch } as (typeof t.columns)[0],
              ...t.columns.slice(1),
            ],
          }));
        expect(hashOf(setKey({ pgType: "text" }))).not.toBe(hashOf(c));
        expect(hashOf(setKey({ nullable: !c.tables[0]?.columns[0]?.nullable }))).not.toBe(
          hashOf(c),
        );
        expect(hashOf(first((t) => ({ ...t, primaryKey: ["_key"] })))).not.toBe(hashOf(c));
      }),
    );
  });

  it("changes when the allowlist changes", () => {
    fc.assert(
      fc.property(catalog, (c) => {
        expect(schemaHash(c, { tables: [...configOf(c).tables, "s.extra"] })).not.toBe(hashOf(c));
      }),
    );
  });

  it("ignores the order of foreign keys and changes when one is added", () => {
    const fk = (col: string) => ({ columns: [col], references: "s.a", referencedColumns: ["id"] });
    const a: CatalogTable = {
      name: "s.a",
      rowCount: 1,
      primaryKey: ["id"],
      columns: [{ name: "id", pgType: "int4", isEnum: false, nullable: false, nDistinct: null }],
      foreignKeys: [],
    };
    const b = (foreignKeys: CatalogTable["foreignKeys"]): CatalogTable => ({
      ...a,
      name: "s.b",
      primaryKey: [],
      columns: ["x", "y"].map((name) => ({ ...a.columns[0], name }) as CatalogTable["columns"][0]),
      foreignKeys,
    });
    const config = { tables: ["s.a", "s.b"] };
    const one = schemaHash({ tables: [a, b([fk("x"), fk("y")])] }, config);
    expect(schemaHash({ tables: [a, b([fk("y"), fk("x")])] }, config)).toBe(one);
    expect(schemaHash({ tables: [a, b([fk("x")])] }, config)).not.toBe(one);
  });
});

describe("inferContract", () => {
  it("produces valid contracts versioned by the schema hash", () => {
    fc.assert(
      fc.property(catalog, (c) => {
        const contract = inferContract(c, configOf(c));
        expect(dataContract.parse(contract)).toEqual(contract);
        expect(contract.contractVersion).toBe(hashOf(c));
      }),
    );
  });
});
