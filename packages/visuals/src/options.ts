import type { QueryResult } from "@adam-riffi/dash-core";
import type { EChartsCoreOption } from "echarts/core";
import { type Formatter, labelOf } from "./format.ts";

/** Colors read from the host's CSS variables when a chart is drawn. */
export interface Theme {
  ink: string;
  muted: string;
  grid: string;
  palette: string[];
}

const axisStyle = (t: Theme) => ({
  axisLabel: { color: t.muted },
  axisLine: { lineStyle: { color: t.grid } },
  splitLine: { lineStyle: { color: t.grid } },
});

/** One series per measure column, each with its tooltip format. */
function seriesOf(
  result: QueryResult,
  formatters: Formatter[],
  type: "bar" | "line",
  point: (row: number, value: unknown) => unknown,
) {
  return result.columns.slice(1).map((column, i) => ({
    type,
    name: labelOf(column),
    data: (result.data[i + 1] ?? []).map((value, row) => point(row, value)),
    tooltip: { valueFormatter: formatters[i + 1] ?? String },
  }));
}

const frame = (t: Theme, series: unknown[]) => ({
  color: t.palette,
  textStyle: { color: t.ink },
  grid: { left: 8, right: 24, top: series.length > 1 ? 32 : 8, bottom: 8, containLabel: true },
  legend: { show: series.length > 1, top: 0, textStyle: { color: t.muted } },
  tooltip: { trigger: "axis" },
});

/** Categories as horizontal bars, the first category on top, values labelled compactly. */
export function barOption(result: QueryResult, formatters: Formatter[]) {
  const labels = (result.data[0] ?? []).map((v) => (formatters[0] ?? String)(v));
  const series = seriesOf(result, formatters, "bar", (_, value) => value);
  const compact = formatters[1]?.compact ?? String;
  return (t: Theme): EChartsCoreOption => ({
    ...frame(t, series),
    xAxis: {
      type: "value",
      ...axisStyle(t),
      axisLabel: { color: t.muted, formatter: compact, hideOverlap: true },
    },
    yAxis: { type: "category", inverse: true, data: labels, ...axisStyle(t) },
    series,
  });
}

/**
 * Measures over time on a time axis, so periods without rows keep their place instead of
 * closing up; the axis is labelled at the query's grain.
 */
export function lineOption(result: QueryResult, formatters: Formatter[]) {
  const dates = result.data[0] ?? [];
  const date = (ms: number) => (formatters[0] ?? String)(new Date(ms).toISOString());
  const series = seriesOf(result, formatters, "line", (row, value) => [dates[row], value]).map(
    (s) => ({ ...s, showSymbol: dates.length <= 40 }),
  );
  const compact = formatters[1]?.compact ?? String;
  return (t: Theme): EChartsCoreOption => ({
    ...frame(t, series),
    xAxis: {
      type: "time",
      ...axisStyle(t),
      axisLabel: { color: t.muted, formatter: date, hideOverlap: true },
      axisPointer: { label: { formatter: ({ value }: { value: number }) => date(value) } },
    },
    yAxis: { type: "value", ...axisStyle(t), axisLabel: { color: t.muted, formatter: compact } },
    series,
  });
}

const SPOKEN_POINTS = 12;

/** A chart's data in words, its text alternative: "Revenue by Category: Garden $83,495.78; …". */
export function chartLabel(result: QueryResult, formatters: Formatter[]): string {
  const [axis, ...values] = result.columns;
  if (!axis) return "";
  const measures = values.map(labelOf).join(" and ");
  const rows = result.data[0]?.length ?? 0;
  const points = Array.from({ length: Math.min(rows, SPOKEN_POINTS) }, (_, r) => {
    const at = (formatters[0] ?? String)(result.data[0]?.[r]);
    const amounts = values.map((_, i) => (formatters[i + 1] ?? String)(result.data[i + 1]?.[r]));
    return `${at} ${amounts.join(", ")}`;
  });
  const more = rows > SPOKEN_POINTS ? ` and ${rows - SPOKEN_POINTS} more` : "";
  return `${measures} by ${labelOf(axis)}: ${points.join("; ")}${more}`;
}
