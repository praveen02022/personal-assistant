/**
 * Calendar day arithmetic in the user's IANA timezone (not the server's, not UTC).
 * "Tomorrow" at 23:30 in Asia/Kolkata is still tomorrow there even though UTC has
 * already rolled over. DST-safe: offsets are resolved for the exact instant.
 */

export type DayRange = { startUtc: Date; endUtc: Date; startDate: string; endDate: string; timezone: string };

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Offset of `tz` from UTC at `instant`, in minutes (e.g. +330 for India). */
export function tzOffsetMinutes(instant: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(instant);
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0; // "GMT" exactly
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

/** The calendar date (YYYY-MM-DD) that `instant` falls on in `tz`. */
export function localDate(instant: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** UTC instant of local midnight at the start of `ymd` in `tz`. */
export function zonedMidnight(ymd: string, tz: string): Date {
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`invalid date ${ymd}`);
  const naiveUtc = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  let guess = naiveUtc - tzOffsetMinutes(new Date(naiveUtc), tz) * 60_000;
  // Re-resolve once: the offset at the guessed instant may differ across a DST change.
  guess = naiveUtc - tzOffsetMinutes(new Date(guess), tz) * 60_000;
  return new Date(guess);
}

export function addDays(ymd: string, days: number): string {
  const m = YMD.exec(ymd);
  if (!m) throw new Error(`invalid date ${ymd}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)).toISOString().slice(0, 10);
}

export const MAX_RANGE_DAYS = 14;

/**
 * Resolves the tool's arguments into an exact UTC window. Explicit dates win over `day`;
 * end_date is inclusive. Rejects inverted or oversized ranges.
 */
export function resolveRange(args: { day?: "today" | "tomorrow"; start_date?: string; end_date?: string }, tz: string, now = new Date()): DayRange {
  const today = localDate(now, tz);
  const startDate = args.start_date ?? (args.day === "tomorrow" ? addDays(today, 1) : today);
  const endDate = args.end_date ?? startDate;
  if (!YMD.test(startDate) || !YMD.test(endDate)) throw new RangeError("Dates must be YYYY-MM-DD");
  const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000 + 1;
  if (days < 1) throw new RangeError("end_date is before start_date");
  if (days > MAX_RANGE_DAYS) throw new RangeError(`At most ${MAX_RANGE_DAYS} days at a time`);
  return { startUtc: zonedMidnight(startDate, tz), endUtc: zonedMidnight(addDays(endDate, 1), tz), startDate, endDate, timezone: tz };
}
