import { describe, expect, it } from "vitest";
import type { OutputColumn } from "../../src/query/compile.ts";
import { shapeResult } from "../../src/query/result.ts";

const columns: OutputColumn[] = [
  { key: "d0", kind: "dimension", field: "s.t.region", type: "string" },
  { key: "d1", kind: "dimension", field: "s.t.day", timeGrain: "day", type: "date" },
  { key: "m0", kind: "measure", field: "s.t.amount", aggregation: "SUM", type: "number" },
];
const day = new Date("2026-01-01T00:00:00.000Z");

describe("shapeResult", () => {
  it("returns column-major data in column order", () => {
    const rows = [
      { d0: "north", d1: day, m0: "40.00" },
      { d0: "south", d1: day, m0: "20.00" },
    ];
    expect(shapeResult(rows, columns, 10)).toEqual({
      columns,
      data: [
        ["north", "south"],
        ["2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
        [40, 20],
      ],
      truncated: false,
    });
  });

  it("turns numeric strings and bigints into numbers and keeps nulls", () => {
    const rows = [
      { d0: "x", d1: null, m0: "12345678901" },
      { d0: null, d1: day, m0: null },
    ];
    const { data } = shapeResult(rows, columns, 10);
    expect(data[2]).toEqual([12_345_678_901, null]);
    expect(data[0]).toEqual(["x", null]);
    expect(data[1]).toEqual([null, "2026-01-01T00:00:00.000Z"]);
  });

  it("drops the extra row and reports truncation", () => {
    const rows = [1, 2, 3].map((i) => ({ d0: `r${i}`, d1: day, m0: i }));
    const result = shapeResult(rows, columns, 2);
    expect(result.truncated).toBe(true);
    expect(result.data[0]).toEqual(["r1", "r2"]);
  });

  it("returns empty columns for no rows", () => {
    expect(shapeResult([], columns, 10).data).toEqual([[], [], []]);
  });
});
