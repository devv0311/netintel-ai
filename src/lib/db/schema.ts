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

/**
 * targetEntityId is unconstrained (no `.references()`) because the P5.6
 * analysis graph includes both entities AND locations as nodes — a
 * centrality/bridge/ranking signal may legitimately target either, the
 * same dual-target shape `relationships.sourceEntityId/targetEntityId`
 * already uses (see the comment above that table). Endpoint validity is
 * enforced at the application layer by src/lib/analytics/verify.ts.
 */
export const analyticalSignals = sqliteTable("analytical_signals", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  graphVersion: text("graph_version").notNull(),
  targetEntityId: text("target_entity_id"),
  signalType: text("signal_type").notNull(),
  value: text("value", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  method: text("method").notNull(),
  explanation: text("explanation").notNull(),
  classification: text("classification").notNull(),
  ...provenanceColumns(),
});

/**
 * Spatial/temporal corroboration findings (P5.7). Mirrors the P5.6
 * `analytical_signals` shape: `entity_ids`/`location_ids` are
 * application-validated references (an `entities.id` or a `locations.id`
 * — no `.references()`, matching the dual-target rationale on
 * `analytical_signals.target_entity_id`). `window_start`/`window_end`
 * are the two halves of the domain `TemporalInterval` (`window_end`
 * null for a point-in-time or a pure spatial-proximity finding).
 * Endpoint/classification/graph-version validity is enforced at the
 * application layer by src/lib/corroboration/verify.ts.
 */
export const corroborationFindings = sqliteTable("corroboration_findings", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  graphVersion: text("graph_version").notNull(),
  findingType: text("finding_type").notNull(),
  kind: text("kind").notNull(),
  entityIds: text("entity_ids", { mode: "json" }).$type<string[]>().notNull(),
  locationIds: text("location_ids", { mode: "json" }).$type<string[]>().notNull(),
  windowStart: text("window_start"),
  windowEnd: text("window_end"),
  value: text("value", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
  method: text("method").notNull(),
  explanation: text("explanation").notNull(),
  classification: text("classification").notNull(),
  evidenceItemIds: text("evidence_item_ids", { mode: "json" }).$type<string[]>().notNull(),
  supportingRecordIds: text("supporting_record_ids", { mode: "json" }).$type<string[]>().notNull(),
  ...provenanceColumns(),
});

/**
 * Generated case dossiers (P5.9). One row per generated report.
 *
 * `id` is content-addressed over the deterministic report body, so
 * regenerating an unchanged case resolves to the same row and is
 * skipped rather than duplicated (the same idempotency mechanism
 * `corroboration_findings` and `analytical_signals` already use). A new
 * `graph_version` produces a different id, so a dossier can never
 * silently describe a graph state that no longer exists.
 *
 * `sections`, `copilot_excerpts`, `limitations` and `counts` are stored
 * as JSON documents rather than exploded into child tables: a dossier
 * is a point-in-time, immutable assembly of ids that other tables
 * already own, and it is only ever read back whole. Nothing joins to a
 * section or a finding, so child tables would add write paths and
 * migration surface without buying a query. Every id inside those
 * documents is validated against the live store by
 * src/lib/dossier/verify.ts before the row is written.
 *
 * There is deliberately no single `classification` column. A dossier
 * mixes classifications by design — an Observed Fact inventory row and
 * an Investigative Lead sit in the same report — so one summary label
 * would necessarily overstate part of it. The per-classification census
 * lives in `counts.byClassification`, and every finding carries its own.
 */
export const dossiers = sqliteTable("dossiers", {
  id: text("id").primaryKey(),
  investigationId: text("investigation_id")
    .notNull()
    .references(() => investigations.id),
  investigationName: text("investigation_name").notNull(),
  graphVersion: text("graph_version").notNull(),
  reportVersion: text("report_version").notNull(),
  title: text("title").notNull(),
  generatedAt: text("generated_at").notNull(),
  syntheticDataOnly: integer("synthetic_data_only", { mode: "boolean" }).notNull(),
  humanVerificationRequired: integer("human_verification_required", { mode: "boolean" }).notNull(),
  aiSynthesisAvailable: integer("ai_synthesis_available", { mode: "boolean" }).notNull(),
  aiSynthesisNote: text("ai_synthesis_note").notNull(),
  sections: text("sections", { mode: "json" }).$type<unknown[]>().notNull(),
  copilotExcerpts: text("copilot_excerpts", { mode: "json" }).$type<unknown[]>().notNull(),
  limitations: text("limitations", { mode: "json" }).$type<string[]>().notNull(),
  counts: text("counts", { mode: "json" }).$type<Record<string, unknown>>().notNull(),
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
