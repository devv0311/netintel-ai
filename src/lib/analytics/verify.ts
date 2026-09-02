import { AnalyticalSignalSchema, type AnalyticalSignal } from "@/lib/domain/derived";
import { validateSafe } from "@/lib/domain/validation";

import type { AnalyticalSignalCandidate } from "./build";
import { AnalyticsServiceError } from "./errors";

/**
 * Stage: validate analytics outputs — every signal candidate must pass
 * the same Zod schema the repository enforces on write, checked
 * explicitly here (not only implicitly at insert time), mirroring
 * src/lib/graph/verify.ts.
 */
export function validateOutputs(candidates: AnalyticalSignalCandidate[]): { signals: AnalyticalSignal[] } {
  const errors: string[] = [];
  const signals: AnalyticalSignal[] = [];
  for (const c of candidates) {
    const result = validateSafe(AnalyticalSignalSchema, c);
    if (result.valid) signals.push(result.data);
    else errors.push(`signal "${c.id}": ${result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; ")}`);
  }
  if (errors.length > 0) {
    throw new AnalyticsServiceError("VALIDATION_FAILURE", "validate_signals", "One or more analytical signals failed validation and were rejected.", errors);
  }
  return { signals };
}

/**
 * Verifies every signal's target entity (when present) resolves to a
 * real, currently-persisted node id — an `entity` OR a `location` (the
 * analysis graph includes both as nodes, so centrality/bridge/ranking
 * signals are legitimately computed for locations too, not only
 * entities) — that every signal is classified exactly
 * "algorithmic_signal" (docs/requirements.md §7 — a topology
 * calculation is never itself a claim about the world, however
 * structurally significant), that every signal is stamped with the
 * expected graph version, and that provenance is complete.
 */
export function assertProvenance(
  signals: AnalyticalSignal[],
  knownEntityIds: Set<string>,
  knownLocationIds: Set<string>,
  expectedGraphVersion: string,
): number {
  const knownNodeIds = new Set([...knownEntityIds, ...knownLocationIds]);
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

  for (const s of signals) {
    checkProvenance(s.provenance, `signal ${s.id}`);
    if (s.classification !== "algorithmic_signal") {
      problems.push(`signal ${s.id}: classification "${s.classification}" is not permitted from analytics synthesis`);
    }
    if (s.graphVersion !== expectedGraphVersion) {
      problems.push(`signal ${s.id}: graphVersion "${s.graphVersion}" does not match the graph version this run analyzed`);
    }
    if (s.targetEntityId && !knownNodeIds.has(s.targetEntityId)) {
      problems.push(`signal ${s.id}: targetEntityId does not resolve to a known entity or location`);
    }
  }

  const serialized = JSON.stringify(signals);
  for (const forbidden of ["observed_fact", "corroborated_fact", "ai_inference", "investigative_lead"]) {
    if (serialized.includes(`"classification":"${forbidden}"`)) {
      problems.push(`analytical signals contain a "${forbidden}" classification`);
    }
  }

  if (problems.length > 0) {
    throw new AnalyticsServiceError("VALIDATION_FAILURE", "attach_provenance", "Provenance verification failed for one or more analytical signals.", problems);
  }

  return signals.length;
}
