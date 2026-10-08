import type { FieldType, MeasureFormat, ResultColumn, TimeGrain } from "@adam-riffi/dash-core";

export interface ValueFormat {
  type: FieldType;
  format?: MeasureFormat;
  /** ISO 4217 code, for `currency`. */
  currency?: string;
  timeGrain?: TimeGrain;
}

export type Formatter = (value: unknown) => string;

const MISSING = "–";
// Dates are truncated in UTC by the gateway, so they are shown in UTC too.
const dates = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options });
const DAY = dates({ month: "short", day: "numeric", year: "numeric" });
const MONTH = dates({ month: "short", year: "numeric" });

/** A value as people read it (en-US): grouped numbers, money, percentages, dates by grain. */
export function formatValue(value: unknown, f: ValueFormat): string {
  if (value === null || value === undefined) return MISSING;
  switch (f.type) {
    case "number": {
      const n = Number(value);
      if (f.format === "currency") {
        return new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: f.currency ?? "USD",
        }).format(n);
      }
      if (f.format === "percent") {
        return new Intl.NumberFormat("en-US", {
          style: "percent",
          maximumFractionDigits: 1,
        }).format(n);
      }
      return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);
    }
    case "date": {
      const d = new Date(String(value));
      switch (f.timeGrain) {
        case "week":
          return `Week of ${DAY.format(d)}`;
        case "month":
          return MONTH.format(d);
        case "quarter":
          return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
        case "year":
          return String(d.getUTCFullYear());
        default:
          return DAY.format(d);
      }
    }
    case "boolean":
      return value ? "Yes" : "No";
    default:
      return String(value);
  }
}

const AGGREGATION = {
  SUM: "Total",
  AVG: "Average",
  MIN: "Lowest",
  MAX: "Highest",
  COUNT: "Count of",
  COUNT_DISTINCT: "Distinct",
} as const;

/** `order_items.unit_price` → `unit price`; `customerId` → `customer id`. */
const words = (field: string) =>
  field
    .slice(field.lastIndexOf(".") + 1)
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

/** A column's heading: the measure's name or formula, or words made from the field. */
export function labelOf(column: ResultColumn): string {
  if (column.kind === "dimension") {
    const name = words(column.field);
    const grain = column.timeGrain ? ` (${column.timeGrain})` : "";
    return `${name.charAt(0).toUpperCase()}${name.slice(1)}${grain}`;
  }
  if ("name" in column) return column.name;
  if ("formula" in column) return column.formula;
  return `${AGGREGATION[column.aggregation]} ${words(column.field)}`;
}

/** One formatter per result column: named measures by their format, the rest by type. */
export function formattersFor(
  columns: ResultColumn[],
  formats: ReadonlyMap<string, MeasureFormat>,
  currency: string,
): Formatter[] {
  return columns.map((column) => {
    const f: ValueFormat = { type: column.type, currency };
    if (column.kind === "dimension" && column.timeGrain) f.timeGrain = column.timeGrain;
    const format = "name" in column ? formats.get(column.name) : undefined;
    if (format) f.format = format;
    return (value) => formatValue(value, f);
  });
}
