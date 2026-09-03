import { CorroborationFindingSchema, type CorroborationFinding } from "@/lib/domain/corroboration";
import { validateSafe } from "@/lib/domain/validation";

import type { CorroborationFindingCandidate } from "./build";
import { CorroborationServiceError } from "./errors";

/**
 * Stage: validate corroboration outputs — every finding candidate must
 * pass the same Zod schema the repository enforces on write, checked
 * explicitly here (not only implicitly at insert time), mirroring
 * src/lib/analytics/verify.ts.
 */
export function validateOutputs(candidates: CorroborationFindingCandidate[]): { findings: CorroborationFinding[] } {
  const errors: string[] = [];
  const findings: CorroborationFinding[] = [];
  for (const c of candidates) {
    const result = validateSafe(CorroborationFindingSchema, c);
    if (result.valid) findings.push(result.data);
    else
      errors.push(
        `finding "${c.id}": ${result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; ")}`,
      );
  }
  if (errors.length > 0) {
    throw new CorroborationServiceError(
      "VALIDATION_FAILURE",
      "validate_findings",
      "One or more corroboration findings failed validation and were rejected.",
      errors,
    );
  }
  return { findings };
}

/**
 * Verifies that every finding's subject entities and anchor locations
 * resolve to real, currently-persisted rows; that every cited evidence
 * item id resolves to a real persisted `evidence_items` row (the
 * "source evidence item(s)" provenance requirement); that every finding
 * is classified either `algorithmic_signal` or `corroborated_fact` and
 * never `observed_fact`/`ai_inference`/`investigative_lead`
 * (docs/requirements.md §7); that a `corroborated_fact` cites ≥2
 * distinct evidence items; and that every finding is stamped with the
 * exact graph version this run analyzed.
 */
export function assertProvenance(
  findings: CorroborationFinding[],
  knownEntityIds: Set<string>,
  knownLocationIds: Set<string>,
  knownEvidenceItemIds: Set<string>,
  expectedGraphVersion: string,
): number {
  const problems: string[] = [];

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

  for (const f of findings) {
    checkProvenance(f.provenance, `finding ${f.id}`);
    if (f.classification !== "algorithmic_signal" && f.classification !== "corroborated_fact") {
      problems.push(`finding ${f.id}: classification "${f.classification}" is not permitted from corroboration synthesis`);
    }
    if (f.graphVersion !== expectedGraphVersion) {
      problems.push(`finding ${f.id}: graphVersion "${f.graphVersion}" does not match the graph version this run analyzed`);
    }
    for (const entId of f.entityIds) {
      if (!knownEntityIds.has(entId)) problems.push(`finding ${f.id}: entityId "${entId}" does not resolve to a known entity`);
    }
    for (const locId of f.locationIds) {
      if (!knownLocationIds.has(locId)) {
        problems.push(`finding ${f.id}: locationId "${locId}" does not resolve to a known location`);
      }
    }
    if (f.evidenceItemIds.length === 0) problems.push(`finding ${f.id}: cites no source evidence item`);
    for (const evId of f.evidenceItemIds) {
      if (!knownEvidenceItemIds.has(evId)) {
        problems.push(`finding ${f.id}: evidenceItemId "${evId}" does not resolve to a persisted evidence item`);
      }
    }
    if (f.classification === "corroborated_fact" && f.evidenceItemIds.length < 2) {
      problems.push(`finding ${f.id}: classified corroborated_fact with fewer than 2 evidence items`);
    }
    if (f.findingType === "spatiotemporal_contradiction" && f.classification !== "algorithmic_signal") {
      problems.push(`finding ${f.id}: a contradiction must be an algorithmic_signal`);
    }
  }

  const serialized = JSON.stringify(findings);
  for (const forbidden of ["observed_fact", "ai_inference", "investigative_lead"]) {
    if (serialized.includes(`"classification":"${forbidden}"`)) {
      problems.push(`corroboration findings contain a "${forbidden}" classification`);
    }
  }

  if (problems.length > 0) {
    throw new CorroborationServiceError(
      "VALIDATION_FAILURE",
      "attach_provenance",
      "Provenance verification failed for one or more corroboration findings.",
      problems,
    );
  }

  return findings.length;
}
