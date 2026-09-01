/**
 * Operation DarkNet Delhi — synthetic investigation corpus configuration.
 *
 * These constants pin the corpus to a fixed, versioned identity, per
 * docs/requirements.md §6 ("the demonstration case ... must be a fixed,
 * versioned synthetic dataset — not regenerated randomly on every run")
 * and docs/data/synthetic-investigation-spec.md §5 (stable synthetic
 * identity). For a given (CORPUS_VERSION, CORPUS_SEED) pair every part
 * of generation is deterministic: IDs, timestamps, amounts, coordinates,
 * relationships, and canonical ordering. Bumping CORPUS_VERSION is the
 * only sanctioned way to produce a different corpus; the ground truth
 * (evidence/ground-truth/) is authored against a specific version.
 *
 * This module is intentionally dependency-free so the generation script
 * (scripts/generate-corpus.ts) can import it under a bare Node runtime.
 */

export const CORPUS_NAME = "operation-darknet-delhi";

/** Bump only with a matching ground-truth re-author and a ledger note. */
export const CORPUS_VERSION = "1.0.0";

/** The single seed every pseudo-random draw in generation derives from. */
export const CORPUS_SEED = 20260901;

/**
 * The fixed "derivation instant" stamped as provenance.timestamp on every
 * structured row the loader produces. Deliberately a constant, not
 * `new Date()`, so a load is byte-reproducible (unlike the ad-hoc
 * foundation-smoke loader, which is allowed to vary per load because it
 * is not a versioned dataset).
 */
export const CORPUS_GENERATED_AT = "2026-01-01T00:00:00.000Z";

/** In-case timeline: the ~90-day window the synthetic activity spans. */
export const CASE_START = "2025-06-01T00:00:00.000Z";
export const CASE_END = "2025-09-08T00:00:00.000Z";

export const CORPUS_CURRENCY = "INR";

/**
 * Coarse Delhi-NCR bounding box. The case is named "DarkNet Delhi", so a
 * Delhi-region coordinate space is expected; every point generated
 * inside it is a generic, synthetic location with a clearly-fictional
 * label and is not tied to any real address or incident
 * (docs/requirements.md §10, docs/data/synthetic-investigation-spec.md §6).
 */
export const GEO_BBOX = {
  minLat: 28.40,
  maxLat: 28.88,
  minLng: 76.95,
  maxLng: 77.35,
} as const;

/** Volume floors carried from docs/data/synthetic-investigation-spec.md §3. */
export const REQUIRED_VOLUMES = {
  firs: 5,
  primarySuspects: 8,
  cdrs: 1000,
  financialTransactions: 500,
} as const;

/** Generation targets — set above the floors so the floors are always met. */
export const GENERATION_TARGETS = {
  cdrs: 1150,
  financialTransactions: 560,
} as const;

export const CORPUS_DESCRIPTION =
  "Operation DarkNet Delhi — a fully synthetic darknet-trafficking and " +
  "money-laundering investigation corpus. Entirely fictional; contains no " +
  "real persons, numbers, accounts, devices, locations, or case data.";
