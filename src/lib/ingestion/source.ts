import fs from "node:fs";
import path from "node:path";

import { CORPUS_NAME } from "@/lib/corpus/config";

import { IngestionServiceError } from "./errors";
import type { IngestionSourceInput } from "./types";

/**
 * Stage 1–2: resolve the ingestion source and produce raw, parsed JSON
 * ready for schema validation. Two supported inputs, one representation:
 *
 *   - builtin-corpus: reads the committed P5.1 corpus at
 *     evidence/synthetic/<CORPUS_NAME>.json.
 *   - uploaded: a JSON value already parsed by the caller (the route
 *     handler parses the request body). We re-check it is object-shaped
 *     and looks like a corpus manifest, not something else.
 *
 * The builtin path only ever points at evidence/synthetic/. It has no
 * branch that can reach evidence/ground-truth/.
 */

export const BUILTIN_CORPUS_RELATIVE_PATH = path.join(
  "evidence",
  "synthetic",
  `${CORPUS_NAME}.json`,
);

/** Keys that only appear in the held-out ground-truth answer key. */
const GROUND_TRUTH_MARKER_KEYS = [
  "expectedEntityMerges",
  "hiddenConnections",
  "moneyMulePaths",
  "intendedConclusions",
  "expectedCopilotAnswers",
  "expectedCommunities",
  "doNotMerge",
];

export interface ResolvedSource {
  /** Short label shown in the UI ("Operation DarkNet Delhi (built-in corpus)"). */
  label: string;
  /** The raw parsed JSON, pre-schema-validation. */
  raw: unknown;
}

export function resolveSource(input: IngestionSourceInput): ResolvedSource {
  if (input.kind === "builtin-corpus") {
    const abs = path.join(process.cwd(), BUILTIN_CORPUS_RELATIVE_PATH);
    let text: string;
    try {
      text = fs.readFileSync(abs, "utf-8");
    } catch {
      throw new IngestionServiceError(
        "INVALID_FIXTURE",
        "file_validation",
        "The built-in synthetic corpus file could not be read. Re-generate it with `npm run corpus:generate`.",
      );
    }
    return { label: "Operation DarkNet Delhi (built-in synthetic corpus)", raw: parseJson(text) };
  }

  // uploaded
  const raw = input.contents;
  assertLooksLikeCorpusManifest(raw);
  return {
    label: input.filename
      ? `Uploaded corpus (${input.filename})`
      : "Uploaded corpus",
    raw,
  };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new IngestionServiceError(
      "INVALID_FIXTURE",
      "file_validation",
      "The evidence file is not valid JSON.",
    );
  }
}

/**
 * Cheap shape gate before the full Zod pass — and, critically, the point
 * where a ground-truth artifact is rejected with a clear, specific code
 * rather than a generic schema failure.
 */
export function assertLooksLikeCorpusManifest(raw: unknown): void {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new IngestionServiceError(
      "INVALID_FIXTURE",
      "file_validation",
      "The evidence file must be a JSON object describing a corpus manifest.",
    );
  }
  const obj = raw as Record<string, unknown>;

  const groundTruthKey = GROUND_TRUTH_MARKER_KEYS.find((k) => k in obj);
  if (groundTruthKey) {
    throw new IngestionServiceError(
      "GROUND_TRUTH_REJECTED",
      "file_validation",
      "This file is a held-out ground-truth answer key, not investigation evidence. Ground truth must never enter the ingestion path.",
      [`contains ground-truth-only field: ${groundTruthKey}`],
    );
  }

  if (!("corpus" in obj) || !("evidenceItems" in obj)) {
    throw new IngestionServiceError(
      "INVALID_FIXTURE",
      "file_validation",
      "The file does not look like a corpus manifest (missing `corpus` and/or `evidenceItems`).",
    );
  }
}
