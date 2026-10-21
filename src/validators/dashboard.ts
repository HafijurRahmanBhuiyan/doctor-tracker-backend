import { z } from "zod";

// z.coerce.date rejects non-date strings -> error handler turns ZodError into 400
export const dashboardStatsSchema = z.object({
  query: z.object({
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }),
});
