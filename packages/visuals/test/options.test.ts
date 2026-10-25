import type { QueryResult, ResultColumn } from "@adam-riffi/dash-core";
import { describe, expect, it } from "vitest";
import {
  barOption,
  chartLabel,
  formattersFor,
  lineOption,
  mapOption,
  scatterOption,
} from "../src/index.ts";

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

describe("scatterOption", () => {
  const orders: ResultColumn = { key: "m1", kind: "measure", type: "number", name: "Orders" };
  const points = result(
    [category, revenue, orders],
    [
      ["Garden", "<b>Toys</b>"],
      [83495.78, 39402.8],
      [540, 1200],
    ],
  );
  const formatters = formattersFor(points.columns, formats, "USD");
  type Option = {
    tooltip: { trigger: string; formatter: (p: { dataIndex: number }) => string };
    xAxis: { type: string; name: string; axisLabel: { formatter: (v: number) => string } };
    yAxis: { type: string; name: string; axisLabel: { formatter: (v: number) => string } };
    series: { type: string; data: unknown[] }[];
  };
  const option = scatterOption(points, formatters)(theme) as Option;

  it("plots one point per category, x by the first measure and y by the second", () => {
    expect(option.series).toMatchObject([
      {
        type: "scatter",
        data: [
          [83495.78, 540],
          [39402.8, 1200],
        ],
      },
    ]);
    expect(option.xAxis).toMatchObject({ type: "value", name: "Revenue" });
    expect(option.yAxis).toMatchObject({ type: "value", name: "Orders" });
    expect(option.xAxis.axisLabel.formatter(40000)).toBe("$40K");
    expect(option.yAxis.axisLabel.formatter(1200)).toBe("1.2K");
  });

  it("names a point's category and both values in its tooltip, escaping the category", () => {
    expect(option.tooltip.trigger).toBe("item");
    expect(option.tooltip.formatter({ dataIndex: 0 })).toBe(
      "Garden<br/>Revenue: $83,495.78<br/>Orders: 540",
    );
    expect(option.tooltip.formatter({ dataIndex: 1 })).toContain("&lt;b&gt;Toys&lt;/b&gt;");
  });

  it("fades the points other than the selected category", () => {
    const selected = scatterOption(points, formatters, "Garden")(theme) as Option;
    expect(selected.series[0]?.data).toEqual([
      { value: [83495.78, 540], itemStyle: { opacity: 1 } },
      { value: [39402.8, 1200], itemStyle: { opacity: 0.35 } },
    ]);
  });
});

describe("mapOption (ADR 0014)", () => {
  const country: ResultColumn = {
    key: "d0",
    kind: "dimension",
    field: "s.customers.country",
    type: "string",
  };
  const countries = result(
    [country, revenue],
    [
      ["FR", "DE", "<b>"],
      [300, 100, 50],
    ],
  );
  const formatters = formattersFor(countries.columns, formats, "USD");
  type Option = {
    tooltip: { formatter: (p: { dataIndex: number; name: string }) => string };
    visualMap: { min: number; max: number; inRange: { color: string[] } };
    series: { type: string; map: string; data: unknown[] }[];
  };
  const option = mapOption(countries, formatters)(theme) as Option;

  it("shades each country on the world map by value, named by its code", () => {
    expect(option.series).toMatchObject([
      {
        type: "map",
        map: "world",
        data: [
          { name: "FR", value: 300 },
          { name: "DE", value: 100 },
          { name: "<b>", value: 50 },
        ],
      },
    ]);
    expect(option.visualMap).toMatchObject({ min: 50, max: 300 });
    expect(option.visualMap.inRange.color.at(-1)).toBe(theme.palette[0]);
  });

  it("names a country and its value in the tooltip, escaped, and countries without data plainly", () => {
    expect(option.tooltip.formatter({ dataIndex: 0, name: "FR" })).toBe("FR: $300.00");
    expect(option.tooltip.formatter({ dataIndex: 2, name: "<b>" })).toBe("&lt;b&gt;: $50.00");
    expect(option.tooltip.formatter({ dataIndex: -1, name: "IT" })).toBe("IT");
  });

  it("fades the countries other than the selected one", () => {
    const selected = mapOption(countries, formatters, "FR")(theme) as Option;
    expect(selected.series[0]?.data).toEqual([
      { name: "FR", value: 300, itemStyle: { opacity: 1 } },
      { name: "DE", value: 100, itemStyle: { opacity: 0.35 } },
      { name: "<b>", value: 50, itemStyle: { opacity: 0.35 } },
    ]);
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

describe("selection highlight (cross-filtering, DESIGN.md §6)", () => {
  const bars = result(
    [category, revenue],
    [
      ["Garden", "Toys"],
      [83495.78, 39402.8],
    ],
  );
  const days = result(
    [day, revenue],
    [
      ["2026-09-08T00:00:00.000Z", "2026-09-10T00:00:00.000Z"],
      [1200, 3400],
    ],
  );

  it("fades the bars other than the selected category", () => {
    const option = barOption(
      bars,
      formattersFor(bars.columns, formats, "USD"),
      "Garden",
    )(theme) as { series: { data: unknown[] }[] };
    expect(option.series[0]?.data).toEqual([
      { value: 83495.78, itemStyle: { opacity: 1 } },
      { value: 39402.8, itemStyle: { opacity: 0.35 } },
    ]);
  });

  it("marks the selected period's point on a line", () => {
    const option = lineOption(
      days,
      formattersFor(days.columns, formats, "USD"),
      "2026-09-10T00:00:00.000Z",
    )(theme) as { series: { showSymbol: boolean; data: unknown[] }[] };
    expect(option.series[0]).toMatchObject({
      showSymbol: true,
      data: [
        { value: ["2026-09-08T00:00:00.000Z", 1200], symbolSize: 4 },
        { value: ["2026-09-10T00:00:00.000Z", 3400], symbolSize: 12 },
      ],
    });
  });
});
