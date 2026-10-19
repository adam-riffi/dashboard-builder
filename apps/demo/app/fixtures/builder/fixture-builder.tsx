"use client";

import { DashProvider } from "@adam-riffi/dash-react";
import { DashboardBuilder } from "@adam-riffi/dash-react/builder";
import { useState } from "react";
import { type Fixture, fixtures } from "../../../fixtures";
import { fixtureTransport } from "../fixture-transport";

/**
 * The builder on a fixture: the overview, which the M5 tests drag into and photograph, or
 * another by name, such as `lost` for repairing lost fields (ADR 0011).
 */
export function FixtureBuilder({ name = "overview" }: { name?: string }) {
  const fixture = fixtures[name] as Fixture;
  const [spec, setSpec] = useState(fixture.spec);
  const [transport] = useState(() => fixtureTransport(fixture));
  return (
    <DashProvider transport={transport}>
      <DashboardBuilder spec={spec} onChange={setSpec} onSave={setSpec} />
    </DashProvider>
  );
}
