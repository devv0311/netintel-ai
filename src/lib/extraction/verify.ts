import type { EvidenceItem } from "@/lib/domain/evidence";
import { ExtractedRecordSchema, type ExtractedRecord } from "@/lib/domain/extraction";
import { EVIDENCE_CLASSIFICATIONS } from "@/lib/domain/provenance";
import { validateSafe } from "@/lib/domain/validation";

import { ExtractionServiceError } from "./errors";
import type { ExtractedRecordCandidate } from "./extract";

/**
 * Stage 4 — validate extracted records: every candidate must pass the
 * same Zod schema the repository enforces on write, checked explicitly
 * here (rather than only implicitly at insert time) so a malformed
 * record is reported per-item and the run halts with real detail,
 * matching src/lib/ingestion/normalize.ts's pattern for its own
 * invariant checks.
 */
export function validateCandidates(candidates: ExtractedRecordCandidate[]): ExtractedRecord[] {
  const records: ExtractedRecord[] = [];
  const errors: string[] = [];

  for (const candidate of candidates) {
    const result = validateSafe(ExtractedRecordSchema, candidate);
    if (result.valid) {
      records.push(result.data);
    } else {
      errors.push(
        `extracted record for evidence item ${candidate.evidenceItemId}: ` +
          result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`).join("; "),
      );
    }
  }

  if (errors.length > 0) {
    throw new ExtractionServiceError(
      "VALIDATION_FAILURE",
      "validate_records",
      "One or more extracted records failed validation and were rejected.",
      errors,
    );
  }

  return records;
}

/**
 * Stage 5 — attach & verify provenance: prove every extracted record
 * traces to a real, currently-persisted evidence item, carries a
 * complete provenance object, and is classified exactly "observed_fact"
 * — extraction must never emit a corroborated fact, algorithmic signal,
 * AI inference, or investigative lead (docs/requirements.md §7); those
 * are later stages' outputs.
 */
export function assertProvenance(records: ExtractedRecord[], evidenceItems: EvidenceItem[]): number {
  const itemIds = new Set(evidenceItems.map((i) => i.id));
  const problems: string[] = [];

  for (const record of records) {
    const p = record.provenance;
    if (!p.source || !itemIds.has(p.source)) {
      problems.push(`${record.id}: provenance.source does not resolve to a source evidence item`);
    }
    if (!p.location || !p.method) {
      problems.push(`${record.id}: provenance missing location/method`);
    }
    if (p.confidence < 0 || p.confidence > 1) {
      problems.push(`${record.id}: provenance.confidence out of range`);
    }
    if (!Array.isArray(p.processingHistory) || p.processingHistory.length === 0) {
      problems.push(`${record.id}: provenance.processingHistory is empty`);
    }
    if (record.classification !== "observed_fact") {
      problems.push(
        `${record.id}: extraction output classified as "${record.classification}", must be "observed_fact"`,
      );
    }
  }

  const serialized = JSON.stringify(records);
  for (const classification of EVIDENCE_CLASSIFICATIONS) {
    if (classification === "observed_fact") continue;
    if (serialized.includes(`"classification":"${classification}"`)) {
      problems.push(`extraction output contains a "${classification}" classification`);
    }
  }

  if (problems.length > 0) {
    throw new ExtractionServiceError(
      "VALIDATION_FAILURE",
      "attach_provenance",
      "Provenance verification failed for one or more extracted records.",
      problems,
    );
  }

  return records.length;
}
