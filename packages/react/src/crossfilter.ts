import type { QuerySpec, TimeGrain } from "@adam-riffi/dash-core";

type Filter = QuerySpec["filters"][number];

/**
 * A visual's selection (DESIGN.md §6): one value of a field, or one time bucket of a time field
 * at the grain the visual groups it by. The coordinator filters every other visual by it.
 */
export type Selection =
  | { visualId: string; field: string; value: string | number | boolean }
  | { visualId: string; field: string; bucket: string; grain: TimeGrain };

const MONTHS: Partial<Record<TimeGrain, number>> = { month: 1, quarter: 3, year: 12 };

/** The start of the bucket after `start` (UTC, the gateway's time zone), as an ISO date. */
function nextBucket(start: Date, grain: TimeGrain): string {
  const next = new Date(start);
  const months = MONTHS[grain];
  if (months) next.setUTCMonth(next.getUTCMonth() + months);
  else next.setUTCDate(next.getUTCDate() + (grain === "week" ? 7 : 1));
  return next.toISOString().slice(0, 10);
}

/**
 * The filter clauses a selection puts on the other visuals: an equality for a value, and
 * `[start, next start)` for a time bucket, so a bucket's last instant is in and the next
 * bucket's first is out, for date and timestamp columns alike.
 */
export function filtersOf(selection: Selection): Filter[] {
  if ("value" in selection) {
    return [{ field: selection.field, op: "in", values: [selection.value] }];
  }
  const start = new Date(selection.bucket);
  return [
    { field: selection.field, op: "gte", values: [start.toISOString().slice(0, 10)] },
    { field: selection.field, op: "lt", values: [nextBucket(start, selection.grain)] },
  ];
}
