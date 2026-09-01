import fs from "node:fs";
import path from "node:path";

import { validateOrThrow } from "@/lib/domain/validation";

import { GroundTruthFixtureSchema, type GroundTruthFixture } from "./schema";

/**
 * Loads and validates a ground-truth fixture from
 * evidence/ground-truth/fixtures/<name>.ground-truth.json.
 *
 * Per docs/data/ground-truth-spec.md §2, this loader must NEVER be
 * called from the production ingestion/persistence path — only from
 * evaluation or test code that compares system output against it
 * AFTER that output has already been produced independently. Nothing
 * in src/lib/db/ or src/lib/domain/ imports this module; see
 * tests/unit/fixtures.test.ts for an automated check of that boundary.
 */

const GROUND_TRUTH_FIXTURES_DIR = path.join(
  process.cwd(),
  "evidence",
  "ground-truth",
  "fixtures",
);

export function loadGroundTruthFixture(name: string): GroundTruthFixture {
  const filePath = path.join(GROUND_TRUTH_FIXTURES_DIR, `${name}.ground-truth.json`);
  const raw = fs.readFileSync(filePath, "utf-8");
  return validateOrThrow(
    GroundTruthFixtureSchema,
    JSON.parse(raw),
    `loadGroundTruthFixture(${name})`,
  );
}
