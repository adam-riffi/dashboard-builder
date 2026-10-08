"use client";

import {
  DashboardViewer,
  DashProvider,
  dashboardRequest,
  GatewayError,
  type Transport,
} from "@adam-riffi/dash-react";
import { kpi, registerVisual } from "@adam-riffi/dash-visuals";
import { fixtureContract, fixtures } from "../../fixtures";

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
  const transport: Transport = {
    contract: async () => fixtureContract,
    query: (request) =>
      fixture.pending
        ? new Promise(() => {})
        : fixture.failed
          ? Promise.reject(new GatewayError("query answered 401", 401))
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
