"use client";

import type { DashboardSpec } from "@adam-riffi/dash-core";
import { DashboardViewer } from "@adam-riffi/dash-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { DashboardSummary } from "../lib/dashboards";
import { sampleDashboard } from "../lib/sample-dashboard";

type Open = { id: string; spec: DashboardSpec; mode: "view" | "edit" };

// Loaded when someone edits: visitors who only view never download the builder's editors.
const DashboardBuilder = dynamic(
  () => import("@adam-riffi/dash-react/builder").then((m) => m.DashboardBuilder),
  { ssr: false, loading: () => <p>Loading the builder…</p> },
);

/**
 * The visitor's dashboards (M5): a list from `/api/dashboards`, a new one started from the sample,
 * the viewer for an open dashboard, and the builder to edit it. The host stores dashboards; the
 * builder only hands specs to `onSave` (DESIGN.md §7).
 */
export function Dashboards({ getToken }: { getToken: () => Promise<string> }) {
  const [list, setList] = useState<DashboardSummary[]>();
  const [open, setOpen] = useState<Open>();
  const [problem, setProblem] = useState<string>();

  const api = useCallback(
    async (path: string, init: RequestInit = {}) => {
      const res = await fetch(`/api/dashboards${path}`, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${await getToken()}` },
      });
      if (!res.ok && res.status !== 404) throw new Error(`dashboards answered ${res.status}`);
      return res;
    },
    [getToken],
  );

  const refresh = useCallback(async () => {
    const res = await api("");
    setList(((await res.json()) as { dashboards: DashboardSummary[] }).dashboards);
  }, [api]);

  useEffect(() => {
    refresh().catch(() => setProblem("Your dashboards are unavailable right now."));
  }, [refresh]);

  const save = async (id: string, spec: DashboardSpec) => {
    try {
      await api(`/${id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(spec),
      });
      setOpen({ id, spec, mode: "view" });
      setProblem(undefined);
      await refresh();
    } catch {
      setProblem("The dashboard could not be saved. Try again shortly.");
    }
  };

  const openOne = async (id: string) => {
    const res = await api(`/${id}`);
    if (res.ok)
      setOpen({ id, spec: ((await res.json()) as { spec: DashboardSpec }).spec, mode: "view" });
  };

  const remove = async (id: string) => {
    await api(`/${id}`, { method: "DELETE" });
    setOpen(undefined);
    await refresh();
  };

  return (
    <>
      <section aria-label="Your dashboards">
        <h2>Your dashboards</h2>
        {problem && <p role="alert">{problem}</p>}
        <ul style={{ display: "flex", flexWrap: "wrap", gap: 8, padding: 0, listStyle: "none" }}>
          {(list ?? []).map((d) => (
            <li key={d.id}>
              <button
                type="button"
                aria-label={`Open ${d.title}`}
                onClick={() => void openOne(d.id)}
              >
                {d.title}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              onClick={() =>
                setOpen({ id: crypto.randomUUID(), spec: sampleDashboard, mode: "edit" })
              }
            >
              New dashboard
            </button>
          </li>
        </ul>
      </section>

      {open?.mode === "edit" ? (
        <DashboardBuilder
          key={open.id}
          spec={open.spec}
          onChange={(spec) => setOpen({ ...open, spec })}
          onSave={(spec) => void save(open.id, spec)}
        />
      ) : open ? (
        <>
          <p>
            <button type="button" onClick={() => setOpen({ ...open, mode: "edit" })}>
              Edit dashboard
            </button>{" "}
            <button type="button" onClick={() => void remove(open.id)}>
              Delete dashboard
            </button>{" "}
            <button type="button" onClick={() => setOpen(undefined)}>
              Close
            </button>
          </p>
          <DashboardViewer spec={open.spec} />
        </>
      ) : (
        <DashboardViewer spec={sampleDashboard} />
      )}
    </>
  );
}
