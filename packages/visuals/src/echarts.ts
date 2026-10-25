// Only the pieces the built-in charts use, so the lazy chunk stays small (DESIGN.md §13).
import { BarChart, LineChart, MapChart, ScatterChart } from "echarts/charts";
import {
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { init, registerMap, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { unwrapAntimeridian } from "./geo.ts";

use([
  BarChart,
  LineChart,
  ScatterChart,
  MapChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  SVGRenderer,
]);

let world: Promise<void> | undefined;

/** Registers the world map once, loading its geometry only when a map draws (ADR 0014). */
export function registerWorld(): Promise<void> {
  world ??= Promise.all([import("./world.ts"), import("topojson-client")]).then(
    ([geometry, topojson]) => {
      // biome-ignore lint/suspicious/noExplicitAny: the TopoJSON's shape is checked by the script that writes it.
      const topology = geometry.world as any;
      const countries = topojson.feature(topology, topology.objects.countries) as unknown as {
        features: { geometry: Parameters<typeof unwrapAntimeridian>[0] }[];
      };
      for (const f of countries.features) f.geometry = unwrapAntimeridian(f.geometry);
      registerMap("world", countries as unknown as Parameters<typeof registerMap>[1]);
    },
  );
  return world;
}

export { init };
