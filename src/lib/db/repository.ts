import { eq } from "drizzle-orm";

import { getDb } from "./client";
import * as schema from "./schema";
import { validateOrThrow, type Provenance } from "@/lib/domain";
import {
  InvestigationSchema,
  type Investigation,
} from "@/lib/domain/investigation";
import {
  EvidenceSourceSchema,
  EvidenceItemSchema,
  type EvidenceSource,
  type EvidenceItem,
} from "@/lib/domain/evidence";
import { ExtractedRecordSchema, type ExtractedRecord } from "@/lib/domain/extraction";
import { EntitySchema, AliasSchema, type Entity, type Alias } from "@/lib/domain/entity";
import { LocationSchema, type Location } from "@/lib/domain/location";
import {
  CommunicationEventSchema,
  FinancialTransactionSchema,
  type CommunicationEvent,
  type FinancialTransaction,
} from "@/lib/domain/events";
import { RelationshipSchema, type Relationship } from "@/lib/domain/relationship";
import {
  AnalyticalSignalSchema,
  AIInferenceSchema,
  InvestigativeLeadSchema,
  type AnalyticalSignal,
  type AIInference,
  type InvestigativeLead,
} from "@/lib/domain/derived";
import {
  ResolutionDecisionSchema,
  type ResolutionDecision,
} from "@/lib/domain/resolution";
import {
  CorroborationFindingSchema,
  type CorroborationFinding,
} from "@/lib/domain/corroboration";
import { DossierSchema, type Dossier } from "@/lib/domain/dossier";

/**
 * The validated data-access layer. This is the ONLY place application
 * code should read or write the tables in ./schema.ts — every function
 * here validates its input before writing and validates every row
 * before returning it, per this milestone's brief: "malformed
 * structured data must fail explicitly... no invalid AI-derived
 * structure may silently enter the domain layer." A malformed insert
 * throws (via validateOrThrow); a corrupted row read back from disk
 * throws too, rather than being handed to a caller unchecked.
 */

// --- app_meta (small key/value store, created in P4.1) ---------------

/**
 * Reads a single `app_meta` value, or null if the key is unset. Used by
 * the ingestion layer to record a completion marker per corpus version
 * (src/lib/ingestion/marker.ts) — never for domain evidence.
 */
export async function getAppMeta(key: string): Promise<string | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.appMeta)
    .where(eq(schema.appMeta.key, key));
  return rows[0]?.value ?? null;
}

/** Upserts a single `app_meta` value. */
export async function setAppMeta(key: string, value: string): Promise<void> {
  const db = getDb();
  await db
    .insert(schema.appMeta)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.appMeta.key,
      set: { value, updatedAt: new Date() },
    });
}

function provenanceToColumns(p: Provenance) {
  return {
    provenanceSource: p.source,
    provenanceLocation: p.location,
    provenanceMethod: p.method,
    provenanceConfidence: p.confidence,
    provenanceProcessingHistory: p.processingHistory,
    provenanceTimestamp: p.timestamp,
  };
}

function columnsToProvenance(row: {
  provenanceSource: string;
  provenanceLocation: string;
  provenanceMethod: string;
  provenanceConfidence: number;
  provenanceProcessingHistory: string[];
  provenanceTimestamp: string;
}): Provenance {
  return {
    source: row.provenanceSource,
    location: row.provenanceLocation,
    method: row.provenanceMethod,
    confidence: row.provenanceConfidence,
    processingHistory: row.provenanceProcessingHistory,
    timestamp: row.provenanceTimestamp,
  };
}

// --- Investigations --------------------------------------------------

export async function insertInvestigation(data: unknown): Promise<Investigation> {
  const investigation = validateOrThrow(InvestigationSchema, data, "insertInvestigation");
  const db = getDb();
  await db.insert(schema.investigations).values(investigation);
  return investigation;
}

export async function listInvestigations(): Promise<Investigation[]> {
  const db = getDb();
  const rows = await db.select().from(schema.investigations);
  return rows.map((row) => validateOrThrow(InvestigationSchema, row, "listInvestigations"));
}

// --- Evidence sources / items -----------------------------------------

export async function insertEvidenceSource(data: unknown): Promise<EvidenceSource> {
  const source = validateOrThrow(EvidenceSourceSchema, data, "insertEvidenceSource");
  const db = getDb();
  await db.insert(schema.evidenceSources).values(source);
  return source;
}

export async function listEvidenceSources(): Promise<EvidenceSource[]> {
  const db = getDb();
  const rows = await db.select().from(schema.evidenceSources);
  return rows.map((row) => validateOrThrow(EvidenceSourceSchema, row, "listEvidenceSources"));
}

export async function insertEvidenceItem(data: unknown): Promise<EvidenceItem> {
  const item = validateOrThrow(EvidenceItemSchema, data, "insertEvidenceItem");
  const db = getDb();
  await db.insert(schema.evidenceItems).values({
    ...item,
    rejectionReason: item.rejectionReason ?? null,
  });
  return item;
}

export async function listEvidenceItems(): Promise<EvidenceItem[]> {
  const db = getDb();
  const rows = await db.select().from(schema.evidenceItems);
  return rows.map((row) =>
    validateOrThrow(
      EvidenceItemSchema,
      { ...row, rejectionReason: row.rejectionReason ?? undefined },
      "listEvidenceItems",
    ),
  );
}

// --- Extracted records ---------------------------------------------

export async function insertExtractedRecord(data: unknown): Promise<ExtractedRecord> {
  const record = validateOrThrow(ExtractedRecordSchema, data, "insertExtractedRecord");
  const db = getDb();
  await db.insert(schema.extractedRecords).values({
    id: record.id,
    evidenceItemId: record.evidenceItemId,
    recordType: record.recordType,
    data: record.data,
    classification: record.classification,
    ...provenanceToColumns(record.provenance),
  });
  return record;
}

export async function listExtractedRecords(): Promise<ExtractedRecord[]> {
  const db = getDb();
  const rows = await db.select().from(schema.extractedRecords);
  return rows.map((row) =>
    validateOrThrow(
      ExtractedRecordSchema,
      {
        id: row.id,
        evidenceItemId: row.evidenceItemId,
        recordType: row.recordType,
        data: row.data,
        classification: row.classification,
        provenance: columnsToProvenance(row),
      },
      "listExtractedRecords",
    ),
  );
}

// --- Entities / aliases ------------------------------------------------

export async function insertEntity(data: unknown): Promise<Entity> {
  const entity = validateOrThrow(EntitySchema, data, "insertEntity");
  const db = getDb();
  await db.insert(schema.entities).values({
    id: entity.id,
    investigationId: entity.investigationId,
    kind: entity.kind,
    canonicalLabel: entity.canonicalLabel,
    attributes: entity.attributes,
    ...provenanceToColumns(entity.provenance),
  });
  return entity;
}

export async function listEntities(): Promise<Entity[]> {
  const db = getDb();
  const rows = await db.select().from(schema.entities);
  return rows.map((row) =>
    validateOrThrow(
      EntitySchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        kind: row.kind,
        canonicalLabel: row.canonicalLabel,
        attributes: row.attributes,
        provenance: columnsToProvenance(row),
      },
      "listEntities",
    ),
  );
}

export async function insertAlias(data: unknown): Promise<Alias> {
  const alias = validateOrThrow(AliasSchema, data, "insertAlias");
  const db = getDb();
  await db.insert(schema.aliases).values({
    id: alias.id,
    entityId: alias.entityId,
    aliasValue: alias.aliasValue,
    ...provenanceToColumns(alias.provenance),
  });
  return alias;
}

export async function listAliases(): Promise<Alias[]> {
  const db = getDb();
  const rows = await db.select().from(schema.aliases);
  return rows.map((row) =>
    validateOrThrow(
      AliasSchema,
      {
        id: row.id,
        entityId: row.entityId,
        aliasValue: row.aliasValue,
        provenance: columnsToProvenance(row),
      },
      "listAliases",
    ),
  );
}

export async function listAliasesForEntity(entityId: string): Promise<Alias[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.aliases)
    .where(eq(schema.aliases.entityId, entityId));
  return rows.map((row) =>
    validateOrThrow(
      AliasSchema,
      {
        id: row.id,
        entityId: row.entityId,
        aliasValue: row.aliasValue,
        provenance: columnsToProvenance(row),
      },
      "listAliasesForEntity",
    ),
  );
}

// --- Locations -----------------------------------------------------

export async function insertLocation(data: unknown): Promise<Location> {
  const location = validateOrThrow(LocationSchema, data, "insertLocation");
  const db = getDb();
  await db.insert(schema.locations).values({
    id: location.id,
    investigationId: location.investigationId,
    label: location.label,
    locationType: location.locationType,
    latitude: location.latitude,
    longitude: location.longitude,
    ...provenanceToColumns(location.provenance),
  });
  return location;
}

export async function listLocations(): Promise<Location[]> {
  const db = getDb();
  const rows = await db.select().from(schema.locations);
  return rows.map((row) =>
    validateOrThrow(
      LocationSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        label: row.label,
        locationType: row.locationType,
        latitude: row.latitude,
        longitude: row.longitude,
        provenance: columnsToProvenance(row),
      },
      "listLocations",
    ),
  );
}

// --- Communication events / financial transactions --------------------

export async function insertCommunicationEvent(
  data: unknown,
): Promise<CommunicationEvent> {
  const event = validateOrThrow(
    CommunicationEventSchema,
    data,
    "insertCommunicationEvent",
  );
  const db = getDb();
  await db.insert(schema.communicationEvents).values({
    id: event.id,
    investigationId: event.investigationId,
    callerPhone: event.callerPhone,
    calleePhone: event.calleePhone,
    callerEntityId: event.callerEntityId ?? null,
    calleeEntityId: event.calleeEntityId ?? null,
    occurredAt: event.occurredAt,
    durationSeconds: event.durationSeconds,
    cellLocationId: event.cellLocationId ?? null,
    ...provenanceToColumns(event.provenance),
  });
  return event;
}

export async function listCommunicationEvents(): Promise<CommunicationEvent[]> {
  const db = getDb();
  const rows = await db.select().from(schema.communicationEvents);
  return rows.map((row) =>
    validateOrThrow(
      CommunicationEventSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        callerPhone: row.callerPhone,
        calleePhone: row.calleePhone,
        callerEntityId: row.callerEntityId ?? undefined,
        calleeEntityId: row.calleeEntityId ?? undefined,
        occurredAt: row.occurredAt,
        durationSeconds: row.durationSeconds,
        cellLocationId: row.cellLocationId ?? undefined,
        provenance: columnsToProvenance(row),
      },
      "listCommunicationEvents",
    ),
  );
}

export async function insertFinancialTransaction(
  data: unknown,
): Promise<FinancialTransaction> {
  const tx = validateOrThrow(
    FinancialTransactionSchema,
    data,
    "insertFinancialTransaction",
  );
  const db = getDb();
  await db.insert(schema.financialTransactions).values({
    id: tx.id,
    investigationId: tx.investigationId,
    fromAccountEntityId: tx.fromAccountEntityId ?? null,
    toAccountEntityId: tx.toAccountEntityId ?? null,
    amount: tx.amount,
    currency: tx.currency,
    occurredAt: tx.occurredAt,
    ...provenanceToColumns(tx.provenance),
  });
  return tx;
}

export async function listFinancialTransactions(): Promise<FinancialTransaction[]> {
  const db = getDb();
  const rows = await db.select().from(schema.financialTransactions);
  return rows.map((row) =>
    validateOrThrow(
      FinancialTransactionSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        fromAccountEntityId: row.fromAccountEntityId ?? undefined,
        toAccountEntityId: row.toAccountEntityId ?? undefined,
        amount: row.amount,
        currency: row.currency,
        occurredAt: row.occurredAt,
        provenance: columnsToProvenance(row),
      },
      "listFinancialTransactions",
    ),
  );
}

// --- Relationships ---------------------------------------------------

export async function insertRelationship(data: unknown): Promise<Relationship> {
  const relationship = validateOrThrow(RelationshipSchema, data, "insertRelationship");
  const db = getDb();
  await db.insert(schema.relationships).values({
    id: relationship.id,
    investigationId: relationship.investigationId,
    sourceEntityId: relationship.sourceEntityId,
    targetEntityId: relationship.targetEntityId,
    relationshipType: relationship.relationshipType,
    directed: relationship.directed,
    evidenceItemIds: relationship.evidenceItemIds,
    extractedRecordIds: relationship.extractedRecordIds,
    conflicts: relationship.conflicts,
    attributes: relationship.attributes,
    classification: relationship.classification,
    ...provenanceToColumns(relationship.provenance),
  });
  return relationship;
}

export async function listRelationships(): Promise<Relationship[]> {
  const db = getDb();
  const rows = await db.select().from(schema.relationships);
  return rows.map((row) =>
    validateOrThrow(
      RelationshipSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        sourceEntityId: row.sourceEntityId,
        targetEntityId: row.targetEntityId,
        relationshipType: row.relationshipType,
        directed: row.directed,
        evidenceItemIds: row.evidenceItemIds,
        extractedRecordIds: row.extractedRecordIds,
        conflicts: row.conflicts,
        attributes: row.attributes,
        classification: row.classification,
        provenance: columnsToProvenance(row),
      },
      "listRelationships",
    ),
  );
}

/** Filters in memory, consistent with the dataset scale and the existing listAliasesForEntity precedent. */
export async function listRelationshipsForEntity(entityId: string): Promise<Relationship[]> {
  const all = await listRelationships();
  return all.filter((r) => r.sourceEntityId === entityId || r.targetEntityId === entityId);
}

// --- Resolution decisions ----------------------------------------------

export async function insertResolutionDecision(data: unknown): Promise<ResolutionDecision> {
  const decision = validateOrThrow(ResolutionDecisionSchema, data, "insertResolutionDecision");
  const db = getDb();
  await db.insert(schema.resolutionDecisions).values({
    id: decision.id,
    investigationId: decision.investigationId,
    canonicalEntityId: decision.canonicalEntityId,
    extractedRecordIds: decision.extractedRecordIds,
    resolutionType: decision.resolutionType,
    status: decision.status,
    candidateEntityIds: decision.candidateEntityIds,
    conflicts: decision.conflicts,
    reason: decision.reason,
    classification: decision.classification,
    ...provenanceToColumns(decision.provenance),
  });
  return decision;
}

export async function listResolutionDecisions(): Promise<ResolutionDecision[]> {
  const db = getDb();
  const rows = await db.select().from(schema.resolutionDecisions);
  return rows.map((row) =>
    validateOrThrow(
      ResolutionDecisionSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        canonicalEntityId: row.canonicalEntityId,
        extractedRecordIds: row.extractedRecordIds,
        resolutionType: row.resolutionType,
        status: row.status,
        candidateEntityIds: row.candidateEntityIds,
        conflicts: row.conflicts,
        reason: row.reason,
        classification: row.classification,
        provenance: columnsToProvenance(row),
      },
      "listResolutionDecisions",
    ),
  );
}

// --- Analytical signals / AI inferences / investigative leads ---------

export async function insertAnalyticalSignal(data: unknown): Promise<AnalyticalSignal> {
  const signal = validateOrThrow(AnalyticalSignalSchema, data, "insertAnalyticalSignal");
  const db = getDb();
  await db.insert(schema.analyticalSignals).values({
    id: signal.id,
    investigationId: signal.investigationId,
    graphVersion: signal.graphVersion,
    targetEntityId: signal.targetEntityId ?? null,
    signalType: signal.signalType,
    value: signal.value,
    method: signal.method,
    explanation: signal.explanation,
    classification: signal.classification,
    ...provenanceToColumns(signal.provenance),
  });
  return signal;
}

export async function listAnalyticalSignals(): Promise<AnalyticalSignal[]> {
  const db = getDb();
  const rows = await db.select().from(schema.analyticalSignals);
  return rows.map((row) =>
    validateOrThrow(
      AnalyticalSignalSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        graphVersion: row.graphVersion,
        targetEntityId: row.targetEntityId ?? undefined,
        signalType: row.signalType,
        value: row.value,
        method: row.method,
        explanation: row.explanation,
        classification: row.classification,
        provenance: columnsToProvenance(row),
      },
      "listAnalyticalSignals",
    ),
  );
}

// --- Corroboration findings (P5.7) -----------------------------------

export async function insertCorroborationFinding(data: unknown): Promise<CorroborationFinding> {
  const finding = validateOrThrow(CorroborationFindingSchema, data, "insertCorroborationFinding");
  const db = getDb();
  await db.insert(schema.corroborationFindings).values({
    id: finding.id,
    investigationId: finding.investigationId,
    graphVersion: finding.graphVersion,
    findingType: finding.findingType,
    kind: finding.kind,
    entityIds: finding.entityIds,
    locationIds: finding.locationIds,
    windowStart: finding.window?.start ?? null,
    windowEnd: finding.window?.end ?? null,
    value: finding.value,
    method: finding.method,
    explanation: finding.explanation,
    classification: finding.classification,
    evidenceItemIds: finding.evidenceItemIds,
    supportingRecordIds: finding.supportingRecordIds,
    ...provenanceToColumns(finding.provenance),
  });
  return finding;
}

export async function listCorroborationFindings(): Promise<CorroborationFinding[]> {
  const db = getDb();
  const rows = await db.select().from(schema.corroborationFindings);
  return rows.map((row) =>
    validateOrThrow(
      CorroborationFindingSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        graphVersion: row.graphVersion,
        findingType: row.findingType,
        kind: row.kind,
        entityIds: row.entityIds,
        locationIds: row.locationIds,
        window: row.windowStart
          ? { start: row.windowStart, ...(row.windowEnd ? { end: row.windowEnd } : {}) }
          : null,
        value: row.value,
        method: row.method,
        explanation: row.explanation,
        classification: row.classification,
        evidenceItemIds: row.evidenceItemIds,
        supportingRecordIds: row.supportingRecordIds,
        provenance: columnsToProvenance(row),
      },
      "listCorroborationFindings",
    ),
  );
}

export async function insertDossier(data: unknown): Promise<Dossier> {
  const dossier = validateOrThrow(DossierSchema, data, "insertDossier");
  const db = getDb();
  await db.insert(schema.dossiers).values({
    id: dossier.id,
    investigationId: dossier.investigationId,
    investigationName: dossier.investigationName,
    graphVersion: dossier.graphVersion,
    reportVersion: dossier.reportVersion,
    title: dossier.title,
    generatedAt: dossier.generatedAt,
    syntheticDataOnly: dossier.syntheticDataOnly,
    humanVerificationRequired: dossier.humanVerificationRequired,
    aiSynthesisAvailable: dossier.aiSynthesisAvailable,
    aiSynthesisNote: dossier.aiSynthesisNote,
    sections: dossier.sections,
    copilotExcerpts: dossier.copilotExcerpts,
    limitations: dossier.limitations,
    counts: dossier.counts,
    ...provenanceToColumns(dossier.provenance),
  });
  return dossier;
}

function rowToDossier(row: typeof schema.dossiers.$inferSelect, context: string): Dossier {
  return validateOrThrow(
    DossierSchema,
    {
      id: row.id,
      investigationId: row.investigationId,
      investigationName: row.investigationName,
      graphVersion: row.graphVersion,
      reportVersion: row.reportVersion,
      title: row.title,
      generatedAt: row.generatedAt,
      syntheticDataOnly: row.syntheticDataOnly,
      humanVerificationRequired: row.humanVerificationRequired,
      aiSynthesisAvailable: row.aiSynthesisAvailable,
      aiSynthesisNote: row.aiSynthesisNote,
      sections: row.sections,
      copilotExcerpts: row.copilotExcerpts,
      limitations: row.limitations,
      counts: row.counts,
      provenance: columnsToProvenance(row),
    },
    context,
  );
}

export async function listDossiers(): Promise<Dossier[]> {
  const db = getDb();
  const rows = await db.select().from(schema.dossiers);
  return rows.map((row) => rowToDossier(row, "listDossiers"));
}

export async function getDossierById(id: string): Promise<Dossier | null> {
  const db = getDb();
  const rows = await db.select().from(schema.dossiers).where(eq(schema.dossiers.id, id));
  const row = rows[0];
  return row ? rowToDossier(row, "getDossierById") : null;
}

export async function insertAIInference(data: unknown): Promise<AIInference> {
  const inference = validateOrThrow(AIInferenceSchema, data, "insertAIInference");
  const db = getDb();
  await db.insert(schema.aiInferences).values({
    id: inference.id,
    investigationId: inference.investigationId,
    claim: inference.claim,
    basedOn: inference.basedOn,
    confidence: inference.confidence,
    classification: inference.classification,
    ...provenanceToColumns(inference.provenance),
  });
  return inference;
}

export async function listAIInferences(): Promise<AIInference[]> {
  const db = getDb();
  const rows = await db.select().from(schema.aiInferences);
  return rows.map((row) =>
    validateOrThrow(
      AIInferenceSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        claim: row.claim,
        basedOn: row.basedOn,
        confidence: row.confidence,
        classification: row.classification,
        provenance: columnsToProvenance(row),
      },
      "listAIInferences",
    ),
  );
}

export async function insertInvestigativeLead(data: unknown): Promise<InvestigativeLead> {
  const lead = validateOrThrow(InvestigativeLeadSchema, data, "insertInvestigativeLead");
  const db = getDb();
  await db.insert(schema.investigativeLeads).values({
    id: lead.id,
    investigationId: lead.investigationId,
    suggestion: lead.suggestion,
    relatedEntityIds: lead.relatedEntityIds,
    classification: lead.classification,
    ...provenanceToColumns(lead.provenance),
  });
  return lead;
}

export async function listInvestigativeLeads(): Promise<InvestigativeLead[]> {
  const db = getDb();
  const rows = await db.select().from(schema.investigativeLeads);
  return rows.map((row) =>
    validateOrThrow(
      InvestigativeLeadSchema,
      {
        id: row.id,
        investigationId: row.investigationId,
        suggestion: row.suggestion,
        relatedEntityIds: row.relatedEntityIds,
        classification: row.classification,
        provenance: columnsToProvenance(row),
      },
      "listInvestigativeLeads",
    ),
  );
}
