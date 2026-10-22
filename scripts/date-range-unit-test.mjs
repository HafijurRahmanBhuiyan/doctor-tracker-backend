#!/usr/bin/env node
/**
 * Pure unit tests for the Asia/Dhaka date helpers.
 *
 * No server, no database: everything is checked against FIXED instants, so
 * the result never depends on the current time.
 *
 * Usage: npm run build && node scripts/date-range-unit-test.mjs
 */

import {
  APP_TIMEZONE,
  APP_UTC_OFFSET_MS,
  DAY_MS,
  dhakaDayKey,
  dhakaMonthKey,
  endOfDhakaDay,
  lastNDhakaMonthKeys,
  parseRangeBoundary,
  startOfDhakaDay,
  startOfDhakaMonth,
  zoneOffsetMs,
} from "../dist/utils/dateRange.js";

let failures = 0;
let passed = 0;

const iso = (value) => (value === null ? "null" : value.toISOString());

function check(name, actual, expected) {
  const ok = actual === expected;
  if (ok) {
    passed += 1;
    console.log(`PASS  ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL  ${name}`);
    console.log(`      expected: ${expected}`);
    console.log(`      actual:   ${actual}`);
  }
}

const checkEqual = (name, actual, expected) =>
  check(name, JSON.stringify(actual), JSON.stringify(expected));

// ---------------------------------------------------------------------------
// 1. Date-only boundaries are the start / end of the Asia/Dhaka day
// ---------------------------------------------------------------------------
check(
  'parseRangeBoundary("2026-10-21", "start")',
  iso(parseRangeBoundary("2026-10-21", "start")),
  "2026-10-20T18:00:00.000Z"
);
check(
  'parseRangeBoundary("2026-10-21", "end")',
  iso(parseRangeBoundary("2026-10-21", "end")),
  "2026-10-21T17:59:59.999Z"
);

// ---------------------------------------------------------------------------
// 2. Day keys follow the Asia/Dhaka day (UTC+6)
// ---------------------------------------------------------------------------
check(
  'dhakaDayKey(2026-10-21T17:59:59.999Z)',
  dhakaDayKey(new Date("2026-10-21T17:59:59.999Z")),
  "2026-10-21"
);
check(
  'dhakaDayKey(2026-10-21T18:00:00.000Z)',
  dhakaDayKey(new Date("2026-10-21T18:00:00.000Z")),
  "2026-10-22"
);

// ---------------------------------------------------------------------------
// 3. Day boundaries
// ---------------------------------------------------------------------------
check(
  "startOfDhakaDay(2026-10-21T18:30:00Z)",
  iso(startOfDhakaDay(new Date("2026-10-21T18:30:00Z"))),
  "2026-10-21T18:00:00.000Z"
);
check(
  "endOfDhakaDay(2026-10-21T18:30:00Z)",
  iso(endOfDhakaDay(new Date("2026-10-21T18:30:00Z"))),
  "2026-10-22T17:59:59.999Z"
);

// ---------------------------------------------------------------------------
// 4. Month series: exactly n keys, ending with the current Dhaka month
// ---------------------------------------------------------------------------
checkEqual(
  "lastNDhakaMonthKeys(2026-10-31T17:00:00Z, 6)",
  lastNDhakaMonthKeys(new Date("2026-10-31T17:00:00Z"), 6),
  ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
);
checkEqual(
  "lastNDhakaMonthKeys(2026-10-31T18:30:00Z, 6)",
  lastNDhakaMonthKeys(new Date("2026-10-31T18:30:00Z"), 6),
  ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11"]
);
check(
  "lastNDhakaMonthKeys(2026-10-31T17:00:00Z, 6).length",
  lastNDhakaMonthKeys(new Date("2026-10-31T17:00:00Z"), 6).length,
  6
);
check(
  "lastNDhakaMonthKeys(2026-10-31T18:30:00Z, 6).length",
  lastNDhakaMonthKeys(new Date("2026-10-31T18:30:00Z"), 6).length,
  6
);

// ---------------------------------------------------------------------------
// 5. Year boundary
// ---------------------------------------------------------------------------
checkEqual(
  "lastNDhakaMonthKeys(2026-01-15T00:00:00Z, 6)",
  lastNDhakaMonthKeys(new Date("2026-01-15T00:00:00Z"), 6),
  ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]
);

// ---------------------------------------------------------------------------
// 6. Invalid calendar dates are rejected
// ---------------------------------------------------------------------------
check(
  'parseRangeBoundary("2026-02-31", "start")',
  iso(parseRangeBoundary("2026-02-31", "start")),
  "null"
);
check(
  'parseRangeBoundary("2026-02-31", "end")',
  iso(parseRangeBoundary("2026-02-31", "end")),
  "null"
);
check(
  'parseRangeBoundary("not-a-date", "start")',
  iso(parseRangeBoundary("not-a-date", "start")),
  "null"
);

// ---------------------------------------------------------------------------
// 7. Month helpers
// ---------------------------------------------------------------------------
check(
  'dhakaMonthKey(2026-10-31T18:30:00Z)',
  dhakaMonthKey(new Date("2026-10-31T18:30:00Z")),
  "2026-11"
);
check(
  'dhakaMonthKey(2026-10-31T17:00:00Z)',
  dhakaMonthKey(new Date("2026-10-31T17:00:00Z")),
  "2026-10"
);
check(
  'startOfDhakaMonth("2026-05")',
  iso(startOfDhakaMonth("2026-05")),
  "2026-04-30T18:00:00.000Z"
);
check(
  "startOfDhakaMonth(2026-10-31T18:30:00Z)",
  iso(startOfDhakaMonth(new Date("2026-10-31T18:30:00Z"))),
  "2026-10-31T18:00:00.000Z"
);

// ---------------------------------------------------------------------------
// 8. The fixed offset matches the IANA zone (Bangladesh has no DST)
// ---------------------------------------------------------------------------
check(
  "APP_UTC_OFFSET_MS === zoneOffsetMs(APP_TIMEZONE)",
  zoneOffsetMs(new Date("2026-07-15T00:00:00Z"), APP_TIMEZONE),
  APP_UTC_OFFSET_MS
);
check(
  "zoneOffsetMs in January === zoneOffsetMs in July",
  zoneOffsetMs(new Date("2026-01-15T00:00:00Z"), APP_TIMEZONE),
  zoneOffsetMs(new Date("2026-07-15T00:00:00Z"), APP_TIMEZONE)
);

// ---------------------------------------------------------------------------
// 9. Walking the day buckets: 30 consecutive Dhaka days, no gap, no duplicate
// ---------------------------------------------------------------------------
{
  const start = startOfDhakaDay(new Date("2026-09-25T00:00:00Z"));
  const keys = [];
  let cursor = start;
  for (let i = 0; i < 30; i++) {
    keys.push(dhakaDayKey(cursor));
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  check("30 day buckets", keys.length, 30);
  check("30 day buckets are unique", new Set(keys).size, 30);
  check("30 day buckets start", keys[0], "2026-09-25");
  check("30 day buckets end", keys[29], "2026-10-24");
  check(
    "30 day buckets have no gap",
    keys.every((key, index) =>
      index === 0
        ? true
        : new Date(`${key}T00:00:00Z`).getTime() -
              new Date(`${keys[index - 1]}T00:00:00Z`).getTime() ===
            DAY_MS
    ),
    true
  );
}

// ---------------------------------------------------------------------------
console.log("");
console.log(`${passed} passed, ${failures} failed`);
if (failures > 0) {
  process.exit(1);
}
