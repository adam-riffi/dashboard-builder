"use client";

import { DashProvider } from "@adam-riffi/dash-react";
import { DashboardBuilder } from "@adam-riffi/dash-react/builder";
import { useState } from "react";
import { type Fixture, fixtures } from "../../../fixtures";
import { fixtureTransport } from "../fixture-transport";

/** The builder on the overview fixture: what the M5 tests drag into and photograph. */
export function FixtureBuilder() {
  const overview = fixtures.overview as Fixture;
  const [spec, setSpec] = useState(overview.spec);
  return (
    <DashProvider transport={fixtureTransport(overview)}>
      <DashboardBuilder spec={spec} onChange={setSpec} onSave={setSpec} />
    </DashProvider>
  );
}
