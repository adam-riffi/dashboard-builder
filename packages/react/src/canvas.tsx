"use client";

import { type DashboardSpec, dashboardSpec } from "@adam-riffi/dash-core";
import { visuals as registered } from "@adam-riffi/dash-visuals";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useState } from "react";
import ReactGridLayout, { type Layout, useContainerWidth } from "react-grid-layout";
import {
  addVisual,
  type Draggable,
  removeVisual,
  setLayout,
  setVisualOptions,
  setVisualTitle,
} from "./builder.ts";
import { FieldList } from "./fields.tsx";
import { FiltersEditor } from "./filters.tsx";
import { MeasureEditor } from "./measures.tsx";
import { useContract } from "./provider.tsx";
import { titleOf } from "./state.ts";
import { useVisualStates, VisualContent } from "./viewer.tsx";
import { dropFromEvent, SlotWells } from "./wells.tsx";

// The builder's panels; the grid's own rules come from `react-grid-layout/css/styles.css`, which
// the host imports (ADR 0008 keeps the viewer's rules inline for the same reason as here).
const css = `
.dash-builder { display: grid; grid-template-columns: 220px minmax(0, 1fr) 280px; gap: 16px; align-items: start; }
.dash-toolbar { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.dash-toolbar input { font: inherit; min-width: 16rem; }
.dash-fields, .dash-props { display: flex; flex-direction: column; gap: 12px; }
/* The wells stay in view while a field is dragged from far down the list. */
.dash-props { position: sticky; top: 0; }
.dash-group, .dash-well { border: 1px solid var(--dash-grid, rgba(107, 111, 118, 0.25)); border-radius: 8px; padding: 8px; margin: 0; }
.dash-field { display: flex; gap: 6px; width: 100%; text-align: left; background: none; border: 0; padding: 2px 4px; color: inherit; font: inherit; cursor: grab; }
.dash-field[aria-pressed="true"] { outline: 2px solid var(--dash-accent, #e4572e); }
.dash-badge { color: var(--dash-muted, #6b6f76); min-width: 1.5em; }
.dash-well[data-state="accepts"] { border-style: dashed; border-color: var(--dash-accent, #e4572e); }
.dash-well[data-state="refuses"] { opacity: 0.5; }
.dash-well[data-over] { background: color-mix(in srgb, var(--dash-accent, #e4572e) 10%, transparent); }
.dash-tile { display: flex; flex-direction: column; height: 100%; padding: 8px 12px; box-sizing: border-box;
  border: 1px solid var(--dash-grid, rgba(107, 111, 118, 0.25)); border-radius: 8px; background: inherit; }
.dash-tile[aria-current="true"] { border-color: var(--dash-accent, #e4572e); }
.dash-tile header { display: flex; justify-content: space-between; align-items: start; gap: 8px; cursor: move; }
.dash-tile h3 { margin: 0 0 4px; font-size: 0.95rem; }
.dash-select { all: unset; cursor: pointer; }
.dash-select:focus-visible { outline: 2px solid var(--dash-accent, #e4572e); outline-offset: 2px; }
.dash-tile .dash-body { flex: 1; min-height: 0; }
@media (max-width: 900px) { .dash-builder { grid-template-columns: 1fr; } }
`;

/**
 * The dashboard's title: a draft while typing, so it can be cleared and retyped, and a blank
 * title is never sent; otherwise the host's title, so it follows the dashboard the host opens.
 */
function TitleInput({ title, onChange }: { title: string; onChange: (title: string) => void }) {
  const [draft, setDraft] = useState<string>();
  return (
    <input
      aria-label="Dashboard title"
      maxLength={200}
      value={draft ?? title}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value.trim()) onChange(e.target.value);
      }}
      onBlur={() => setDraft(undefined)}
    />
  );
}

/** Options the built-in visuals expose in the properties panel. */
function VisualOptions({
  type,
  options,
  onChange,
}: {
  type: string;
  options: Record<string, unknown>;
  onChange: (options: Record<string, unknown>) => void;
}) {
  const set = (key: string, value: unknown) => onChange({ ...options, [key]: value });
  const select = (key: string, label: string, choices: string[]) => (
    <label>
      {label}{" "}
      <select
        aria-label={label}
        value={String(options[key] ?? choices[0])}
        onChange={(e) => set(key, e.target.value)}
      >
        {choices.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
    </label>
  );
  const limit = (max: number) => (
    <label>
      Rows{" "}
      <input
        aria-label="Rows"
        type="number"
        min={1}
        max={max}
        step={1}
        value={String(options.limit ?? "")}
        onChange={(e) => {
          // Whole rows; an empty field means the visual's default.
          const { limit: _limit, ...rest } = options;
          const rows = Math.trunc(Number(e.target.value));
          onChange(
            e.target.value === "" ? rest : { ...options, limit: Math.min(max, Math.max(1, rows)) },
          );
        }}
      />
    </label>
  );
  // ponytail: built-in options only; host plugins could describe their own options later.
  if (type === "bar")
    return (
      <>
        {select("sort", "Sort", ["desc", "asc", "category"])}
        {limit(100)}
      </>
    );
  if (type === "line") return select("grain", "Grain", ["day", "week", "month", "quarter", "year"]);
  if (type === "table") return limit(1_000);
  return null;
}

/**
 * The dashboard builder (DESIGN.md §7): fields on the left, the 12-column canvas with live
 * previews in the middle, the selected visual's wells and options on the right. It is
 * controlled: every change goes to `onChange`, and Save hands the spec to the host (`onSave`),
 * which stores it.
 */
export function DashboardBuilder({
  spec,
  onChange,
  onSave,
}: {
  spec: DashboardSpec;
  onChange: (spec: DashboardSpec) => void;
  onSave: (spec: DashboardSpec) => void;
}) {
  const contract = useContract();
  const { stateOf, formats, currency } = useVisualStates(spec);
  const [selected, setSelected] = useState<string>();
  const [picked, setPicked] = useState<Draggable>();
  const [issues, setIssues] = useState<string[]>();
  const { width, containerRef, mounted } = useContainerWidth();
  // A pointer must move before a drag starts, so clicks still pick fields.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const current = spec.visuals.find((v) => v.id === selected);

  // The host gets a spec it can store: stamped with the contract it was built on, and valid.
  const save = () => {
    const version = contract.data?.contractVersion ?? spec.contractVersion;
    const checked = dashboardSpec.safeParse({ ...spec, contractVersion: version });
    if (!checked.success) {
      setIssues(
        checked.error.issues.map((i) => `${i.path.join(".") || "dashboard"}: ${i.message}`),
      );
      return;
    }
    setIssues(undefined);
    onSave(checked.data);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={(e) => onChange(dropFromEvent(spec, e))}>
      <style>{css}</style>
      <div className="dash-builder">
        <div className="dash-toolbar">
          <TitleInput title={spec.title} onChange={(title) => onChange({ ...spec, title })} />
          {registered().map((plugin) => (
            <button
              key={plugin.type}
              type="button"
              onClick={() => {
                const added = addVisual(spec, plugin.type);
                onChange(added.spec);
                setSelected(added.id);
              }}
            >
              Add {plugin.label}
            </button>
          ))}
          <button type="button" onClick={save}>
            Save
          </button>
          {issues && (
            <ul role="alert" className="dash-note">
              {issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}
        </div>

        {contract.data ? (
          <div className="dash-fields">
            <FieldList
              contract={contract.data}
              measures={spec.measures}
              picked={picked}
              onPick={(d) =>
                setPicked((p) => (p && JSON.stringify(p) === JSON.stringify(d) ? undefined : d))
              }
            />
            <MeasureEditor spec={spec} contract={contract.data} onChange={onChange} />
          </div>
        ) : (
          <p className="dash-note">Loading fields…</p>
        )}

        <div ref={containerRef}>
          {mounted && (
            <ReactGridLayout
              layout={spec.layout}
              width={width}
              gridConfig={{ cols: 12, rowHeight: 72, margin: [16, 16] }}
              dragConfig={{ handle: ".dash-tile header" }}
              onLayoutChange={(layout: Layout) => onChange(setLayout(spec, [...layout]))}
            >
              {spec.visuals.map((visual) => {
                const state = stateOf(visual.id);
                const title = titleOf(visual);
                return (
                  <div key={visual.id}>
                    <article
                      className="dash-tile"
                      data-visual={visual.id}
                      data-state={state.kind}
                      aria-current={visual.id === selected ? "true" : undefined}
                      onPointerDown={() => setSelected(visual.id)}
                    >
                      <header>
                        <h3>
                          <button
                            type="button"
                            className="dash-select"
                            aria-label={`Select ${title}`}
                            aria-pressed={visual.id === selected}
                            onClick={() => setSelected(visual.id)}
                          >
                            {title}
                          </button>
                        </h3>
                        <button
                          type="button"
                          aria-label={`Remove ${title}`}
                          onClick={() => {
                            onChange(removeVisual(spec, visual.id));
                            if (visual.id === selected) setSelected(undefined);
                          }}
                        >
                          ×
                        </button>
                      </header>
                      <div className="dash-body">
                        <VisualContent
                          visual={visual}
                          state={state}
                          formats={formats}
                          currency={currency}
                        />
                      </div>
                    </article>
                  </div>
                );
              })}
            </ReactGridLayout>
          )}
        </div>

        <aside className="dash-props" aria-label="Visual properties">
          {current ? (
            <>
              <label>
                Title{" "}
                <input
                  aria-label="Visual title"
                  maxLength={120}
                  value={current.title ?? ""}
                  placeholder={titleOf(current)}
                  onChange={(e) => onChange(setVisualTitle(spec, current.id, e.target.value))}
                />
              </label>
              <SlotWells spec={spec} visualId={current.id} picked={picked} onChange={onChange} />
              <VisualOptions
                type={current.type}
                options={current.options}
                onChange={(o) => onChange(setVisualOptions(spec, current.id, o))}
              />
            </>
          ) : (
            <p className="dash-note">Add a visual, or select one on the canvas.</p>
          )}
          {contract.data && (
            <FiltersEditor spec={spec} contract={contract.data} onChange={onChange} />
          )}
        </aside>
      </div>
    </DndContext>
  );
}
