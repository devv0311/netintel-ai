import { z } from "zod";

/**
 * A TemporalInterval, per the temporal analysis requirement in
 * docs/requirements.md §5 and Workstream F (spatial/temporal
 * corroboration). A pure value type — not persisted as its own table;
 * it is embedded wherever a domain object needs a time window (e.g. a
 * future overlap-correlation finding). `end` is optional to represent
 * a point-in-time (start only); when both are present, end must not
 * precede start.
 */
export const TemporalIntervalSchema = z
  .object({
    start: z.string().datetime(),
    end: z.string().datetime().optional(),
  })
  .refine((interval) => !interval.end || interval.end >= interval.start, {
    message: "end must not precede start",
    path: ["end"],
  });
export type TemporalInterval = z.infer<typeof TemporalIntervalSchema>;
