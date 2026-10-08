"use client";

import {
  type DashboardSpec,
  type DataContract,
  MAX_QUERIES,
  type NamedMeasure,
  type QueryAnswer,
  type QueryRequest,
  type QuerySpec,
} from "@adam-riffi/dash-core";
import { QueryClient, QueryClientProvider, useQueries, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { dashboardRequest, measuresFor } from "./request.ts";

/** How the components reach the gateway; tests and fixtures supply their own (ADR 0008). */
export interface Transport {
  contract(): Promise<DataContract>;
  query(request: QueryRequest): Promise<QueryAnswer[]>;
}

/** A gateway answer other than 2xx; 4xx answers are not retried. */
export class GatewayError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** The gateway mounted at `gateway` (DESIGN.md §7), called with the host app's current token. */
export function gatewayTransport(
  gateway: string,
  getToken: () => string | Promise<string>,
): Transport {
  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${gateway}/${path}`, {
      ...init,
      headers: { ...init.headers, authorization: `Bearer ${await getToken()}` },
    });
    if (!res.ok) throw new GatewayError(`${path} answered ${res.status}`, res.status);
    return res.json();
  };
  return {
    contract: () => call("contract"),
    query: async (request) => {
      const body = await call("query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
      });
      return body.results;
    },
  };
}

interface Dash {
  transport: Transport;
  /** ISO 4217 code for `currency` measures. */
  currency: string;
  /** One query's answer, sent with the other queries asked for in the same tick. */
  ask: (query: QuerySpec, measures: NamedMeasure[]) => Promise<QueryAnswer>;
}

interface Batch {
  queries: QuerySpec[];
  measures: Map<string, NamedMeasure>;
  waiting: { resolve: (answer: QueryAnswer) => void; reject: (error: unknown) => void }[];
  sent: boolean;
}

/**
 * Queries asked for in the same tick go out as one request (ADR 0008): a dashboard still loads
 * in one, and an edit asks only for what it changed. Two dashboards whose measures disagree on
 * a name never share a request.
 */
function batched(transport: Transport): Dash["ask"] {
  let open: Batch | undefined;
  const send = (batch: Batch) => {
    if (batch.sent) return;
    batch.sent = true;
    if (open === batch) open = undefined;
    transport.query({ measures: [...batch.measures.values()], queries: batch.queries }).then(
      (answers) => {
        batch.waiting.forEach((w, i) => {
          w.resolve(answers[i] ?? { errors: ["No answer for this visual"] });
        });
      },
      (error) => {
        for (const w of batch.waiting) w.reject(error);
      },
    );
  };
  const clashes = (batch: Batch, measures: NamedMeasure[]) =>
    batch.queries.length >= MAX_QUERIES ||
    measures.some((m) => {
      const had = batch.measures.get(m.name);
      return had !== undefined && JSON.stringify(had) !== JSON.stringify(m);
    });
  return (query, measures) =>
    new Promise((resolve, reject) => {
      if (open && clashes(open, measures)) send(open);
      let batch = open;
      if (!batch) {
        const fresh: Batch = { queries: [], measures: new Map(), waiting: [], sent: false };
        setTimeout(() => send(fresh), 0);
        batch = fresh;
        open = fresh;
      }
      for (const m of measures) batch.measures.set(m.name, m);
      batch.queries.push(query);
      batch.waiting.push({ resolve, reject });
    });
}

const DashContext = createContext<Dash | null>(null);

/**
 * Gives dashboards their data (DESIGN.md §7): a gateway URL and token, or a `transport`.
 * Holds the query cache.
 */
const noToken = () => "";

/** Retries once, except answers the gateway gave on purpose (401, 403, 429…). */
const retry = (failures: number, error: unknown) =>
  failures < 1 && !(error instanceof GatewayError && error.status < 500);

export function DashProvider({
  gateway = "/api/dash",
  getToken = noToken,
  transport,
  currency = "USD",
  children,
}: {
  gateway?: string;
  getToken?: () => string | Promise<string>;
  transport?: Transport;
  currency?: string;
  children: ReactNode;
}) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry, refetchOnWindowFocus: false } } }),
  );
  // Requests always ask the latest getToken, so a host passing a new one (a refreshed token) is
  // heard without rebuilding the transport.
  const token = useRef(getToken);
  useEffect(() => {
    token.current = getToken;
  }, [getToken]);
  const dash = useMemo<Dash>(() => {
    const t = transport ?? gatewayTransport(gateway, () => token.current());
    return { transport: t, currency, ask: batched(t) };
  }, [transport, gateway, currency]);
  return (
    <QueryClientProvider client={client}>
      <DashContext.Provider value={dash}>{children}</DashContext.Provider>
    </QueryClientProvider>
  );
}

export function useDash(): Dash {
  const dash = useContext(DashContext);
  if (!dash) throw new Error("dashboards need a <DashProvider> around them");
  return dash;
}

/** The data contract the user may build on (`GET /contract`). */
export function useContract() {
  const { transport } = useDash();
  return useQuery({
    queryKey: ["dash", "contract"],
    queryFn: () => transport.contract(),
    staleTime: 60_000,
  });
}

/**
 * Every visual's answer, each cached under its own query and the measures that query reaches,
 * so an edit asks again only for the visuals it changed. Asked together, they share one request
 * (ADR 0008).
 */
export function useDashboardAnswers(spec: DashboardSpec) {
  const { ask } = useDash();
  const plan = useMemo(() => dashboardRequest(spec), [spec]);
  const asked = plan.visuals.flatMap((v) =>
    "query" in v ? [{ id: v.id, query: plan.request.queries[v.query] as QuerySpec }] : [],
  );
  const results = useQueries({
    queries: asked.map(({ id, query }) => {
      const measures = measuresFor(query, spec.measures);
      return {
        queryKey: ["dash", "query", id, query, measures],
        queryFn: () => ask(query, measures),
      };
    }),
  });
  const byId = new Map(asked.map((a, i) => [a.id, results[i]]));
  // Each visual's latest answer, kept on screen while its next one is on the way. (A changed
  // query gets a new observer, so react-query's placeholder data has nothing to keep.)
  const latest = useRef(new Map<string, QueryAnswer>());
  for (const [id, result] of byId) if (result?.data) latest.current.set(id, result.data);
  /** One visual's answer so far, and whether it is still on its way or failed. */
  const answerOf = (id: string): { answer?: QueryAnswer; pending: boolean; failed: boolean } => {
    const planned = plan.visuals.find((v) => v.id === id);
    if (planned && "errors" in planned) {
      return { answer: { errors: planned.errors }, pending: false, failed: false };
    }
    const result = byId.get(id);
    const answer = result?.data ?? latest.current.get(id);
    return {
      ...(answer ? { answer } : {}),
      pending: result?.isPending ?? true,
      failed: result?.isError ?? false,
    };
  };
  return { plan, answerOf };
}
