"use client";

import { DashboardViewer, DashProvider } from "@adam-riffi/dash-react";
import { kpi, registerVisual } from "@adam-riffi/dash-visuals";
import { fixtures } from "../../fixtures";
import { fixtureTransport } from "./fixture-transport";

// A host plugin with a bug, so the states fixture shows that one visual's failure stays in its card.
registerVisual({
  ...kpi,
  type: "throws",
  label: "Throws",
  render: () => {
    throw new Error("a renderer bug");
  },
});

/** A fixture spec rendered with its recorded answers instead of the gateway (ADR 0008). */
export function FixtureDashboard({ name }: { name: string }) {
  const fixture = fixtures[name];
  if (!fixture) return null;
  return (
    <DashProvider transport={fixtureTransport(fixture)}>
      <DashboardViewer spec={fixture.spec} />
    </DashProvider>
  );
}
