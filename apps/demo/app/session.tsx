"use client";

import { createClient } from "@supabase/supabase-js";
import { useEffect, useState } from "react";

type State = { kind: "loading" } | { kind: "signed-in"; userId: string } | { kind: "error" };

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
      const user = data.session?.user ?? (await auth.signInAnonymously()).data.user;
      setState(user ? { kind: "signed-in", userId: user.id } : { kind: "error" });
    })().catch(() => setState({ kind: "error" }));
  }, []);

  if (state.kind === "loading") return <p className="muted">Signing you in…</p>;
  if (state.kind === "error") return <p role="alert">Sign-in is unavailable right now.</p>;
  return (
    <p>
      Signed in as guest <code>{state.userId.slice(0, 8)}</code>
    </p>
  );
}
