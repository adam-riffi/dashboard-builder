# @adam-riffi/dash-react

The browser half of [dashboard-builder](https://github.com/adam-riffi/dashboard-builder):
- a builder where your users pick a visual, drag fields and measures into it, filter and arrange;
- a viewer for saved dashboards, with cross-filtering and live refresh.

It talks to [`@adam-riffi/dash-gateway`](https://www.npmjs.com/package/@adam-riffi/dash-gateway).

## Host setup

```tsx
import { DashboardViewer, DashProvider } from "@adam-riffi/dash-react";
import { DashboardBuilder } from "@adam-riffi/dash-react/builder"; // only pages that edit load it
import "react-grid-layout/css/styles.css"; // the builder's grid
import { useState } from "react";

export function Dashboard({ saved, save, getToken }) {
  const [spec, setSpec] = useState(saved); // a DashboardSpec; you store it (onSave)
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

## What you get

- **`<DashProvider gateway getToken currency>`:** the gateway's address and the caller's token, asked again for every request.
- **`<DashboardViewer spec underTheHood?>`:**
  - each visual in its grid cell, with loading, empty and error states;
  - refresh every `spec.refreshIntervalSec`, usually answered `304`;
  - cross-filtering: click a bar, a point or a row to filter the other visuals.
- **`<DashboardBuilder spec onChange onSave>`:** controlled, so every edit goes to `onChange` and Save hands a valid spec to `onSave`. It covers field wells with drag and drop or a keyboard path, a 12-column grid, filters, and a formula editor with completions and live errors.
- **Your own visuals:** `registerVisual(plugin)` from [`@adam-riffi/dash-visuals`](https://www.npmjs.com/package/@adam-riffi/dash-visuals) adds one.

MIT licensed.
