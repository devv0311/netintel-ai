import { z } from "zod";

/**
 * An Investigation is the case container everything else in the domain
 * layer belongs to (per the demo contract's single canonical case,
 * Operation DarkNet Delhi, once that dataset exists — this milestone
 * only establishes the shape, not that data).
 */
export const INVESTIGATION_STATUSES = [
  "not_started",
  "in_progress",
  "completed",
] as const;
export const InvestigationStatusSchema = z.enum(INVESTIGATION_STATUSES);
export type InvestigationStatus = z.infer<typeof InvestigationStatusSchema>;

export const InvestigationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  status: InvestigationStatusSchema,
  createdAt: z.string().datetime(),
});
export type Investigation = z.infer<typeof InvestigationSchema>;
