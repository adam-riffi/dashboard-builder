import { dashboardRequest, GatewayError, type Transport } from "@adam-riffi/dash-react";
import { type Fixture, fixtureContract } from "../../fixtures";

/** A spec's recorded answers by the JSON of each visual's query. */
function record({ spec, answers }: Pick<Fixture, "spec" | "answers">) {
  const plan = dashboardRequest(spec);
  return plan.visuals.flatMap((v) =>
    "query" in v && answers[v.id]
      ? [[JSON.stringify(plan.request.queries[v.query]), answers[v.id]] as const]
      : [],
  );
}

/**
 * Recorded answers instead of the gateway (ADR 0008), matched by query, so a spec edited in the
 * builder still finds the answers of the visuals it kept, or repaired; other queries get an error.
 */
export function fixtureTransport(fixture: Fixture): Transport {
  const recorded = new Map([
    ...record(fixture),
    ...(fixture.repaired ? record(fixture.repaired) : []),
  ]);
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
