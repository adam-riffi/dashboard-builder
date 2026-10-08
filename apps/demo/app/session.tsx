"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

type State =
  | { kind: "loading" }
  | { kind: "signed-in"; userId: string; token: string }
  | { kind: "error" };

/** Signs the visitor in anonymously (DESIGN.md §3); the session persists in the browser. */
export function Session() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return setState({ kind: "error" });
    const auth = createClient(url, key).auth;
    (async () => {
      const { data } = await auth.getSession();
      const session = data.session ?? (await auth.signInAnonymously()).data.session;
      setState(
        session
          ? { kind: "signed-in", userId: session.user.id, token: session.access_token }
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
      <RevenueByCategory token={state.token} />
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

const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

/** A host measure by name through `POST /api/dash/query`, scoped to the visitor's tenants. */
function RevenueByCategory({ token }: { token: string }) {
  const [rows, setRows] = useState<[string, number][] | "error" | undefined>();

  useEffect(() => {
    const queries = [
      {
        dimensions: [{ field: "dash_demo.products.category" }],
        measures: [{ name: "Revenue" }],
      },
    ];
    fetch("/api/dash/query", {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ queries }),
    })
      .then(async (res) => {
        const { results } = await res.json();
        const [first] = results ?? [];
        if (!res.ok || !first?.data) throw new Error(`query: ${res.status}`);
        const [categories, revenue] = first.data as [string[], number[]];
        setRows(categories.map((c, i) => [c, revenue[i] ?? 0]));
      })
      .catch(() => setRows("error"));
  }, [token]);

  if (rows === undefined) return <p className="muted">Counting your orders…</p>;
  if (rows === "error") return <p className="muted">Your orders are unavailable right now.</p>;
  return (
    <section>
      <h2>Revenue by category</h2>
      <ul>
        {rows.map(([category, revenue]) => (
          <li key={category}>
            {category}: {usd.format(revenue)}
          </li>
        ))}
      </ul>
    </section>
  );
}
