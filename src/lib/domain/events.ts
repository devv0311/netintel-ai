import { z } from "zod";

import { ProvenanceSchema } from "./provenance";

/**
 * A CommunicationEvent — one CDR-style record, per
 * docs/data/synthetic-investigation-spec.md §2/§3 (1,000+ CDR records
 * required once the full dataset is generated). Caller/callee entity
 * IDs are optional because a raw CDR event may be ingested before the
 * phone numbers on it have been resolved to Entities.
 */
export const CommunicationEventSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  callerPhone: z.string().min(1),
  calleePhone: z.string().min(1),
  callerEntityId: z.string().min(1).optional(),
  calleeEntityId: z.string().min(1).optional(),
  occurredAt: z.string().datetime(),
  durationSeconds: z.number().int().min(0),
  cellLocationId: z.string().min(1).optional(),
  provenance: ProvenanceSchema,
});
export type CommunicationEvent = z.infer<typeof CommunicationEventSchema>;

/**
 * A FinancialTransaction, per
 * docs/data/synthetic-investigation-spec.md §2/§3 (500+ transactions
 * required once the full dataset is generated), including support for
 * the money-mule chains that spec requires be discoverable via
 * transaction-path analysis (Workstream E).
 */
export const FinancialTransactionSchema = z.object({
  id: z.string().min(1),
  investigationId: z.string().min(1),
  fromAccountEntityId: z.string().min(1).optional(),
  toAccountEntityId: z.string().min(1).optional(),
  amount: z.number().positive(),
  currency: z.string().min(1),
  occurredAt: z.string().datetime(),
  provenance: ProvenanceSchema,
});
export type FinancialTransaction = z.infer<typeof FinancialTransactionSchema>;
