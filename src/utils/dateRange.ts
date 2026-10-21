import { z } from "zod";
import { AppError } from "./AppError";

/**
 * Shared handling of the `from` / `to` query parameters.
 *
 * Rules (identical for the dashboard stats, GET /doctors and GET /patients):
 * - a date-only value (`YYYY-MM-DD`) for `from` means the START of that UTC
 *   day (`00:00:00.000 UTC`),
 * - a date-only value for `to` means the END of that UTC day
 *   (`23:59:59.999 UTC`), so records created later that day are included,
 * - a full ISO timestamp is used exactly as given.
 */

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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

/** 00:00:00.000 UTC of the day the given date belongs to. */
export function startOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())
  );
}

/** 23:59:59.999 UTC of the day the given date belongs to. */
export function endOfUtcDay(value: Date): Date {
  return new Date(
    Date.UTC(
      value.getUTCFullYear(),
      value.getUTCMonth(),
      value.getUTCDate(),
      23,
      59,
      59,
      999
    )
  );
}

/**
 * Resolves one boundary of a date range.
 *
 * - date-only (`YYYY-MM-DD`) -> start (`00:00:00.000 UTC`) or end
 *   (`23:59:59.999 UTC`) of that UTC day,
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
    return boundary === "start" ? startOfUtcDay(day) : endOfUtcDay(day);
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
