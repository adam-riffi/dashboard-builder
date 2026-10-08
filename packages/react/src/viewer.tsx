"use client";

import type { DashboardSpec, DashboardVisual, MeasureFormat } from "@adam-riffi/dash-core";
import { formattersFor, getVisual } from "@adam-riffi/dash-visuals";
import { useMemo } from "react";
import { useContract, useDash, useDashboardAnswers } from "./provider.tsx";
import { titleOf, type VisualState, visualState } from "./state.ts";

// The grid stacks to one column on narrow screens; inline styles cannot hold media queries.
const css = `
.dash-grid { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); grid-auto-rows: 72px; gap: 16px; }
.dash-card { display: flex; flex-direction: column; min-width: 0; padding: 12px 16px;
  border: 1px solid var(--dash-grid, rgba(107, 111, 118, 0.25)); border-radius: 8px; }
.dash-card h3 { margin: 0 0 8px; font-size: 0.95rem; font-weight: 600; color: var(--dash-ink, #1c1f24); }
.dash-body { flex: 1; min-height: 0; }
.dash-note { margin: 0; color: var(--dash-muted, #6b6f76); }
@media (max-width: 640px) { .dash-grid { grid-template-columns: 1fr; } .dash-card { grid-column: 1 / -1 !important; } }
`;

/**
 * A saved dashboard (DESIGN.md §7): one request for every visual (ADR 0008), each visual in its
 * layout cell with its loading, empty or error state.
 */
export function DashboardViewer({ spec }: { spec: DashboardSpec }) {
  const { currency } = useDash();
  const contract = useContract();
  const { answers, isPending, error } = useDashboardAnswers(spec);

  // Host measure formats from the contract, overridden by the dashboard's own measures.
  const formats = useMemo(() => {
    const all = [...(contract.data?.measures ?? []), ...spec.measures];
    return new Map(
      all.flatMap((m): [string, MeasureFormat][] => (m.format ? [[m.name, m.format]] : [])),
    );
  }, [contract.data, spec.measures]);

  const visuals = new Map(spec.visuals.map((v) => [v.id, v]));
  const pending = isPending || contract.isPending;
  return (
    <section aria-label={spec.title}>
      <style>{css}</style>
      <h2>{spec.title}</h2>
      <div className="dash-grid">
        {spec.layout.map((cell) => {
          const visual = visuals.get(cell.i);
          if (!visual) return null;
          const state = visualState(answers?.get(visual.id), pending, error !== null);
          return (
            <article
              key={cell.i}
              className="dash-card"
              data-visual={visual.id}
              data-state={state.kind}
              aria-busy={state.kind === "loading"}
              style={{
                gridColumn: `${cell.x + 1} / span ${cell.w}`,
                gridRow: `${cell.y + 1} / span ${cell.h}`,
              }}
            >
              <h3>{titleOf(visual, state.kind === "ready" ? state.result : undefined)}</h3>
              <div className="dash-body">
                <VisualBody visual={visual} state={state} formats={formats} currency={currency} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function VisualBody({
  visual,
  state,
  formats,
  currency,
}: {
  visual: DashboardVisual;
  state: VisualState;
  formats: ReadonlyMap<string, MeasureFormat>;
  currency: string;
}) {
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
          formatters={formattersFor(state.result.columns, formats, currency)}
        />
      );
    }
  }
}
