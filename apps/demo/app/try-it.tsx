"use client";

import { useEffect, useState } from "react";

const HIDDEN = "dash-demo-try-it-hidden";

/** Storage can be blocked (private windows, previews): the panel then simply shows. */
const read = () => {
  try {
    return localStorage.getItem(HIDDEN) === "1";
  } catch {
    return false;
  }
};

/**
 * The 60-second demo script (DESIGN.md §3) for a first visit. Hiding it is remembered on this
 * browser; it renders after mount, so the server and the browser agree.
 */
export function TryIt() {
  const [hidden, setHidden] = useState(true);
  useEffect(() => setHidden(read()), []);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDDEN, "1");
    } catch {
      // Remembering is a convenience; the panel is hidden for this visit anyway.
    }
  };
  return (
    <section aria-label="Try it" className="try-it">
      <h2>Try it in a minute</h2>
      <ol>
        <li>
          You are signed in as a guest with two of the shop's five tenants: only their orders show.
        </li>
        <li>
          Click <strong>New dashboard</strong>, then <strong>Add Bar</strong>.
        </li>
        <li>
          Drag <strong>Category</strong> into the bar's Category well and <strong>Revenue</strong>{" "}
          into Value (or click a field, then its Add button), and <strong>Save</strong>.
        </li>
        <li>Click a bar: every other visual filters to that category.</li>
        <li>Leave it open: a new order arrives every minute and the numbers refresh.</li>
        <li>
          Open <strong>Under the hood</strong>: your security context, each query's SQL, cache hit
          or miss, and time.
        </li>
      </ol>
      <p>
        <a href="https://github.com/adam-riffi/dashboard-builder">Source on GitHub</a>{" "}
        <button type="button" onClick={hide}>
          Hide
        </button>
      </p>
    </section>
  );
}
