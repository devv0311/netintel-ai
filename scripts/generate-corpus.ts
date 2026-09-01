import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { generateCorpus } from "../src/lib/corpus/generate";
import {
  canonicalize,
  canonicalPretty,
  fingerprint,
} from "../src/lib/corpus/canonicalize";
import { validateCorpus } from "../src/lib/corpus/validate";
import { CORPUS_NAME, CORPUS_SEED, CORPUS_VERSION } from "../src/lib/corpus/config";

/**
 * Regenerates the committed Operation DarkNet Delhi corpus artifacts:
 *
 *   evidence/synthetic/operation-darknet-delhi.json            (application evidence)
 *   evidence/ground-truth/operation-darknet-delhi.ground-truth.json  (held-out key)
 *
 * Generation is a pure function of (CORPUS_VERSION, CORPUS_SEED) in
 * src/lib/corpus/config.ts — running this twice produces byte-identical
 * files. tests/unit/corpus.test.ts asserts the committed files stay in
 * sync with the generator and that the canonical fingerprints are stable.
 *
 * Run with:  npm run corpus:generate
 */

function main(): void {
  const first = generateCorpus();
  const second = generateCorpus();

  const manifestCanonical = canonicalize(first.manifest);
  const groundTruthCanonical = canonicalize(first.groundTruth);
  if (
    manifestCanonical !== canonicalize(second.manifest) ||
    groundTruthCanonical !== canonicalize(second.groundTruth)
  ) {
    throw new Error("generate-corpus: generation is not deterministic — aborting");
  }

  const report = validateCorpus(first.manifest, first.groundTruth);
  for (const check of report.checks) {
    process.stdout.write(
      `${check.ok ? "PASS" : "FAIL"}  ${check.id.padEnd(26)} ${check.name} — ${check.detail}\n`,
    );
  }
  if (!report.ok) {
    throw new Error("generate-corpus: structural validation failed — aborting");
  }

  const root = process.cwd();
  const syntheticPath = path.join(
    root,
    "evidence",
    "synthetic",
    `${CORPUS_NAME}.json`,
  );
  const groundTruthPath = path.join(
    root,
    "evidence",
    "ground-truth",
    `${CORPUS_NAME}.ground-truth.json`,
  );

  mkdirSync(path.dirname(syntheticPath), { recursive: true });
  mkdirSync(path.dirname(groundTruthPath), { recursive: true });
  writeFileSync(syntheticPath, canonicalPretty(first.manifest), "utf-8");
  writeFileSync(groundTruthPath, canonicalPretty(first.groundTruth), "utf-8");

  process.stdout.write(
    [
      "",
      `corpus:        ${CORPUS_NAME}`,
      `version:       ${CORPUS_VERSION}`,
      `seed:          ${CORPUS_SEED}`,
      `evidence items:        ${first.manifest.evidenceItems.length}`,
      `communication events:  ${first.manifest.communicationEvents.length}`,
      `financial transactions:${first.manifest.financialTransactions.length}`,
      `locations:             ${first.manifest.locations.length}`,
      `manifest fingerprint:      ${fingerprint(first.manifest)}`,
      `ground-truth fingerprint:  ${fingerprint(first.groundTruth)}`,
      `wrote ${path.relative(root, syntheticPath)}`,
      `wrote ${path.relative(root, groundTruthPath)}`,
      "",
    ].join("\n"),
  );
}

main();
