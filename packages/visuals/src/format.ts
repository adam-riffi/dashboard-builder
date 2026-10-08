import type {
  FieldType,
  MeasureFormat,
  ResultColumn,
  SlotItem,
  TimeGrain,
} from "@adam-riffi/dash-core";

export interface ValueFormat {
  type: FieldType;
  format?: MeasureFormat;
  /** ISO 4217 code, for `currency`. */
  currency?: string;
  timeGrain?: TimeGrain;
  /** Short numbers for chart axes: `$20K`, `1.2M`. */
  compact?: boolean;
}

/** A column's formatter, with a short form for chart axes. */
export interface Formatter {
  (value: unknown): string;
  compact(value: unknown): string;
}

const MISSING = "–";
// Dates are truncated in UTC by the gateway, so they are shown in UTC too.
const dates = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options });
const DAY = dates({ month: "short", day: "numeric", year: "numeric" });
const MONTH = dates({ month: "short", year: "numeric" });

/** The number formatter for a format, built once per column rather than per value. */
function numberFormat(f: ValueFormat): Intl.NumberFormat {
  const short = f.compact ? ({ notation: "compact", maximumFractionDigits: 1 } as const) : {};
  if (f.format === "currency") {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: f.currency ?? "USD",
      ...short,
    });
  }
  if (f.format === "percent") {
    return new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 1 });
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, ...short });
}

function formatDate(value: unknown, grain: TimeGrain | undefined): string {
  const d = new Date(String(value));
  switch (grain) {
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

/** A formatter for one kind of value (en-US): grouped numbers, money, percentages, dates. */
function formatterFor(f: ValueFormat): (value: unknown) => string {
  const shown = (show: (value: unknown) => string) => (value: unknown) =>
    value === null || value === undefined ? MISSING : show(value);
  switch (f.type) {
    case "number": {
      const numbers = numberFormat(f);
      return shown((value) => numbers.format(Number(value)));
    }
    case "date":
      return shown((value) => formatDate(value, f.timeGrain));
    case "boolean":
      return shown((value) => (value ? "Yes" : "No"));
    default:
      return shown(String);
  }
}

/** A value as people read it; for many values of one column, use `formattersFor`. */
export const formatValue = (value: unknown, f: ValueFormat) => formatterFor(f)(value);

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

/** A slot item's name before any answer: the measure's name or formula, or the field's words. */
export function itemLabel(item: SlotItem): string {
  if ("name" in item) return item.name;
  if ("formula" in item) return item.formula;
  if ("aggregation" in item && item.aggregation) {
    return `${AGGREGATION[item.aggregation]} ${words(item.field)}`;
  }
  const name = words(item.field);
  return `${name.charAt(0).toUpperCase()}${name.slice(1)}`;
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
    return Object.assign(formatterFor(f), { compact: formatterFor({ ...f, compact: true }) });
  });
}
