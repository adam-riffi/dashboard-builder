"use client";

import type { DashboardSpec, DataContract, QueryAnswer, QueryRequest } from "@adam-riffi/dash-core";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { answersByVisual, dashboardRequest } from "./request.ts";

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
  const dash = useMemo<Dash>(
    () => ({ transport: transport ?? gatewayTransport(gateway, () => token.current()), currency }),
    [transport, gateway, currency],
  );
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

/** Every visual's answer, from one request for the whole dashboard. */
export function useDashboardAnswers(spec: DashboardSpec) {
  const { transport } = useDash();
  const plan = useMemo(() => dashboardRequest(spec), [spec]);
  const query = useQuery({
    queryKey: ["dash", "query", plan.request],
    queryFn: () =>
      plan.request.queries.length > 0 ? transport.query(plan.request) : Promise.resolve([]),
  });
  const answers = useMemo(
    () => (query.data ? answersByVisual(plan, query.data) : undefined),
    [plan, query.data],
  );
  return { plan, answers, isPending: query.isPending, error: query.error };
}
