import type { Alias, Entity } from "@/lib/domain/entity";
import type { CorroborationFinding } from "@/lib/domain/corroboration";
import type { AnalyticalSignal } from "@/lib/domain/derived";
import type { EvidenceItem } from "@/lib/domain/evidence";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Location } from "@/lib/domain/location";
import type { Provenance } from "@/lib/domain/provenance";
import type { Relationship } from "@/lib/domain/relationship";
import type { ResolutionDecision } from "@/lib/domain/resolution";

/**
 * The system side of the evaluation: everything the pipeline persisted,
 * read back through the validated repository.
 *
 * The evaluator never re-runs a pipeline stage to obtain a value it
 * wants to score. It reads what was written, exactly as an auditor
 * would, so a metric can never be computed from a different code path
 * than the one the application actually uses.
 */
export interface SystemSnapshot {
  entities: Entity[];
  aliases: Alias[];
  locations: Location[];
  evidenceItems: EvidenceItem[];
  extractedRecords: ExtractedRecord[];
  resolutionDecisions: ResolutionDecision[];
  relationships: Relationship[];
  analyticalSignals: AnalyticalSignal[];
  corroborationFindings: CorroborationFinding[];
}

export async function loadSystemSnapshot(): Promise<SystemSnapshot> {
  const repo = await import("@/lib/db/repository");
  const [
    entities,
    aliases,
    locations,
    evidenceItems,
    extractedRecords,
    resolutionDecisions,
    relationships,
    analyticalSignals,
    corroborationFindings,
  ] = await Promise.all([
    repo.listEntities(),
    repo.listAliases(),
    repo.listLocations(),
    repo.listEvidenceItems(),
    repo.listExtractedRecords(),
    repo.listResolutionDecisions(),
    repo.listRelationships(),
    repo.listAnalyticalSignals(),
    repo.listCorroborationFindings(),
  ]);
  return {
    entities,
    aliases,
    locations,
    evidenceItems,
    extractedRecords,
    resolutionDecisions,
    relationships,
    analyticalSignals,
    corroborationFindings,
  };
}

/** One person mention the system extracted, with everything needed to score it. */
export interface PersonMention {
  /** The extracted_records row id. */
  recordId: string;
  /** Corpus record ref, parsed from provenance.location (`ref#fieldPath`). */
  recordRef: string;
  /** The field within that record, e.g. `accused[0]`. */
  fieldPath: string;
  /** The name string the source actually carried. */
  observedName: string | null;
  /** The canonical entity the resolver assigned this mention to, if any. */
  canonicalEntityId: string | null;
}

/** Splits `${recordRef}#${fieldPath}` as written by src/lib/extraction/extract.ts. */
export function splitProvenanceLocation(location: string): {
  recordRef: string;
  fieldPath: string;
} {
  const hash = location.indexOf("#");
  if (hash < 0) return { recordRef: location, fieldPath: "" };
  return { recordRef: location.slice(0, hash), fieldPath: location.slice(hash + 1) };
}

function readString(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Every person mention the extractor produced, joined to the canonical
 * entity entity-resolution assigned it to.
 *
 * The join goes through resolution_decisions.extracted_record_ids —
 * the resolver's own audit trail — not through name similarity. A
 * mention with no decision keeps `canonicalEntityId: null` and is
 * reported as unclustered rather than being invented into a singleton,
 * because "the resolver never saw this" and "the resolver made it a
 * singleton" are different failures and must not be merged.
 */
export function collectPersonMentions(snapshot: SystemSnapshot): PersonMention[] {
  const entityByRecordId = new Map<string, string>();
  for (const decision of snapshot.resolutionDecisions) {
    for (const recordId of decision.extractedRecordIds) {
      entityByRecordId.set(recordId, decision.canonicalEntityId);
    }
  }
  const mentions: PersonMention[] = [];
  for (const record of snapshot.extractedRecords) {
    if (record.recordType !== "entity_mention") continue;
    if (readString(record.data, "mentionKind") !== "person") continue;
    const { recordRef, fieldPath } = splitProvenanceLocation(record.provenance.location);
    mentions.push({
      recordId: record.id,
      recordRef,
      fieldPath,
      observedName: readString(record.data, "observedValue"),
      canonicalEntityId: entityByRecordId.get(record.id) ?? null,
    });
  }
  return mentions;
}

/** Rows that must carry the six provenance fields (docs/requirements.md §8). */
export interface ProvenanceBearingRow {
  table: string;
  id: string;
  provenance: Provenance;
}

export function collectProvenanceBearingRows(
  snapshot: SystemSnapshot,
): ProvenanceBearingRow[] {
  const rows: ProvenanceBearingRow[] = [];
  const push = (table: string, items: { id: string; provenance: Provenance }[]) => {
    for (const item of items) rows.push({ table, id: item.id, provenance: item.provenance });
  };
  push("extracted_records", snapshot.extractedRecords);
  push("entities", snapshot.entities);
  push("aliases", snapshot.aliases);
  push("locations", snapshot.locations);
  push("relationships", snapshot.relationships);
  push("resolution_decisions", snapshot.resolutionDecisions);
  push("analytical_signals", snapshot.analyticalSignals);
  push("corroboration_findings", snapshot.corroborationFindings);
  return rows;
}
