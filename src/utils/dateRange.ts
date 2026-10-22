import { z } from "zod";
import { AppError } from "./AppError";

/**
 * Shared handling of the `from` / `to` query parameters and of every
 * Asia/Dhaka based date computation of the API.
 *
 * Rules (identical for the dashboard stats, GET /doctors and GET /patients):
 * - a date-only value (`YYYY-MM-DD`) for `from` means the START of that
 *   Asia/Dhaka day (`00:00:00.000 Asia/Dhaka`),
 * - a date-only value for `to` means the END of that Asia/Dhaka day
 *   (`23:59:59.999 Asia/Dhaka`), so records created later that day are included,
 * - a full ISO timestamp is used exactly as given.
 *
 * This module is the SINGLE source of truth for the application time zone:
 * - `APP_TIMEZONE` is the IANA zone name (used by MongoDB `$dateToString`),
 * - `APP_UTC_OFFSET_MS` is its fixed UTC offset. Bangladesh Standard Time has
 *   no daylight saving time, so the offset never changes and every
 *   instant <-> wall clock conversion can be done with plain arithmetic.
 */

/** IANA time zone of the application. */
export const APP_TIMEZONE = "Asia/Dhaka";

/** Fixed UTC offset of `APP_TIMEZONE` (UTC+06:00, no DST). */
export const APP_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;

/** One day in milliseconds (a Dhaka day is exactly 24h, there is no DST). */
export const DAY_MS = 24 * 60 * 60 * 1000;

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?$/;

export const INVALID_FROM_MESSAGE =
  "'from' must be a valid date (YYYY-MM-DD or an ISO timestamp)";
export const INVALID_TO_MESSAGE =
  "'to' must be a valid date (YYYY-MM-DD or an ISO timestamp)";
export const INVERTED_RANGE_MESSAGE = "'from' must not be after 'to'";

export type RangeBoundary = "start" | "end";

export type DateRange = {
  from?: Date;
  to?: Date;
};

/**
 * Offset (in ms) of `timeZone` at the given instant, derived from the IANA
 * database. Used to verify that `APP_UTC_OFFSET_MS` really matches
 * `APP_TIMEZONE` (see `scripts/date-range-unit-test.mjs`).
 */
export function zoneOffsetMs(
  value: Date,
  timeZone: string = APP_TIMEZONE
): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);

  const read = (type: string): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asUtc = Date.UTC(
    read("year"),
    read("month") - 1,
    read("day"),
    read("hour") % 24,
    read("minute"),
    read("second")
  );

  return asUtc - Math.floor(value.getTime() / 1000) * 1000;
}

/**
 * The Asia/Dhaka wall clock of an instant, expressed as UTC components.
 * `wallClock.getUTCFullYear()` is the Dhaka year, and so on.
 */
function dhakaWallClock(value: Date): Date {
  return new Date(value.getTime() + APP_UTC_OFFSET_MS);
}

/** `YYYY-MM-DD` of the Asia/Dhaka day the instant belongs to. */
export function dhakaDayKey(value: Date): string {
  return dhakaWallClock(value).toISOString().slice(0, 10);
}

/** `YYYY-MM` of the Asia/Dhaka month the instant belongs to. */
export function dhakaMonthKey(value: Date): string {
  return dhakaWallClock(value).toISOString().slice(0, 7);
}

/** Start of the Asia/Dhaka day (00:00:00.000) as a UTC timestamp. */
export function startOfDhakaDay(value: Date): Date {
  const wall = dhakaWallClock(value);
  const start = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
  return new Date(start - APP_UTC_OFFSET_MS);
}

/** End of the Asia/Dhaka day (23:59:59.999) as a UTC timestamp. */
export function endOfDhakaDay(value: Date): Date {
  return new Date(startOfDhakaDay(value).getTime() + DAY_MS - 1);
}

/**
 * Start of an Asia/Dhaka month (00:00:00.000 on the 1st) as a UTC timestamp.
 *
 * Accepts either an instant (the month it belongs to) or a month key
 * (`YYYY-MM`).
 */
export function startOfDhakaMonth(value: Date): Date;
export function startOfDhakaMonth(monthKey: string): Date;
export function startOfDhakaMonth(value: Date | string): Date {
  if (typeof value === "string") {
    const { year, month } = parseMonthKey(value);
    return new Date(Date.UTC(year, month - 1, 1) - APP_UTC_OFFSET_MS);
  }

  const wall = dhakaWallClock(value);
  return new Date(
    Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), 1) - APP_UTC_OFFSET_MS
  );
}

/**
 * The last `n` Asia/Dhaka month keys, oldest first, always ending with the
 * month the given instant belongs to (`2026-05 ... 2026-10`).
 *
 * The months are walked with plain year/month numbers, never with UTC month
 * arithmetic, so a month boundary is handled correctly for every instant.
 */
export function lastNDhakaMonthKeys(now: Date, n: number): string[] {
  const count = Math.max(0, Math.floor(n));
  const wall = dhakaWallClock(now);

  let year = wall.getUTCFullYear();
  let month = wall.getUTCMonth() + 1; // 1-based

  const keys: string[] = [];
  for (let i = 0; i < count; i++) {
    keys.push(formatMonthKey(year, month));
    month -= 1;
    if (month === 0) {
      month = 12;
      year -= 1;
    }
  }

  return keys.reverse();
}

/** `YYYY-MM` for a 1-based year/month pair. */
function formatMonthKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/** Parses a `YYYY-MM` month key into a 1-based year/month pair. */
function parseMonthKey(monthKey: string): { year: number; month: number } {
  const match = MONTH_KEY_PATTERN.exec(monthKey.trim());
  if (!match) {
    throw new AppError(`Invalid month key: ${monthKey}`, 400);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new AppError(`Invalid month key: ${monthKey}`, 400);
  }

  return { year, month };
}

/** True when the value is a date-only string (`YYYY-MM-DD`). */
export function isDateOnly(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value.trim());
}

/**
 * True when the value is a calendar date that really exists.
 * `new Date("2026-02-31")` silently rolls over to March 3, so the day is
 * compared against the parsed date instead.
 */
export function isValidCalendarDate(value: string): boolean {
  const [year, month, day] = value.trim().split("-").map(Number);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return false;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/**
 * Resolves one boundary of a date range.
 *
 * - date-only (`YYYY-MM-DD`) -> start (`00:00:00.000`) or end
 *   (`23:59:59.999`) of that Asia/Dhaka day (converted to UTC for MongoDB),
 * - full ISO timestamp -> used exactly as given.
 *
 * Returns `null` when the value is not a valid date.
 */
export function parseRangeBoundary(
  value: string,
  boundary: RangeBoundary
): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  if (isDateOnly(raw)) {
    if (!isValidCalendarDate(raw)) return null;
    const day = new Date(`${raw}T00:00:00.000Z`);
    return boundary === "start" ? startOfDhakaDay(day) : endOfDhakaDay(day);
  }

  if (!ISO_TIMESTAMP_PATTERN.test(raw)) return null;

  const timestamp = new Date(raw);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp;
}

/**
 * Resolves the raw `from` / `to` query values into concrete boundaries.
 * Empty values are treated as "not provided".
 *
 * @throws AppError 400 when a value is invalid or `from` is after `to`.
 */
export function resolveDateRange(from?: string, to?: string): DateRange {
  const rawFrom = from?.trim();
  const rawTo = to?.trim();

  const range: DateRange = {};

  if (rawFrom) {
    const parsed = parseRangeBoundary(rawFrom, "start");
    if (!parsed) throw new AppError(INVALID_FROM_MESSAGE, 400);
    range.from = parsed;
  }

  if (rawTo) {
    const parsed = parseRangeBoundary(rawTo, "end");
    if (!parsed) throw new AppError(INVALID_TO_MESSAGE, 400);
    range.to = parsed;
  }

  if (range.from && range.to && range.from.getTime() > range.to.getTime()) {
    throw new AppError(INVERTED_RANGE_MESSAGE, 400);
  }

  return range;
}

/**
 * Query schema for the `from` / `to` parameters. Invalid dates and inverted
 * ranges are rejected with a 400 by the error handler.
 */
export const dateRangeQuerySchema = z
  .object({
    from: z.string().optional(),
    to: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const rawFrom = value.from?.trim();
    const rawTo = value.to?.trim();

    const from = rawFrom ? parseRangeBoundary(rawFrom, "start") : undefined;
    const to = rawTo ? parseRangeBoundary(rawTo, "end") : undefined;

    if (rawFrom && !from) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: INVALID_FROM_MESSAGE,
      });
    }

    if (rawTo && !to) {
      ctx.addIssue({
        code: "custom",
        path: ["to"],
        message: INVALID_TO_MESSAGE,
      });
    }

    if (from && to && from.getTime() > to.getTime()) {
      ctx.addIssue({
        code: "custom",
        path: ["from"],
        message: INVERTED_RANGE_MESSAGE,
      });
    }
  });
