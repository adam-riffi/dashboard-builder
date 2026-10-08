import type { QueryResult, ResultColumn } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import { barOption, chartLabel, formattersFor, lineOption } from "../src/index.ts";

const theme = { ink: "#111", muted: "#666", grid: "#ccc", palette: ["#e4572e", "#4c6a92"] };
const result = (columns: ResultColumn[], data: unknown[][]): QueryResult => ({
  columns,
  data,
  meta: { cache: "miss", ms: 1, truncated: false },
});
const category: ResultColumn = {
  key: "d0",
  kind: "dimension",
  field: "s.products.category",
  type: "string",
};
const day: ResultColumn = {
  key: "d0",
  kind: "dimension",
  field: "s.orders.ordered_at",
  timeGrain: "day",
  type: "date",
};
const revenue: ResultColumn = { key: "m0", kind: "measure", type: "number", name: "Revenue" };
const formats = new Map([["Revenue", "currency" as const]]);

describe("lineOption", () => {
  // Two days with orders around a day without any: the gap must stay a gap.
  const sparse = result(
    [day, revenue],
    [
      ["2026-09-08T00:00:00.000Z", "2026-09-10T00:00:00.000Z"],
      [1200, 3400],
    ],
  );
  const option = lineOption(sparse, formattersFor(sparse.columns, formats, "USD"))(theme) as {
    xAxis: { type: string; axisLabel: { formatter: (v: number) => string } };
    yAxis: { axisLabel: { formatter: (v: number) => string } };
    series: { type: string; name: string; data: unknown[] }[];
  };

  it("places points on a time axis, so days without data keep their place", () => {
    expect(option.xAxis.type).toBe("time");
    expect(option.series).toMatchObject([
      {
        type: "line",
        name: "Revenue",
        data: [
          ["2026-09-08T00:00:00.000Z", 1200],
          ["2026-09-10T00:00:00.000Z", 3400],
        ],
      },
    ]);
  });

  it("labels the time axis at the grain and the value axis compactly", () => {
    expect(option.xAxis.axisLabel.formatter(Date.UTC(2026, 8, 9))).toBe("Sep 9, 2026");
    expect(option.yAxis.axisLabel.formatter(20000)).toBe("$20K");
  });
});

describe("barOption", () => {
  it("lists categories on the vertical axis, values compactly on the horizontal one", () => {
    const bars = result(
      [category, revenue],
      [
        ["Garden", "Toys"],
        [83495.78, 39402.8],
      ],
    );
    const option = barOption(bars, formattersFor(bars.columns, formats, "USD"))(theme) as {
      yAxis: { type: string; data: string[]; inverse: boolean };
      xAxis: { axisLabel: { formatter: (v: number) => string; hideOverlap: boolean } };
      series: { data: unknown[] }[];
    };
    expect(option.yAxis).toMatchObject({
      type: "category",
      data: ["Garden", "Toys"],
      inverse: true,
    });
    expect(option.xAxis.axisLabel.formatter(40000)).toBe("$40K");
    // In a narrow card the labels would run into each other; ECharts drops the ones that would.
    expect(option.xAxis.axisLabel.hideOverlap).toBe(true);
    expect(option.series[0]?.data).toEqual([83495.78, 39402.8]);
  });
});

describe("chartLabel", () => {
  it("describes a chart's data in words, for screen readers", () => {
    const bars = result(
      [category, revenue],
      [
        ["Garden", "Toys"],
        [83495.78, 39402.8],
      ],
    );
    expect(chartLabel(bars, formattersFor(bars.columns, formats, "USD"))).toBe(
      "Revenue by Category: Garden $83,495.78; Toys $39,402.80",
    );
  });

  it("names the first points of a long series and counts the rest", () => {
    const many = result(
      [category, revenue],
      [Array.from({ length: 15 }, (_, i) => `C${i}`), Array.from({ length: 15 }, (_, i) => i)],
    );
    const label = chartLabel(many, formattersFor(many.columns, new Map(), "USD"));
    expect(label).toContain("C11 11");
    expect(label).not.toContain("C12");
    expect(label.endsWith("and 3 more")).toBe(true);
  });
});
