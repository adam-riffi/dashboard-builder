import { bar, kpi, line, table } from "./builtins.ts";
import type { VisualPlugin } from "./plugin.ts";
import { Bar, Kpi, Line, Table } from "./render.tsx";

// ponytail: one registry per page; a host that needs two would pass registries explicitly.
const registry = new Map<string, VisualPlugin<unknown>>();

/**
 * Adds a visual (DESIGN.md §7). Registering a type again replaces it, so a host module that
 * Fast Refresh re-runs, or a host overriding a built-in, does not throw.
 */
export function registerVisual(visual: VisualPlugin<unknown>): void {
  registry.set(visual.type, visual);
}

export const getVisual = (type: string) => registry.get(type);
export const visuals = () => [...registry.values()];

registerVisual({ ...kpi, render: Kpi });
registerVisual({ ...bar, render: Bar });
registerVisual({ ...line, render: Line });
registerVisual({ ...table, render: Table });
