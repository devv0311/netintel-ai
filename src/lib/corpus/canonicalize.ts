import { createHash } from "node:crypto";

/**
 * Canonicalization for the deterministic-regeneration guarantee.
 *
 * `canonicalize` produces a stable JSON string for any JSON-ish value by
 * recursively sorting object keys. Array order is preserved: generation
 * emits arrays in a fixed, meaningful order, so two runs of the same
 * (version, seed) yield identical arrays already — key sorting only
 * removes any accidental key-order nondeterminism.
 *
 * `fingerprint` is the SHA-256 of the canonical form — a short, stable
 * identity for a whole corpus/ground-truth artifact, used by tests and
 * by scripts/generate-corpus.ts to prove regeneration is byte-stable.
 *
 * Dependency-free apart from node:crypto (see config.ts).
 */

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

export function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}

/** Pretty canonical JSON (sorted keys, 2-space) for committed artifact files. */
export function canonicalPretty(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2) + "\n";
}
