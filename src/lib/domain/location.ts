import { z } from "zod";

import { ProvenanceSchema } from "./provenance";

/**
 * A Location, per the spatial analysis requirement in
 * docs/requirements.md §5 and Workstream F (spatial corroboration).
 */
export const LOCATION_TYPES = [
  "address",
  "cell_tower",
  "crime_scene",
  "other",
] as const;
export const LocationTypeSchema = z.enum(LOCATION_TYPES);
export type LocationType = z.infer<typeof LocationTypeSchema>;

export const LocationSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  label: z.string().min(1),
  locationType: LocationTypeSchema,
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  provenance: ProvenanceSchema,
});
export type Location = z.infer<typeof LocationSchema>;
