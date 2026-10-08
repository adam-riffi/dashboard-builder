"use client";

import type { EChartsCoreOption } from "echarts/core";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { labelOf } from "./format.ts";
import { barOption, chartLabel, lineOption, type Theme } from "./options.ts";
import type { VisualProps } from "./plugin.ts";

/**
 * Visual identity (DESIGN.md §7) through CSS variables a host may set: `--dash-ink`,
 * `--dash-muted`, `--dash-accent`, `--dash-grid`, `--dash-series-2` … `--dash-series-5`.
 */
const ink = "var(--dash-ink, #1c1f24)";
const muted = "var(--dash-muted, #6b6f76)";
const grid = "var(--dash-grid, rgba(107, 111, 118, 0.25))";
const numerals: CSSProperties = { fontVariantNumeric: "tabular-nums" };

/**
 * One big number, the first measure of the first row; the card's title names it. The number
 * shrinks with a narrow card (container units) and wraps rather than spill into its neighbour.
 */
export function Kpi({ result, formatters }: VisualProps) {
  const format = formatters[0] ?? String;
  return (
    <div style={{ containerType: "inline-size" }}>
      <div
        style={{
          ...numerals,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: "clamp(1rem, 14cqi, 2.25rem)",
          lineHeight: 1.1,
          overflowWrap: "anywhere",
          color: ink,
        }}
      >
        {format(result.data[0]?.[0])}
      </div>
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

interface EChart {
  setOption(option: EChartsCoreOption, opts: { notMerge: boolean }): void;
  resize(): void;
  dispose(): void;
}

/**
 * An ECharts chart, loaded on first use (DESIGN.md §13). It is created once per mount and only
 * redrawn when its option changes or the color scheme flips. Animations are off so screenshots
 * are stable; `data-ready` is set while a drawing is on screen.
 */
function Chart({ option, label }: { option: (theme: Theme) => EChartsCoreOption; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChart | null>(null);
  const latest = useRef(option);
  const [failed, setFailed] = useState(false);

  const draw = useCallback(() => {
    const el = ref.current;
    if (!el || !chart.current) return;
    chart.current.setOption(
      { animation: false, ...latest.current(themeOf(el)) },
      { notMerge: true },
    );
    el.dataset.ready = "true";
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let gone = false;
    const resize = new ResizeObserver(() => chart.current?.resize());
    // CSS variables change with the scheme; ECharts holds resolved colors, so draw again.
    const scheme = matchMedia("(prefers-color-scheme: dark)");
    import("./echarts.ts")
      .then(({ init }) => {
        if (gone) return;
        chart.current = init(el, undefined, { renderer: "svg" });
        draw();
        resize.observe(el);
        scheme.addEventListener("change", draw);
      })
      .catch(() => {
        // A chunk that fails to load (a tab left open across a deploy) gets a message.
        if (!gone) setFailed(true);
      });
    return () => {
      gone = true;
      resize.disconnect();
      scheme.removeEventListener("change", draw);
      chart.current?.dispose();
      chart.current = null;
      delete el.dataset.ready;
    };
  }, [draw]);

  useEffect(() => {
    latest.current = option;
    draw();
  }, [option, draw]);

  if (failed) {
    return (
      <p style={{ color: muted, margin: 0 }}>This chart could not load. Reload to try again.</p>
    );
  }
  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      style={{ width: "100%", height: "100%", minHeight: 100 }}
    />
  );
}

/** Categories as horizontal bars, the first category on top. */
export function Bar({ result, formatters }: VisualProps) {
  const option = useMemo(() => barOption(result, formatters), [result, formatters]);
  const label = useMemo(() => chartLabel(result, formatters), [result, formatters]);
  return <Chart option={option} label={label} />;
}

/** Measures over time, oldest on the left, on a time axis. */
export function Line({ result, formatters }: VisualProps) {
  const option = useMemo(() => lineOption(result, formatters), [result, formatters]);
  const label = useMemo(() => chartLabel(result, formatters), [result, formatters]);
  return <Chart option={option} label={label} />;
}
