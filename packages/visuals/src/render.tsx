"use client";

import type { EChartsCoreOption } from "echarts/core";
import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { labelOf } from "./format.ts";
import {
  barOption,
  chartLabel,
  lineOption,
  mapOption,
  scatterOption,
  type Theme,
} from "./options.ts";
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

/**
 * A keyboard way to select (cross-filtering, DESIGN.md §6): one choice of the first dimension's
 * values, hidden until it has focus (the host styles `.dash-pick`), so charts need no tab stop
 * per point.
 */
function Pick({ result, formatters, selected, onSelect }: VisualProps) {
  const [axis] = result.columns;
  const values = result.data[0] ?? [];
  const at = values.indexOf(selected);
  const current = at < 0 ? "" : String(at);
  // Arrow keys change a closed select one step at a time; the choice applies on Enter or on
  // leaving the picker, not on each step.
  const [draft, setDraft] = useState(current);
  // A selection changed elsewhere (a click, a cleared chip) resets the draft to it.
  const [applied, setApplied] = useState(current);
  if (applied !== current) {
    setApplied(current);
    setDraft(current);
  }
  if (!onSelect || !axis) return null;
  const apply = () => {
    if (draft === current) return;
    onSelect(draft === "" ? selected : values[Number(draft)]);
  };
  return (
    <select
      className="dash-pick"
      aria-label={`Filter by ${labelOf(axis)}`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") apply();
      }}
      onBlur={apply}
    >
      <option value="">All</option>
      {values.map((v, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: values may repeat formatted; positions do not
        <option key={i} value={String(i)}>
          {(formatters[0] ?? String)(v)}
        </option>
      ))}
    </select>
  );
}

/** Rows and columns as returned, numbers right-aligned; a row's key selects it when allowed. */
export function Table({ result, formatters, selected, onSelect }: VisualProps) {
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
              {result.columns.map((c, i) => {
                const text = (formatters[i] ?? String)(result.data[i]?.[r]);
                const key = result.data[0]?.[r];
                return (
                  <td key={c.key} style={cell(c.type === "number")}>
                    {onSelect && i === 0 && c.kind === "dimension" ? (
                      <button
                        type="button"
                        className="dash-row"
                        aria-pressed={key === selected}
                        onClick={() => onSelect(key)}
                      >
                        {text}
                      </button>
                    ) : (
                      text
                    )}
                  </td>
                );
              })}
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
  on(event: "click", handler: (params: unknown) => void): unknown;
  resize(): void;
  dispose(): void;
}

/**
 * An ECharts chart, loaded on first use (DESIGN.md §13). It is created once per mount and only
 * redrawn when its option changes or the color scheme flips. Animations are off so screenshots
 * are stable; `data-ready` is set while a drawing is on screen.
 */
function Chart({
  option,
  label,
  onPick,
  world = false,
}: {
  option: (theme: Theme) => EChartsCoreOption;
  label: string;
  /** A click on a data point, by its row. */
  onPick?: ((row: number) => void) | undefined;
  /** Whether the chart draws on the world map, which loads before the chart is created. */
  world?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<EChart | null>(null);
  const latest = useRef(option);
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
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
      .then(async ({ init, registerWorld }) => {
        if (world) await registerWorld();
        if (gone) return;
        const created = init(el, undefined, { renderer: "svg" });
        created.on("click", (params) =>
          pick.current?.((params as { dataIndex: number }).dataIndex),
        );
        chart.current = created;
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
  }, [draw, world]);

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

/** A chart whose points select their row's first-dimension value, by click or by keyboard. */
function SelectableChart(
  props: VisualProps & {
    build: (
      result: VisualProps["result"],
      f: VisualProps["formatters"],
      s?: unknown,
    ) => (theme: Theme) => EChartsCoreOption;
    world?: boolean;
  },
) {
  const { result, formatters, selected, onSelect, build, world } = props;
  const option = useMemo(
    () => build(result, formatters, selected),
    [build, result, formatters, selected],
  );
  const label = useMemo(() => chartLabel(result, formatters), [result, formatters]);
  const onPick = onSelect && ((row: number) => onSelect(result.data[0]?.[row]));
  return (
    <>
      <Chart option={option} label={label} onPick={onPick} world={world ?? false} />
      <Pick {...props} />
    </>
  );
}

/** Categories as horizontal bars, the first category on top. */
export function Bar(props: VisualProps) {
  return <SelectableChart {...props} build={barOption} />;
}

/** Measures over time, oldest on the left, on a time axis. */
export function Line(props: VisualProps) {
  return <SelectableChart {...props} build={lineOption} />;
}

/** One point per category, placed by two measures. */
export function Scatter(props: VisualProps) {
  return <SelectableChart {...props} build={scatterOption} />;
}

/** Countries on the world map, shaded by value. */
export function WorldMap(props: VisualProps) {
  return <SelectableChart {...props} build={mapOption} world />;
}
