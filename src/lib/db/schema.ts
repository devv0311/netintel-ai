import { sqliteTable, text, real, integer } from "drizzle-orm/sqlite-core";

import type { ValidationError, ValidationWarning } from "@/lib/domain/validation";

/**
 * The initial investigation schema, per this milestone's brief ("the
 * meaningful initial SQLite schema... focused on the current domain
 * contracts"). Every table here mirrors a Zod schema in src/lib/domain/
 * — the DB row shape and the domain type are kept in lockstep
 * deliberately, and every read/write goes through the validated
 * repository helpers in src/lib/db/repository.ts rather than touching
 * these tables directly, so a malformed row can never enter or leave
 * the domain layer unvalidated.
 *
 * No pipeline stage is implemented yet — these tables exist so the
 * data foundation is provable (migrated, insertable, queryable,
 * provenance-preserving) before any agent populates them for real.
 */

/**
 * The six required provenance fields (docs/requirements.md §8),
 * shared by every table below that persists a derived/extracted item.
 * Spread into each sqliteTable() call rather than duplicated by hand.
 */
function provenanceColumns() {
  return {
    provenanceSource: text("provenance_source").notNull(),
    provenanceLocation: text("provenance_location").notNull(),
    provenanceMethod: text("provenance_method").notNull(),
    provenanceConfidence: real("provenance_confidence").notNull(),
    provenanceProcessingHistory: text("provenance_processing_history", {
      mode: "json",
    })
      .$type<string[]>()
      .notNull(),
    provenanceTimestamp: text("provenance_timestamp").notNull(),
  };
}

export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});

export const investigations = sqliteTable("investigations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  status: text("status").notNull(),
  createdAt: text("created_at").notNull(),
});

export const evidenceSources = sqliteTable("evidence_sources", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  sourceType: text("source_type").notNull(),
  label: text("label").notNull(),
  ingestedAt: text("ingested_at").notNull(),
});

export const evidenceItems = sqliteTable("evidence_items", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  evidenceSourceId: text("evidence_source_id")
    .notNull()
    .references(() => evidenceSources.id),
  itemType: text("item_type").notNull(),
  content: text("content", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  ingestedAt: text("ingested_at").notNull(),
  validationStatus: text("validation_status").notNull(),
  rejectionReason: text("rejection_reason"),
  errors: text("errors", { mode: "json" }).$type<ValidationError[]>().notNull(),
  warnings: text("warnings", { mode: "json" }).$type<ValidationWarning[]>().notNull(),
  confidence: real("confidence").notNull(),
});

export const extractedRecords = sqliteTable("extracted_records", {
  id: text("id").primaryKey(),
  evidenceItemId: text("evidence_item_id")
    .notNull()
    .references(() => evidenceItems.id),
  recordType: text("record_type").notNull(),
  data: text("data", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});

export const entities = sqliteTable("entities", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  kind: text("kind").notNull(),
  canonicalLabel: text("canonical_label").notNull(),
  attributes: text("attributes", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  ...provenanceColumns(),
});

export const aliases = sqliteTable("aliases", {
  id: text("id").primaryKey(),
  entityId: text("entity_id")
    .notNull()
    .references(() => entities.id),
  aliasValue: text("alias_value").notNull(),
  ...provenanceColumns(),
});

export const locations = sqliteTable("locations", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  label: text("label").notNull(),
  locationType: text("location_type").notNull(),
  latitude: real("latitude").notNull(),
  longitude: real("longitude").notNull(),
  ...provenanceColumns(),
});

export const communicationEvents = sqliteTable("communication_events", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  callerPhone: text("caller_phone").notNull(),
  calleePhone: text("callee_phone").notNull(),
  callerEntityId: text("caller_entity_id").references(() => entities.id),
  calleeEntityId: text("callee_entity_id").references(() => entities.id),
  occurredAt: text("occurred_at").notNull(),
  durationSeconds: integer("duration_seconds").notNull(),
  cellLocationId: text("cell_location_id").references(() => locations.id),
  ...provenanceColumns(),
});

export const financialTransactions = sqliteTable("financial_transactions", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  fromAccountEntityId: text("from_account_entity_id").references(() => entities.id),
  toAccountEntityId: text("to_account_entity_id").references(() => entities.id),
  amount: real("amount").notNull(),
  currency: text("currency").notNull(),
  occurredAt: text("occurred_at").notNull(),
  ...provenanceColumns(),
});

/**
 * sourceEntityId/targetEntityId reference entities.id for most edges,
 * but a "co_location" edge's target may instead be a locations.id (a
 * phone/vehicle co-located with a location, not another entity).
 * SQLite foreign keys are not enabled in this project (no `PRAGMA
 * foreign_keys=ON` anywhere), so this dual-target shape does not
 * require a schema-level union or a discriminator column — endpoint
 * validity is enforced at the application layer by
 * src/lib/graph/verify.ts, not by the DB engine.
 */
export const relationships = sqliteTable("relationships", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  sourceEntityId: text("source_entity_id").notNull(),
  targetEntityId: text("target_entity_id").notNull(),
  relationshipType: text("relationship_type").notNull(),
  directed: integer("directed", { mode: "boolean" }).notNull(),
  evidenceItemIds: text("evidence_item_ids", { mode: "json" }).$type<string[]>().notNull(),
  extractedRecordIds: text("extracted_record_ids", { mode: "json" }).$type<string[]>().notNull(),
  conflicts: text("conflicts", { mode: "json" }).$type<string[]>().notNull(),
  attributes: text("attributes", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});

export const analyticalSignals = sqliteTable("analytical_signals", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  graphVersion: text("graph_version").notNull(),
  targetEntityId: text("target_entity_id").references(() => entities.id),
  signalType: text("signal_type").notNull(),
  value: text("value", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  method: text("method").notNull(),
  explanation: text("explanation").notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});

export const aiInferences = sqliteTable("ai_inferences", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  claim: text("claim").notNull(),
  basedOn: text("based_on", { mode: "json" }).$type<string[]>().notNull(),
  confidence: real("confidence").notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});

export const resolutionDecisions = sqliteTable("resolution_decisions", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  canonicalEntityId: text("canonical_entity_id")
    .notNull()
    .references(() => entities.id),
  extractedRecordIds: text("extracted_record_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  resolutionType: text("resolution_type").notNull(),
  status: text("status").notNull(),
  candidateEntityIds: text("candidate_entity_ids", { mode: "json" })
    .$type<string[]>()
    .notNull(),
  conflicts: text("conflicts", { mode: "json" }).$type<string[]>().notNull(),
  reason: text("reason").notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});

export const investigativeLeads = sqliteTable("investigative_leads", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  suggestion: text("suggestion").notNull(),
  relatedEntityIds: text("related_entity_ids", { mode: "json" }).$type<string[]>().notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});
