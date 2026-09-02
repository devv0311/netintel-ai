import { AliasSchema, EntitySchema, type Alias, type Entity } from "@/lib/domain/entity";
import { ResolutionDecisionSchema, type ResolutionDecision } from "@/lib/domain/resolution";
import { EVIDENCE_CLASSIFICATIONS } from "@/lib/domain/provenance";
import { validateSafe } from "@/lib/domain/validation";

import { ResolutionServiceError } from "./errors";
import type { AliasCandidate, DecisionCandidate, EntityCandidate } from "./resolve";

/**
 * Stage: validate resolution outputs — every candidate must pass the
 * same Zod schema the repository enforces on write, checked explicitly
 * here (not only implicitly at insert time), mirroring
 * src/lib/extraction/verify.ts.
 */
export function validateOutputs(
  entityCandidates: EntityCandidate[],
  aliasCandidates: AliasCandidate[],
  decisionCandidates: DecisionCandidate[],
): { entities: Entity[]; aliases: Alias[]; decisions: ResolutionDecision[] } {
  const errors: string[] = [];

  const entities: Entity[] = [];
  for (const c of entityCandidates) {
    const result = validateSafe(EntitySchema, c);
    if (result.valid) entities.push(result.data);
    else errors.push(`entity "${c.canonicalLabel}": ${result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; ")}`);
  }

  const aliases: Alias[] = [];
  for (const c of aliasCandidates) {
    const result = validateSafe(AliasSchema, c);
    if (result.valid) aliases.push(result.data);
    else errors.push(`alias "${c.aliasValue}": ${result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; ")}`);
  }

  const decisions: ResolutionDecision[] = [];
  for (const c of decisionCandidates) {
    const result = validateSafe(ResolutionDecisionSchema, c);
    if (result.valid) decisions.push(result.data);
    else errors.push(`resolution decision for ${c.extractedRecordIds.join(",")}: ${result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; ")}`);
  }

  if (errors.length > 0) {
    throw new ResolutionServiceError(
      "VALIDATION_FAILURE",
      "validate_decisions",
      "One or more resolution outputs failed validation and were rejected.",
      errors,
    );
  }

  return { entities, aliases, decisions };
}

/**
 * Stage: attach & verify provenance — prove every entity/alias/decision
 * traces to a real extracted record, carries complete provenance, and
 * that every resolution decision is classified exactly "ai_inference"
 * (docs/requirements.md §7 — an entity-resolution conclusion is never
 * an Observed Fact, however deterministic the rule that produced it).
 */
export function assertProvenance(
  entities: Entity[],
  aliases: Alias[],
  decisions: ResolutionDecision[],
  extractedRecordIds: Set<string>,
): number {
  const problems: string[] = [];
  const entityIds = new Set(entities.map((e) => e.id));

  const checkProvenance = (p: { source: string; location: string; method: string; confidence: number; processingHistory: string[] }, what: string) => {
    if (!p.source || !p.location || !p.method) problems.push(`${what}: provenance missing source/location/method`);
    if (p.confidence < 0 || p.confidence > 1) problems.push(`${what}: provenance.confidence out of range`);
    if (!Array.isArray(p.processingHistory) || p.processingHistory.length === 0) {
      problems.push(`${what}: provenance.processingHistory is empty`);
    }
  };

  for (const e of entities) checkProvenance(e.provenance, `entity ${e.id}`);
  for (const a of aliases) {
    checkProvenance(a.provenance, `alias ${a.id}`);
    if (!entityIds.has(a.entityId)) problems.push(`alias ${a.id}: entityId does not resolve to a created entity`);
  }
  for (const d of decisions) {
    checkProvenance(d.provenance, `decision ${d.id}`);
    if (!entityIds.has(d.canonicalEntityId)) {
      problems.push(`decision ${d.id}: canonicalEntityId does not resolve to a created entity`);
    }
    for (const recId of d.extractedRecordIds) {
      if (!extractedRecordIds.has(recId)) {
        problems.push(`decision ${d.id}: extractedRecordIds references an id not among the currently-persisted extracted records`);
      }
    }
    if (d.classification !== "ai_inference") {
      problems.push(`decision ${d.id}: classified "${d.classification}", must be "ai_inference"`);
    }
    if (d.status === "ambiguous" && d.candidateEntityIds.length < 2) {
      problems.push(`decision ${d.id}: status "ambiguous" but fewer than 2 candidate entities recorded`);
    }
  }

  const serialized = JSON.stringify(decisions);
  for (const classification of EVIDENCE_CLASSIFICATIONS) {
    if (classification === "ai_inference") continue;
    if (serialized.includes(`"classification":"${classification}"`)) {
      problems.push(`resolution decisions contain a "${classification}" classification`);
    }
  }

  if (problems.length > 0) {
    throw new ResolutionServiceError(
      "VALIDATION_FAILURE",
      "attach_provenance",
      "Provenance verification failed for one or more resolution outputs.",
      problems,
    );
  }

  return entities.length + aliases.length + decisions.length;
}
