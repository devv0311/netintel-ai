/**
 * Operation DarkNet Delhi — synthetic investigation corpus.
 *
 * Two strictly separate layers (docs/data/ground-truth-spec.md §2):
 *
 *   APPLICATION EVIDENCE — what the pipeline may process:
 *     config, generate (deterministic generator), manifest-schema, load
 *     (loadInvestigationCorpus), persist (persistCorpus, repository-only).
 *
 *   GROUND TRUTH — the held-out answer key, evaluation only:
 *     ground-truth (loadInvestigationGroundTruth). Never imported by the
 *     application-evidence modules above.
 *
 * Shared, side-effect-free helpers: prng, canonicalize, synthetic-identifiers,
 * case-design, validate.
 */

export * from "./config";
export * from "./canonicalize";
export * from "./synthetic-identifiers";
export * from "./manifest-schema";
export {
  generateCorpus,
  generateCorpusManifest,
  generateGroundTruth,
  CORPUS_IDENTITY,
  type GeneratedCorpus,
} from "./generate";
export {
  loadInvestigationCorpus,
  materializeCorpus,
  parseCorpusManifest,
  type LoadedCorpus,
} from "./load";
export { persistCorpus, type CorpusPersistCounts } from "./persist";
export { validateCorpus, type CorpusCheck, type CorpusValidationReport } from "./validate";

// Ground truth is deliberately NOT re-exported here, to keep it off the
// convenient "import from @/lib/corpus" path. Import it explicitly from
// "@/lib/corpus/ground-truth" in evaluation/test code only.
