import { CorpusManifestSchema, type CorpusManifest } from "@/lib/corpus/manifest-schema";
import { materializeCorpus, type LoadedCorpus } from "@/lib/corpus/load";
import { CORPUS_GENERATED_AT } from "@/lib/corpus/config";
import { DomainValidationError } from "@/lib/domain/validation";
import { EVIDENCE_CLASSIFICATIONS } from "@/lib/domain/provenance";

import { IngestionServiceError, summarizeZodIssues } from "./errors";

/**
 * Stages 3–6: schema validation → normalization → deterministic-ID
 * assignment → provenance attachment, with each invariant actively
 * verified (not assumed) so a regression surfaces as a structured
 * ingestion error rather than a silently bad row.
 *
 * Normalization is `materializeCorpus` from src/lib/corpus — the same
 * loader P5.1 uses. It preserves original evidence identity, source
 * reference, source location, evidence type, timestamps, structured
 * `content`, and validation state; it assigns deterministic
 * content-addressed IDs; it attaches full provenance to every structured
 * row. It invents nothing.
 */

const ID_PREFIXES = {
  investigation: "investigation_",
  evidenceSource: "evidence_source_",
  evidenceItem: "evidence_item_",
  location: "location_",
  communicationEvent: "communication_event_",
  financialTransaction: "financial_transaction_",
} as const;

export function validateCorpusSchema(raw: unknown): CorpusManifest {
  const result = CorpusManifestSchema.safeParse(raw);
  if (result.success) return result.data;

  const issues = summarizeZodIssues(result.error.issues);
  const mentionsItemType = result.error.issues.some((i) =>
    i.path.map(String).join(".").includes("itemType"),
  );
  if (mentionsItemType) {
    throw new IngestionServiceError(
      "UNSUPPORTED_EVIDENCE_TYPE",
      "schema_validation",
      "The corpus contains an evidence item whose type is not one of the supported evidence types.",
      issues,
    );
  }
  throw new IngestionServiceError(
    "MALFORMED_EVIDENCE",
    "schema_validation",
    "The corpus does not match the evidence schema and cannot be ingested.",
    issues,
  );
}

export function normalizeCorpus(manifest: CorpusManifest): LoadedCorpus {
  try {
    return materializeCorpus(manifest);
  } catch (err) {
    if (err instanceof DomainValidationError) {
      throw new IngestionServiceError(
        "VALIDATION_FAILURE",
        "normalization",
        "A normalized evidence record failed domain validation and was rejected.",
        err.issues.map((i) => `${i.path?.join(".") ?? "(root)"}: ${i.message}`),
      );
    }
    console.error("[ingestion] normalization failure", err);
    throw new IngestionServiceError(
      "VALIDATION_FAILURE",
      "normalization",
      "Normalization of the corpus into the domain model failed.",
    );
  }
}

/** Stage 5: prove every id is a deterministic content-addressed id. */
export function assertDeterministicIds(loaded: LoadedCorpus): number {
  const problems: string[] = [];
  const checkPrefix = (id: string, prefix: string, what: string) => {
    if (!id.startsWith(prefix)) problems.push(`${what} id "${id}" is not content-addressed`);
  };
  const checkUnique = (ids: string[], what: string) => {
    if (new Set(ids).size !== ids.length) problems.push(`${what} contains duplicate ids`);
  };

  checkPrefix(loaded.investigation.id, ID_PREFIXES.investigation, "investigation");
  loaded.evidenceSources.forEach((s) => checkPrefix(s.id, ID_PREFIXES.evidenceSource, "evidence source"));
  loaded.evidenceItems.forEach((i) => checkPrefix(i.id, ID_PREFIXES.evidenceItem, "evidence item"));
  loaded.locations.forEach((l) => checkPrefix(l.id, ID_PREFIXES.location, "location"));
  loaded.communicationEvents.forEach((c) => checkPrefix(c.id, ID_PREFIXES.communicationEvent, "communication event"));
  loaded.financialTransactions.forEach((t) => checkPrefix(t.id, ID_PREFIXES.financialTransaction, "financial transaction"));

  checkUnique(loaded.evidenceItems.map((i) => i.id), "evidence items");
  checkUnique(loaded.evidenceSources.map((s) => s.id), "evidence sources");
  checkUnique(loaded.locations.map((l) => l.id), "locations");
  checkUnique(loaded.communicationEvents.map((c) => c.id), "communication events");
  checkUnique(loaded.financialTransactions.map((t) => t.id), "financial transactions");

  if (problems.length > 0) {
    throw new IngestionServiceError(
      "VALIDATION_FAILURE",
      "id_assignment",
      "Deterministic ID assignment produced an unexpected id shape.",
      problems,
    );
  }

  return (
    1 +
    loaded.evidenceSources.length +
    loaded.evidenceItems.length +
    loaded.locations.length +
    loaded.communicationEvents.length +
    loaded.financialTransactions.length
  );
}

/**
 * Stage 6: prove every structured row carries full provenance that
 * traces back to a real source evidence item, that ingestion output is
 * NOT classified as AI inference, and that source evidence is retained
 * as accepted (not silently marked rejected).
 */
export function assertProvenance(loaded: LoadedCorpus): number {
  const problems: string[] = [];
  const itemIds = new Set(loaded.evidenceItems.map((i) => i.id));
  let provenancedRows = 0;

  const checkProvenance = (
    p: {
      source: string;
      location: string;
      method: string;
      confidence: number;
      processingHistory: string[];
      timestamp: string;
    },
    what: string,
  ) => {
    provenancedRows += 1;
    if (!p.source || !itemIds.has(p.source)) {
      problems.push(`${what}: provenance.source does not resolve to a source evidence item`);
    }
    if (!p.location || !p.method) problems.push(`${what}: provenance missing location/method`);
    if (p.confidence < 0 || p.confidence > 1) problems.push(`${what}: provenance.confidence out of range`);
    if (!Array.isArray(p.processingHistory) || p.processingHistory.length === 0) {
      problems.push(`${what}: provenance.processingHistory is empty`);
    }
    if (p.timestamp !== CORPUS_GENERATED_AT) {
      problems.push(`${what}: provenance.timestamp is not the fixed corpus instant`);
    }
  };

  loaded.locations.forEach((l) => checkProvenance(l.provenance, "location"));
  loaded.communicationEvents.forEach((c) => checkProvenance(c.provenance, "communication event"));
  loaded.financialTransactions.forEach((t) => checkProvenance(t.provenance, "financial transaction"));

  // Source evidence items keep their identity and validation state.
  loaded.evidenceItems.forEach((i) => {
    if (i.validationStatus !== "accepted") {
      problems.push(`evidence item ${i.id}: validationStatus is not "accepted"`);
    }
  });

  // Ingestion output must never be labelled AI inference (or any derived
  // classification): it is source evidence and its 1:1 normalized form.
  const serialized = JSON.stringify(loaded);
  for (const classification of EVIDENCE_CLASSIFICATIONS) {
    if (classification === "observed_fact" || classification === "corroborated_fact") continue;
    if (serialized.includes(`"classification":"${classification}"`)) {
      problems.push(`normalized output contains a "${classification}" classification`);
    }
  }

  if (problems.length > 0) {
    throw new IngestionServiceError(
      "VALIDATION_FAILURE",
      "provenance",
      "Provenance verification failed for the normalized corpus.",
      problems,
    );
  }

  return provenancedRows;
}
