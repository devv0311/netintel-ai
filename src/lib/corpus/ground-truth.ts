import fs from "node:fs";
import path from "node:path";

import { validateOrThrow } from "../domain/validation";

import {
  CorpusGroundTruthSchema,
  type CorpusGroundTruth,
} from "./manifest-schema";

/**
 * Loads and validates the Operation DarkNet Delhi GROUND TRUTH from
 * evidence/ground-truth/<name>.ground-truth.json.
 *
 * Per docs/data/ground-truth-spec.md §2 this is a held-out answer key,
 * not an input. This module must NEVER be reachable from the application
 * evidence path:
 *   - nothing in src/lib/db/**, src/lib/domain/**, or src/lib/corpus/load.ts
 *     imports it;
 *   - only evaluation/test code calls it, and only AFTER the pipeline has
 *     produced its output independently.
 *
 * tests/unit/corpus.test.ts asserts this boundary automatically.
 */

const GROUND_TRUTH_DIR = path.join(
  process.cwd(),
  "evidence",
  "ground-truth",
);

export function loadInvestigationGroundTruth(
  name = "operation-darknet-delhi",
): CorpusGroundTruth {
  const filePath = path.join(GROUND_TRUTH_DIR, `${name}.ground-truth.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  return validateOrThrow(
    CorpusGroundTruthSchema,
    JSON.parse(raw),
    `loadInvestigationGroundTruth(${name})`,
  );
}

export function parseGroundTruth(raw: unknown, context: string): CorpusGroundTruth {
  return validateOrThrow(CorpusGroundTruthSchema, raw, context);
}
