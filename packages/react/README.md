# @adam-riffi/dash-react

The browser half of [dashboard-builder](https://github.com/adam-riffi/dashboard-builder):
- a builder where your users pick a visual, drag fields and measures into it, filter and arrange;
- a viewer for saved dashboards, with cross-filtering and live refresh.

It talks to [`@adam-riffi/dash-gateway`](https://www.npmjs.com/package/@adam-riffi/dash-gateway).

## Host setup

```tsx
"use client";
import { type DashboardSpec, DashboardViewer, DashProvider } from "@adam-riffi/dash-react";
import { DashboardBuilder } from "@adam-riffi/dash-react/builder"; // only pages that edit load it
import "react-grid-layout/css/styles.css"; // the builder's grid: pnpm add react-grid-layout
import { useState } from "react";

type Props = { saved: DashboardSpec; save: (s: DashboardSpec) => void; getToken: () => Promise<string> };
export function Dashboard({ saved, save, getToken }: Props) {
  const [spec, setSpec] = useState(saved); // you store dashboards: Save hands them to `save`
  const [editing, setEditing] = useState(false);
  return (
    <DashProvider gateway="/api/dash" getToken={getToken}>
      {editing
        ? <DashboardBuilder spec={spec} onChange={setSpec} onSave={(s) => { save(s); setEditing(false); }} />
        : <DashboardViewer spec={spec} />}
    </DashProvider>
  );
}
```

The builder's grid stylesheet comes from `react-grid-layout`, which you install alongside (`pnpm add react-grid-layout@^2.3.0`): pnpm keeps a package's own dependencies out of your imports.

## What you get

- **`<DashProvider gateway getToken currency>`:** the gateway's address and the caller's token, asked again for every request.
- **`<DashboardViewer spec underTheHood?>`:**
  - each visual in its grid cell, with loading, empty and error states;
  - refresh every `spec.refreshIntervalSec`, usually answered `304`;
  - cross-filtering: click a bar, a point or a row to filter the other visuals.
- **`<DashboardBuilder spec onChange onSave>`:** controlled, so every edit goes to `onChange` and Save hands a valid spec to `onSave`. It covers field wells with drag and drop or a keyboard path, a 12-column grid, filters, and a formula editor with completions and live errors.
- **Your own visuals:** `registerVisual(plugin)` from [`@adam-riffi/dash-visuals`](https://www.npmjs.com/package/@adam-riffi/dash-visuals) adds one.

MIT licensed.
