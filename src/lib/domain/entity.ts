import { z } from "zod";

import { ProvenanceSchema } from "./provenance";

/**
 * A resolved Entity, per Agent 2 — Entity Resolution
 * (docs/contracts/agent-contracts.md) and
 * docs/data/synthetic-investigation-spec.md §2 (suspects, phones,
 * IMEIs, vehicles, bank accounts). Locations are modeled separately
 * (./location.ts) since the brief calls them out as a distinct
 * concept. Population of this table happens in the Entity Resolution
 * milestone (Workstream C) — this milestone only establishes the
 * shape and the persistence path.
 */
export const ENTITY_KINDS = [
  "person",
  "phone",
  "imei",
  "vehicle",
  "bank_account",
] as const;
export const EntityKindSchema = z.enum(ENTITY_KINDS);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  kind: EntityKindSchema,
  canonicalLabel: z.string().min(1),
  /** Kind-specific attributes (e.g. a phone's number, a vehicle's plate). */
  attributes: z.record(z.string(), z.unknown()),
  provenance: ProvenanceSchema,
});
export type Entity = z.infer<typeof EntitySchema>;

/**
 * An Alias — a name/identifier variant that refers to the same
 * underlying Entity, per docs/data/synthetic-investigation-spec.md §4.
 */
export const AliasSchema = z.object({
  id: z.string().min(1),
  entityId: z.string().min(1),
  aliasValue: z.string().min(1),
  provenance: ProvenanceSchema,
});
export type Alias = z.infer<typeof AliasSchema>;
