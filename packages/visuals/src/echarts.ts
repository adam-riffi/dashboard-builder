// Only the pieces the built-in charts use, so the lazy chunk stays small (DESIGN.md §13).
import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, SVGRenderer]);

export { init };
