import { z } from "zod";
import { dateRangeQuerySchema } from "../utils/dateRange";

// `from` / `to` are validated by the shared date range schema:
// invalid dates and inverted ranges are rejected with a 400.
export const dashboardStatsSchema = z.object({
  query: dateRangeQuerySchema,
});
