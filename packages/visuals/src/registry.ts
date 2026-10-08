import { bar, kpi, line, table } from "./builtins.ts";
import type { VisualDefinition } from "./plugin.ts";

// ponytail: one registry per page; a host that needs two would pass registries explicitly.
const registry = new Map<string, VisualDefinition<unknown>>();

/** Adds a visual (DESIGN.md §7); a type can be registered once. */
export function registerVisual(visual: VisualDefinition<unknown>): void {
  if (registry.has(visual.type)) {
    throw new Error(`a visual of type ${visual.type} is already registered`);
  }
  registry.set(visual.type, visual);
}

export const getVisual = (type: string) => registry.get(type);
export const visuals = () => [...registry.values()];

for (const builtin of [kpi, bar, line, table]) registerVisual(builtin);
