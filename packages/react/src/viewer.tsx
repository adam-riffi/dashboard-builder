"use client";

import type {
  DashboardSpec,
  DashboardVisual,
  MeasureFormat,
  QueryResult,
} from "@adam-riffi/dash-core";
import { formattersFor, getVisual } from "@adam-riffi/dash-visuals";
import { Component, type CSSProperties, type ReactNode, useMemo, useState } from "react";
import type { Selection } from "./crossfilter.ts";
import { useContract, useDash, useDashboardAnswers } from "./provider.tsx";
import { formatsOf, titleOf, type VisualState, visualState } from "./state.ts";

// Each card's cell comes in as CSS variables, so that on narrow screens the cards stack to one
// column, in layout order, each keeping its height. Inline styles cannot hold media queries.
/** The value a selection picked: a category, or a period's start. */
const selectedValue = (s: Selection | undefined) =>
  s === undefined ? undefined : "value" in s ? s.value : s.bucket;

const css = `
.dash-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 72px; gap: 16px; }
.dash-card { display: flex; flex-direction: column; min-width: 0; padding: 12px 16px;
  grid-column: calc(var(--dash-x) + 1) / span var(--dash-w); grid-row: calc(var(--dash-y) + 1) / span var(--dash-h);
  border: 1px solid var(--dash-grid, rgba(107, 111, 118, 0.25)); border-radius: 8px; }
.dash-card h3 { margin: 0 0 8px; font-size: 0.95rem; font-weight: 600; color: var(--dash-ink, #1c1f24); }
.dash-body { flex: 1; min-height: 0; }
.dash-note { margin: 0; color: var(--dash-muted, #6b6f76); }
.dash-filters { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 12px; }
.dash-chip { font: inherit; border: 1px solid var(--dash-accent, #e4572e); border-radius: 999px; padding: 2px 10px; background: none; color: inherit; cursor: pointer; }
.dash-row { all: unset; cursor: pointer; }
.dash-row[aria-pressed="true"] { color: var(--dash-accent, #e4572e); font-weight: 600; }
.dash-row:focus-visible, .dash-chip:focus-visible { outline: 2px solid var(--dash-accent, #e4572e); outline-offset: 2px; }
.dash-pick { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.dash-pick:focus { position: static; width: auto; height: auto; clip-path: none; margin-top: 4px; }
@media (max-width: 640px) { .dash-grid { grid-template-columns: 1fr; }
  .dash-card { grid-column: 1 / -1; grid-row: auto / span var(--dash-h); } }
`;

/**
 * Every visual's state for a spec: answers asked for together (ADR 0008), formats from the
 * contract and the dashboard. Shared by the viewer and the builder's previews.
 */
export function useVisualStates(
  spec: DashboardSpec,
  options: { refresh?: boolean; selections?: Selection[] } = {},
) {
  const { currency } = useDash();
  const contract = useContract();
  const { answerOf } = useDashboardAnswers(spec, options);
  const formats = useMemo(
    () => formatsOf(contract.data?.measures ?? [], spec.measures),
    [contract.data, spec.measures],
  );
  const stateOf = (id: string) => {
    const { answer, pending, failed } = answerOf(id);
    return visualState(answer, pending || contract.isPending, failed);
  };
  return { stateOf, formats, currency };
}

interface ContentProps {
  visual: DashboardVisual;
  state: VisualState;
  formats: ReadonlyMap<string, MeasureFormat>;
  currency: string;
  /** Cross-filtering: the value this visual selected, and how it selects one (viewer only). */
  selected?: unknown;
  onSelect?: ((value: unknown) => void) | undefined;
}

/** A visual's body in its state, with its failures kept inside (an error boundary). */
export function VisualContent(props: ContentProps) {
  return (
    <VisualBoundary>
      <VisualBody {...props} />
    </VisualBoundary>
  );
}

/**
 * A saved dashboard (DESIGN.md §7): one request for every visual (ADR 0008), each visual in its
 * layout cell with its loading, empty or error state.
 */
export function DashboardViewer({ spec }: { spec: DashboardSpec }) {
  // Cross-filtering (DESIGN.md §6): at most one selection per visual, each filtering the others.
  const [selections, setSelections] = useState<Selection[]>([]);
  // A saved dashboard is live: it refreshes on its interval (DESIGN.md §6).
  const { stateOf, formats, currency } = useVisualStates(spec, { refresh: true, selections });
  const select = (visualId: string, result: QueryResult) => (value: unknown) => {
    const axis = result.columns[0];
    if (axis?.kind !== "dimension" || value === null || value === undefined) return;
    const mine = selections.find((s) => s.visualId === visualId);
    const others = selections.filter((s) => s.visualId !== visualId);
    if (mine && selectedValue(mine) === value) return setSelections(others);
    const picked: Selection = axis.timeGrain
      ? { visualId, field: axis.field, bucket: String(value), grain: axis.timeGrain }
      : { visualId, field: axis.field, value: value as string | number | boolean };
    setSelections([...others, picked]);
  };
  const visuals = new Map(spec.visuals.map((v) => [v.id, v]));
  return (
    <section aria-label={spec.title}>
      <style>{css}</style>
      <h2>{spec.title}</h2>
      {selections.length > 0 && (
        <p className="dash-filters">
          {selections.map((s) => (
            <button
              key={s.visualId}
              type="button"
              className="dash-chip"
              aria-label={`Clear filter ${String(selectedValue(s))}`}
              onClick={() => setSelections(selections.filter((o) => o !== s))}
            >
              {String(selectedValue(s))} ×
            </button>
          ))}
        </p>
      )}
      <div className="dash-grid">
        {/* Reading order (and the phone's stacking order) follows the layout: by row, then column. */}
        {[...spec.layout]
          .sort((a, b) => a.y - b.y || a.x - b.x)
          .map((cell) => {
            const visual = visuals.get(cell.i);
            if (!visual) return null;
            const state = stateOf(visual.id);
            return (
              <article
                key={cell.i}
                className="dash-card"
                data-visual={visual.id}
                data-state={state.kind}
                aria-busy={state.kind === "loading"}
                style={
                  {
                    "--dash-x": cell.x,
                    "--dash-y": cell.y,
                    "--dash-w": cell.w,
                    "--dash-h": cell.h,
                  } as CSSProperties
                }
              >
                <h3>{titleOf(visual)}</h3>
                <div className="dash-body">
                  <VisualContent
                    visual={visual}
                    state={state}
                    formats={formats}
                    currency={currency}
                    selected={selectedValue(selections.find((s) => s.visualId === visual.id))}
                    onSelect={state.kind === "ready" ? select(visual.id, state.result) : undefined}
                  />
                </div>
              </article>
            );
          })}
      </div>
    </section>
  );
}

/** One visual's failure (a host plugin that throws, an invalid currency) stays in its card. */
class VisualBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override componentDidCatch(error: unknown) {
    console.error("dashboard visual failed", error);
  }

  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <p role="alert" className="dash-note">
        This visual could not be shown.
      </p>
    );
  }
}

function VisualBody({ visual, state, formats, currency, selected, onSelect }: ContentProps) {
  // Stable formatters, so a re-render with the same answer does not redraw charts.
  const result = state.kind === "ready" ? state.result : undefined;
  const formatters = useMemo(
    () => (result ? formattersFor(result.columns, formats, currency) : []),
    [result, formats, currency],
  );
  switch (state.kind) {
    case "loading":
      return <p className="dash-note">Loading…</p>;
    case "empty":
      return <p className="dash-note">No data for this selection.</p>;
    case "error":
      return (
        <div role="alert" className="dash-note">
          {state.messages.map((m) => (
            <p key={m} style={{ margin: 0 }}>
              {m}
            </p>
          ))}
        </div>
      );
    case "ready": {
      const plugin = getVisual(visual.type);
      if (!plugin) return null; // the request plan already reported it as an error
      const Render = plugin.render;
      return (
        <Render
          result={state.result}
          options={visual.options}
          formatters={formatters}
          {...(selected === undefined ? {} : { selected })}
          {...(onSelect ? { onSelect } : {})}
        />
      );
    }
  }
}
