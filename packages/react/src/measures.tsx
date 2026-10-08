"use client";

import {
  type DashboardSpec,
  type DataContract,
  MAX_FORMULA_LENGTH,
  MAX_NAMED_MEASURES,
  type MeasureFormat,
  measureName,
  type NamedMeasure,
} from "@adam-riffi/dash-core";
import { autocompletion } from "@codemirror/autocomplete";
import { linter } from "@codemirror/lint";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { useEffect, useMemo, useRef, useState } from "react";
import { removeMeasure, upsertMeasure } from "./builder.ts";
import { completionsAt, diagnosticsOf } from "./formula.ts";

interface Sources {
  contract: DataContract;
  measures: NamedMeasure[];
}

/**
 * A CodeMirror 6 formula input (DESIGN.md §6): completions for functions, `table.column` and
 * `[Measure]`, and the checker's errors underlined at their spans. It is uncontrolled after
 * mount; key it to start over with another formula.
 */
function FormulaInput({
  initial,
  sources,
  onChange,
}: {
  initial: string;
  sources: Sources;
  onChange: (formula: string) => void;
}) {
  const parent = useRef<HTMLDivElement>(null);
  const latest = useRef({ sources, onChange });
  useEffect(() => {
    latest.current = { sources, onChange };
  });
  // biome-ignore lint/correctness/useExhaustiveDependencies: the editor is created once per mount; later values arrive through `latest`.
  useEffect(() => {
    if (!parent.current) return;
    const view = new EditorView({
      parent: parent.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Formula" }),
          autocompletion({
            override: [
              (ctx) => {
                const { contract, measures } = latest.current.sources;
                return completionsAt(ctx.state.doc.toString(), ctx.pos, contract, measures);
              },
            ],
          }),
          linter(
            (v) => {
              const { contract, measures } = latest.current.sources;
              return diagnosticsOf(v.state.doc.toString(), contract, measures);
            },
            { delay: 200 },
          ),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) latest.current.onChange(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.destroy();
  }, []);
  return <div ref={parent} className="dash-formula" />;
}

interface Draft {
  previous: string | undefined;
  name: string;
  formula: string;
  format: MeasureFormat | "";
}

function MeasureForm({
  draft,
  spec,
  contract,
  onApply,
  onCancel,
}: {
  draft: Draft;
  spec: DashboardSpec;
  contract: DataContract;
  onApply: (measure: NamedMeasure, previous: string | undefined) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(draft.name);
  const [formula, setFormula] = useState(draft.formula);
  const [format, setFormat] = useState(draft.format);
  // The measure may refer to the dashboard's other measures, but not to itself under its old name.
  const others = spec.measures.filter((m) => m.name !== draft.previous);
  const errors = useMemo(
    () => (formula.trim() ? diagnosticsOf(formula, contract, others) : []),
    [formula, contract, others],
  );
  // A host measure's name would shadow it everywhere (ADR 0007); a saved measure that already
  // does may keep its name.
  const nameProblem = !measureName.safeParse(name).success
    ? "Names have no [ ] and no spaces around them."
    : name !== draft.previous && contract.measures.some((m) => m.name === name)
      ? "The host has a measure with this name."
      : others.some((m) => m.name === name)
        ? "Another measure has this name."
        : undefined;
  const tooLong = formula.length > MAX_FORMULA_LENGTH;
  const ready = !nameProblem && formula.trim() !== "" && !tooLong && errors.length === 0;
  return (
    <fieldset className="dash-group">
      <legend>{draft.previous ? `Edit ${draft.previous}` : "New measure"}</legend>
      <input
        aria-label="Measure name"
        maxLength={100}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      {name && nameProblem && <p className="dash-note">{nameProblem}</p>}
      <select
        aria-label="Format"
        value={format}
        onChange={(e) => setFormat(e.target.value as MeasureFormat | "")}
      >
        <option value="">plain</option>
        <option value="number">number</option>
        <option value="currency">currency</option>
        <option value="percent">percent</option>
      </select>
      <FormulaInput
        initial={draft.formula}
        sources={{ contract, measures: others }}
        onChange={setFormula}
      />
      {tooLong && (
        <p className="dash-note">{`Formulas have at most ${MAX_FORMULA_LENGTH} characters.`}</p>
      )}
      {errors.length > 0 && (
        <ul role="alert" className="dash-note">
          {errors.map((e) => (
            <li key={`${e.from}-${e.message}`}>{e.message}</li>
          ))}
        </ul>
      )}
      <button
        type="button"
        disabled={!ready}
        onClick={() => onApply({ name, formula, ...(format ? { format } : {}) }, draft.previous)}
      >
        Apply
      </button>
      <button type="button" onClick={onCancel}>
        Cancel
      </button>
    </fieldset>
  );
}

/**
 * The dashboard's own measures (DESIGN.md §7, ADR 0007): listed with Edit and Remove, and
 * written in the formula editor. Renaming one rewrites the visuals and formulas that use it.
 */
export function MeasureEditor({
  spec,
  contract,
  onChange,
}: {
  spec: DashboardSpec;
  contract: DataContract;
  onChange: (spec: DashboardSpec) => void;
}) {
  const [draft, setDraft] = useState<Draft>();
  return (
    <section aria-label="Dashboard measures" className="dash-measures">
      <h4>Measures</h4>
      <ul style={{ padding: 0, margin: 0 }}>
        {spec.measures.map((m) => (
          <li key={m.name} style={{ listStyle: "none" }}>
            {m.name}{" "}
            <button
              type="button"
              aria-label={`Edit ${m.name}`}
              onClick={() =>
                setDraft({
                  previous: m.name,
                  name: m.name,
                  formula: m.formula,
                  format: m.format ?? "",
                })
              }
            >
              ✎
            </button>
            <button
              type="button"
              aria-label={`Remove ${m.name}`}
              onClick={() => onChange(removeMeasure(spec, m.name))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      {draft ? (
        <MeasureForm
          key={draft.previous ?? "new"}
          draft={draft}
          spec={spec}
          contract={contract}
          onApply={(measure, previous) => {
            onChange(upsertMeasure(spec, measure, previous));
            setDraft(undefined);
          }}
          onCancel={() => setDraft(undefined)}
        />
      ) : (
        <button
          type="button"
          disabled={spec.measures.length >= MAX_NAMED_MEASURES}
          onClick={() => setDraft({ previous: undefined, name: "", formula: "", format: "" })}
        >
          New measure
        </button>
      )}
    </section>
  );
}
