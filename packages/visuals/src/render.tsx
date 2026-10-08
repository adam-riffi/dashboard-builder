"use client";

import type { EChartsCoreOption } from "echarts/core";
import { type CSSProperties, useEffect, useMemo, useRef } from "react";
import { labelOf } from "./format.ts";
import type { VisualProps } from "./plugin.ts";

/**
 * Visual identity (DESIGN.md §7) through CSS variables a host may set: `--dash-ink`,
 * `--dash-muted`, `--dash-accent`, `--dash-grid`, `--dash-series-2` … `--dash-series-5`.
 */
const ink = "var(--dash-ink, #1c1f24)";
const muted = "var(--dash-muted, #6b6f76)";
const grid = "var(--dash-grid, rgba(107, 111, 118, 0.25))";
const numerals: CSSProperties = { fontVariantNumeric: "tabular-nums" };

/** One big number, the first measure of the first row; the card's title names it. */
export function Kpi({ result, formatters }: VisualProps) {
  const format = formatters[0] ?? String;
  return (
    <div
      style={{
        ...numerals,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: "2.25rem",
        lineHeight: 1.1,
        color: ink,
      }}
    >
      {format(result.data[0]?.[0])}
    </div>
  );
}

/** Rows and columns as returned, numbers right-aligned. */
export function Table({ result, formatters }: VisualProps) {
  const rows = result.data[0]?.length ?? 0;
  const cell = (numeric: boolean): CSSProperties => ({
    padding: "4px 8px",
    borderBottom: `1px solid ${grid}`,
    textAlign: numeric ? "right" : "left",
    ...(numeric ? numerals : {}),
  });
  return (
    <div style={{ overflow: "auto", maxHeight: "100%" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", color: ink }}>
        <thead>
          <tr>
            {result.columns.map((c) => (
              <th key={c.key} style={{ ...cell(c.type === "number"), color: muted }}>
                {labelOf(c)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond position
            <tr key={r}>
              {result.columns.map((c, i) => (
                <td key={c.key} style={cell(c.type === "number")}>
                  {(formatters[i] ?? String)(result.data[i]?.[r])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {result.meta.truncated && (
        <p style={{ color: muted, margin: "4px 8px" }}>Showing the first {rows} rows.</p>
      )}
    </div>
  );
}

interface Theme {
  ink: string;
  muted: string;
  grid: string;
  palette: string[];
}

/** ECharts draws SVG attributes, which cannot hold CSS variables, so they are read here. */
function themeOf(el: HTMLElement): Theme {
  const style = getComputedStyle(el);
  const read = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    ink: read("--dash-ink", "#1c1f24"),
    muted: read("--dash-muted", "#6b6f76"),
    grid: read("--dash-grid", "rgba(107, 111, 118, 0.25)"),
    palette: [
      read("--dash-accent", "#e4572e"),
      read("--dash-series-2", "#4c6a92"),
      read("--dash-series-3", "#7a9e7e"),
      read("--dash-series-4", "#c9a227"),
      read("--dash-series-5", "#8b6f9e"),
    ],
  };
}

/**
 * An ECharts chart, loaded on first use (DESIGN.md §13). Animations are off so screenshots are
 * stable; `data-ready` is set once drawn.
 */
function Chart({ option }: { option: (theme: Theme) => EChartsCoreOption }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let chart: { resize(): void; dispose(): void } | undefined;
    let gone = false;
    const resize = new ResizeObserver(() => chart?.resize());
    void import("./echarts.ts").then(({ init }) => {
      if (gone) return;
      const instance = init(el, undefined, { renderer: "svg" });
      instance.setOption({ animation: false, ...option(themeOf(el)) });
      chart = instance;
      resize.observe(el);
      el.dataset.ready = "true";
    });
    return () => {
      gone = true;
      resize.disconnect();
      chart?.dispose();
    };
  }, [option]);
  return <div ref={ref} style={{ width: "100%", height: "100%", minHeight: 180 }} />;
}

/** Shared chart pieces: the category labels, one series per measure, axis colors. */
function useSeries({ result, formatters }: VisualProps, type: "bar" | "line") {
  return useMemo(() => {
    const [axis, ...values] = result.columns;
    const labels = (result.data[0] ?? []).map((v) => (formatters[0] ?? String)(v));
    const series = values.map((c, i) => ({
      type,
      name: labelOf(c),
      data: result.data[i + 1] ?? [],
      tooltip: { valueFormatter: formatters[i + 1] ?? String },
      ...(type === "line" ? { showSymbol: labels.length <= 40 } : {}),
    }));
    return { axis, labels, series, valueFormat: formatters[1]?.compact ?? String };
  }, [result, formatters, type]);
}

const axisStyle = (t: Theme) => ({
  axisLabel: { color: t.muted },
  axisLine: { lineStyle: { color: t.grid } },
  splitLine: { lineStyle: { color: t.grid } },
});

/** Categories as horizontal bars, the first category on top. */
export function Bar(props: VisualProps) {
  const { labels, series, valueFormat } = useSeries(props, "bar");
  const option = useMemo(
    () => (t: Theme) => ({
      color: t.palette,
      textStyle: { color: t.ink },
      grid: { left: 8, right: 24, top: series.length > 1 ? 32 : 8, bottom: 8, containLabel: true },
      legend: { show: series.length > 1, top: 0, textStyle: { color: t.muted } },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "value",
        ...axisStyle(t),
        axisLabel: { color: t.muted, formatter: valueFormat },
      },
      yAxis: { type: "category", inverse: true, data: labels, ...axisStyle(t) },
      series,
    }),
    [labels, series, valueFormat],
  );
  return <Chart option={option} />;
}

/** Measures over time, oldest on the left. */
export function Line(props: VisualProps) {
  const { labels, series, valueFormat } = useSeries(props, "line");
  const option = useMemo(
    () => (t: Theme) => ({
      color: t.palette,
      textStyle: { color: t.ink },
      grid: { left: 8, right: 24, top: series.length > 1 ? 32 : 8, bottom: 8, containLabel: true },
      legend: { show: series.length > 1, top: 0, textStyle: { color: t.muted } },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: labels, boundaryGap: false, ...axisStyle(t) },
      yAxis: {
        type: "value",
        ...axisStyle(t),
        axisLabel: { color: t.muted, formatter: valueFormat },
      },
      series,
    }),
    [labels, series, valueFormat],
  );
  return <Chart option={option} />;
}
