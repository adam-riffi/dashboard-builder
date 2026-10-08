"use client";

import { DashboardViewer, DashProvider } from "@adam-riffi/dash-react";
import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { sampleDashboard } from "../lib/sample-dashboard";

type State =
  | { kind: "loading" }
  | { kind: "signed-in"; userId: string; token: string; getToken: () => Promise<string> }
  | { kind: "error" };

/** Signs the visitor in anonymously (DESIGN.md §3); the session persists in the browser. */
export function Session() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return setState({ kind: "error" });
    const auth = createClient(url, key).auth;
    // The client refreshes tokens, so each request asks for the current one.
    const getToken = async () => (await auth.getSession()).data.session?.access_token ?? "";
    (async () => {
      const { data } = await auth.getSession();
      const session = data.session ?? (await auth.signInAnonymously()).data.session;
      setState(
        session
          ? { kind: "signed-in", userId: session.user.id, token: session.access_token, getToken }
          : { kind: "error" },
      );
    })().catch(() => setState({ kind: "error" }));
  }, []);

  if (state.kind === "loading") return <p className="muted">Signing you in…</p>;
  if (state.kind === "error") return <p role="alert">Sign-in is unavailable right now.</p>;
  return (
    <>
      <p>
        Signed in as guest <code>{state.userId.slice(0, 8)}</code>
      </p>
      <ContractSummary token={state.token} />
      <DashProvider getToken={state.getToken}>
        <DashboardViewer spec={sampleDashboard} />
      </DashProvider>
    </>
  );
}

/** Reads the data contract with the visitor's token (`GET /api/dash/contract`). */
function ContractSummary({ token }: { token: string }) {
  const [text, setText] = useState("Reading your data…");

  useEffect(() => {
    fetch("/api/dash/contract", { headers: { authorization: `Bearer ${token}` } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`contract: ${res.status}`);
        const contract: { tables: unknown[] } = await res.json();
        setText(`${contract.tables.length} tables available`);
      })
      .catch(() => setText("Your data is unavailable right now."));
  }, [token]);

  return <p className="muted">{text}</p>;
}
