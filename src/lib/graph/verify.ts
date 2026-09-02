import { EVIDENCE_CLASSIFICATIONS } from "@/lib/domain/provenance";
import { RelationshipSchema, type Relationship } from "@/lib/domain/relationship";
import { validateSafe } from "@/lib/domain/validation";

import type { RelationshipCandidate } from "./build";
import { GraphServiceError } from "./errors";

/**
 * Stage: validate graph outputs — every relationship candidate must
 * pass the same Zod schema the repository enforces on write, checked
 * explicitly here (not only implicitly at insert time), mirroring
 * src/lib/resolution/verify.ts. There is nothing else to validate here:
 * locations/communication_events/financial_transactions are P5.2
 * ingestion's rows, read-only from this module's point of view.
 */
export function validateOutputs(relationshipCandidates: RelationshipCandidate[]): { relationships: Relationship[] } {
  const errors: string[] = [];

  const relationships: Relationship[] = [];
  for (const c of relationshipCandidates) {
    const result = validateSafe(RelationshipSchema, c);
    if (result.valid) relationships.push(result.data);
    else errors.push(`relationship "${c.id}": ${result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; ")}`);
  }

  if (errors.length > 0) {
    throw new GraphServiceError(
      "VALIDATION_FAILURE",
      "validate_endpoints",
      "One or more relationship candidates failed validation and were rejected.",
      errors,
    );
  }

  return { relationships };
}

/**
 * Verifies every relationship's endpoints resolve to a real, currently-
 * persisted entity OR location id (never a raw name, never an
 * invented id), that classification only ever takes a value graph
 * synthesis is allowed to assign (never algorithmic_signal/
 * investigative_lead — those belong to later milestones), and that
 * provenance is complete.
 */
export function assertProvenance(
  relationships: Relationship[],
  knownEntityIds: Set<string>,
  knownLocationIds: Set<string>,
  knownExtractedRecordIds: Set<string>,
): number {
  const problems: string[] = [];
  const allValidEndpointIds = new Set([...knownEntityIds, ...knownLocationIds]);

  const checkProvenance = (
    p: { source: string; location: string; method: string; confidence: number; processingHistory: string[] },
    what: string,
  ) => {
    if (!p.source || !p.location || !p.method) problems.push(`${what}: provenance missing source/location/method`);
    if (p.confidence < 0 || p.confidence > 1) problems.push(`${what}: provenance.confidence out of range`);
    if (!Array.isArray(p.processingHistory) || p.processingHistory.length === 0) {
      problems.push(`${what}: provenance.processingHistory is empty`);
    }
  };

  const ALLOWED_CLASSIFICATIONS = new Set(["observed_fact", "corroborated_fact", "ai_inference"]);
  for (const r of relationships) {
    checkProvenance(r.provenance, `relationship ${r.id}`);
    if (!allValidEndpointIds.has(r.sourceEntityId)) problems.push(`relationship ${r.id}: sourceEntityId does not resolve to a known entity/location`);
    if (!allValidEndpointIds.has(r.targetEntityId)) problems.push(`relationship ${r.id}: targetEntityId does not resolve to a known entity/location`);
    if (!ALLOWED_CLASSIFICATIONS.has(r.classification)) {
      problems.push(`relationship ${r.id}: classification "${r.classification}" is not permitted from graph synthesis`);
    }
    if (r.classification === "corroborated_fact" && r.evidenceItemIds.length < 2) {
      problems.push(`relationship ${r.id}: classified corroborated_fact with fewer than 2 evidence items`);
    }
    for (const recId of r.extractedRecordIds) {
      if (!knownExtractedRecordIds.has(recId)) {
        problems.push(`relationship ${r.id}: extractedRecordIds references an id not among currently-persisted extracted records`);
      }
    }
  }

  const serialized = JSON.stringify(relationships);
  for (const classification of EVIDENCE_CLASSIFICATIONS) {
    if (ALLOWED_CLASSIFICATIONS.has(classification)) continue;
    if (serialized.includes(`"classification":"${classification}"`)) {
      problems.push(`relationships contain a "${classification}" classification`);
    }
  }

  if (problems.length > 0) {
    throw new GraphServiceError("VALIDATION_FAILURE", "attach_provenance", "Provenance verification failed for one or more relationships.", problems);
  }

  return relationships.length;
}
