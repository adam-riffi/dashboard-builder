import { dashboardRequest, GatewayError, type Transport } from "@adam-riffi/dash-react";
import { type Fixture, fixtureContract } from "../../fixtures";

/**
 * Recorded answers instead of the gateway (ADR 0008), matched by query, so a spec edited in the
 * builder still finds the answers of the visuals it kept; other queries get an error.
 */
export function fixtureTransport(fixture: Fixture): Transport {
  const plan = dashboardRequest(fixture.spec);
  const recorded = new Map(
    plan.visuals.flatMap((v) =>
      "query" in v && fixture.answers[v.id]
        ? [[JSON.stringify(plan.request.queries[v.query]), fixture.answers[v.id]] as const]
        : [],
    ),
  );
  return {
    contract: async () => fixtureContract,
    query: (request) =>
      fixture.pending
        ? new Promise(() => {})
        : fixture.failed
          ? Promise.reject(new GatewayError("query answered 401", 401))
          : Promise.resolve(
              request.queries.map(
                (q) => recorded.get(JSON.stringify(q)) ?? { errors: ["no recorded answer"] },
              ),
            ),
  };
}
