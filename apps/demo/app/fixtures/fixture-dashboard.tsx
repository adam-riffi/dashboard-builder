"use client";

import {
  DashboardViewer,
  DashProvider,
  dashboardRequest,
  type Transport,
} from "@adam-riffi/dash-react";
import { fixtureContract, fixtures } from "../../fixtures";

/** A fixture spec rendered with its recorded answers instead of the gateway (ADR 0008). */
export function FixtureDashboard({ name }: { name: string }) {
  const fixture = fixtures[name];
  if (!fixture) return null;
  const transport: Transport = {
    contract: async () => fixtureContract,
    query: (request) =>
      fixture.pending
        ? new Promise(() => {})
        : Promise.resolve(
            // The answers in request order, as the gateway would return them.
            dashboardRequest(fixture.spec)
              .visuals.filter((v) => "query" in v)
              .map((v) => fixture.answers[v.id] ?? { errors: ["no recorded answer"] })
              .slice(0, request.queries.length),
          ),
  };
  return (
    <DashProvider transport={transport}>
      <DashboardViewer spec={fixture.spec} />
    </DashProvider>
  );
}
