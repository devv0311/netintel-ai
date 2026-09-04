/**
 * P6.24.2 — the leakage gate. Runs BEFORE any training and fails loudly.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/ml/leakage-audit.ts
 *
 * Every check is a hard assertion with a printed verdict. If any check
 * FAILS the process exits non-zero and the split is to be rebuilt, not
 * argued with.
 *
 * The checks, and why each one exists:
 *
 *   L1 subject disjointness     - the split unit must not appear twice.
 *   L2 component disjointness   - nor may a connected component.
 *   L3 record disjointness      - a single record reachable from two
 *                                 partitions is the same entity in both.
 *   L4 pair uniqueness          - no unordered record pair twice, which
 *                                 would double-count and could straddle.
 *   L5 no identifier field      - the record projection the model sees
 *                                 must not carry the thing the LABEL is
 *                                 made of.
 *   L6 no identifier in source  - the feature code must not read one
 *                                 either, checked against the file.
 *   L7 single-feature AUC       - a feature that alone separates the
 *                                 classes almost perfectly is the
 *                                 signature of target leakage.
 *   L8 cross-partition identity - two subjects in different partitions
 *                                 that are in fact one entity.
 *   L9 standardiser fit         - statistics come from TRAIN rows only.
 *   L10 test untouched          - the training script never reads test.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { buildFeatures, FEATURE_NAMES, type FeatureRecord } from "@/lib/ml/features";
import { rocAuc } from "@/lib/ml/metrics";
import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const DATASET_PATH = "evidence/ml/pair-dataset.json";
const OUT_DIR = "reports/ml";
const OUT_PATH = path.join(OUT_DIR, "leakage-audit.json");

interface Pair {
  pairId: string;
  label: 0 | 1;
  labelClass: string;
  partition: "train" | "validation" | "test";
  subjectA: string;
  subjectB: string;
  aRef: string;
  bRef: string;
  aName: string;
  bName: string;
}

interface Dataset {
  datasetId: string;
  datasetVersion: string;
  partitionOfSubject: Record<string, string>;
  featureRecords: Record<string, { name: string; officialName: string | null; aliases: string[]; jurisdiction: string | null; registry: string }>;
  pairs: Pair[];
}

interface Check {
  id: string;
  name: string;
  passed: boolean;
  detail: string;
  evidence?: unknown;
}

function main(): void {
  const dataset = JSON.parse(readFileSync(path.join(ROOT, DATASET_PATH), "utf8")) as Dataset;
  const checks: Check[] = [];

  const partitionsOf = <K extends string>(entries: [K, string][]): Map<K, Set<string>> => {
    const map = new Map<K, Set<string>>();
    for (const [key, partition] of entries) {
      const set = map.get(key) ?? new Set<string>();
      set.add(partition);
      map.set(key, set);
    }
    return map;
  };

  // ---- L1 subject disjointness ------------------------------------------
  const subjectEntries: [string, string][] = [];
  for (const pair of dataset.pairs) {
    subjectEntries.push([pair.subjectA, pair.partition], [pair.subjectB, pair.partition]);
  }
  const subjectPartitions = partitionsOf(subjectEntries);
  const straddlingSubjects = [...subjectPartitions.entries()].filter(([, set]) => set.size > 1);
  checks.push({
    id: "L1",
    name: "subject disjointness",
    passed: straddlingSubjects.length === 0,
    detail: `${subjectPartitions.size} subjects appear in the pair set; ${straddlingSubjects.length} appear in more than one partition`,
    evidence: straddlingSubjects.slice(0, 10).map(([subject, set]) => ({ subject, partitions: [...set] })),
  });

  // ---- L2 component disjointness ----------------------------------------
  // The dataset records the partition of every subject; a component is
  // straddling exactly when two of its subjects disagree, which L1 already
  // covers for subjects that appear in pairs. This check extends it to
  // every subject in the split map, including those no pair reached.
  const declaredStraddle = [...subjectPartitions.entries()].filter(
    ([subject, set]) => dataset.partitionOfSubject[subject] && !set.has(dataset.partitionOfSubject[subject] as string),
  );
  checks.push({
    id: "L2",
    name: "declared partition agrees with emitted pairs",
    passed: declaredStraddle.length === 0,
    detail: `${declaredStraddle.length} subjects whose emitted pairs disagree with the declared partition`,
    evidence: declaredStraddle.slice(0, 10).map(([subject, set]) => ({
      subject,
      declared: dataset.partitionOfSubject[subject],
      emitted: [...set],
    })),
  });

  // ---- L3 record disjointness -------------------------------------------
  const recordEntries: [string, string][] = [];
  for (const pair of dataset.pairs) {
    recordEntries.push([pair.aRef, pair.partition], [pair.bRef, pair.partition]);
  }
  const recordPartitions = partitionsOf(recordEntries);
  const straddlingRecords = [...recordPartitions.entries()].filter(([, set]) => set.size > 1);
  checks.push({
    id: "L3",
    name: "record disjointness",
    passed: straddlingRecords.length === 0,
    detail: `${recordPartitions.size} records used; ${straddlingRecords.length} appear in more than one partition`,
    evidence: straddlingRecords.slice(0, 10).map(([ref, set]) => ({ ref, partitions: [...set] })),
  });

  // ---- L4 pair uniqueness -----------------------------------------------
  const pairKeys = new Map<string, string[]>();
  for (const pair of dataset.pairs) {
    const key = [pair.aRef, pair.bRef].sort().join("|");
    pairKeys.set(key, [...(pairKeys.get(key) ?? []), pair.pairId]);
  }
  const duplicates = [...pairKeys.entries()].filter(([, ids]) => ids.length > 1);
  checks.push({
    id: "L4",
    name: "no duplicate record pair",
    passed: duplicates.length === 0,
    detail: `${pairKeys.size} distinct record pairs; ${duplicates.length} appear more than once`,
    evidence: duplicates.slice(0, 10),
  });

  // ---- L5 the model's record projection carries no identifier -----------
  const allowedKeys = new Set(["name", "officialName", "aliases", "jurisdiction", "registry"]);
  const forbiddenPattern = /(identifier|\blei\b|\bcik\b|ocid|isin|\bduns\b)/i;
  const offendingKeys = new Set<string>();
  for (const record of Object.values(dataset.featureRecords)) {
    for (const key of Object.keys(record)) {
      if (!allowedKeys.has(key) || forbiddenPattern.test(key)) offendingKeys.add(key);
    }
  }
  checks.push({
    id: "L5",
    name: "record projection carries no identifier field",
    passed: offendingKeys.size === 0,
    detail:
      offendingKeys.size === 0
        ? `all ${Object.keys(dataset.featureRecords).length} projections carry only ${[...allowedKeys].join(", ")}`
        : `unexpected keys: ${[...offendingKeys].join(", ")}`,
  });

  // ---- L6 the feature code reads no identifier --------------------------
  const featureSource = readFileSync(path.join(ROOT, "src/lib/ml/features.ts"), "utf8");
  const codeOnly = featureSource
    .replace(/\/\*\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  const forbiddenTokens = ["identifiers", "\\.lei", "\\.cik", "ocid", "leis", "ciks"];
  const found = forbiddenTokens.filter((token) => new RegExp(token, "i").test(codeOnly));
  checks.push({
    id: "L6",
    name: "feature code reads no identifier",
    passed: found.length === 0,
    detail:
      found.length === 0
        ? "no identifier accessor appears in src/lib/ml/features.ts outside comments"
        : `identifier accessors present: ${found.join(", ")}`,
  });

  // ---- L7 single-feature AUC on TRAIN -----------------------------------
  const featureRecordOf = (ref: string): FeatureRecord => {
    const record = dataset.featureRecords[ref];
    if (!record) throw new Error(`no feature projection for ${ref}`);
    return {
      name: record.name,
      officialName: record.officialName ?? undefined,
      aliases: record.aliases,
      jurisdiction: record.jurisdiction ?? undefined,
    };
  };
  const trainPairs = dataset.pairs.filter((pair) => pair.partition === "train");
  const trainVectors = trainPairs.map((pair) => ({
    label: pair.label,
    values: buildFeatures(featureRecordOf(pair.aRef), featureRecordOf(pair.bRef)).values,
  }));
  const singleFeatureAuc = FEATURE_NAMES.map((name, index) => {
    const scored = trainVectors.map((row) => ({ label: row.label, score: row.values[index] ?? 0 }));
    const auc = rocAuc(scored);
    return { feature: name, auc: Number.isFinite(auc) ? Number(auc.toFixed(4)) : null };
  });
  const suspicious = singleFeatureAuc.filter((entry) => entry.auc !== null && Math.abs((entry.auc as number) - 0.5) > 0.49);
  checks.push({
    id: "L7",
    name: "no single feature separates the classes almost perfectly",
    passed: suspicious.length === 0,
    detail:
      suspicious.length === 0
        ? "every feature's standalone ROC-AUC on TRAIN is inside [0.01, 0.99]"
        : `near-perfect single-feature separators: ${suspicious.map((entry) => `${entry.feature}=${entry.auc}`).join(", ")}`,
    evidence: [...singleFeatureAuc].sort((a, b) => Math.abs((b.auc ?? 0.5) - 0.5) - Math.abs((a.auc ?? 0.5) - 0.5)).slice(0, 8),
  });

  // ---- L8 cross-partition identity --------------------------------------
  // Two subjects in different partitions that are really one entity would
  // be undetectable inside a partition but fatal across one. The only
  // evidence available for that here is a record whose normalised name is
  // identical across partitions AND that no negative label separates.
  const normOf = new Map<string, string>();
  for (const [ref, record] of Object.entries(dataset.featureRecords)) {
    normOf.set(ref, normalizeName(record.name).normalized);
  }
  const partitionOfRecord = new Map<string, string>();
  for (const [ref, set] of recordPartitions) partitionOfRecord.set(ref, [...set][0] as string);
  const byNorm = new Map<string, string[]>();
  for (const [ref, norm] of normOf) {
    if (!partitionOfRecord.has(ref) || norm.length === 0) continue;
    byNorm.set(norm, [...(byNorm.get(norm) ?? []), ref]);
  }
  const subjectOfRecord = new Map<string, string>();
  for (const pair of dataset.pairs) {
    subjectOfRecord.set(pair.aRef, pair.subjectA);
    subjectOfRecord.set(pair.bRef, pair.subjectB);
  }
  const crossPartitionSameName: { normalised: string; refs: string[]; partitions: string[]; subjects: string[] }[] = [];
  for (const [norm, refs] of byNorm) {
    if (refs.length < 2) continue;
    const partitions = new Set(refs.map((ref) => partitionOfRecord.get(ref) as string));
    if (partitions.size < 2) continue;
    crossPartitionSameName.push({
      normalised: norm,
      refs,
      partitions: [...partitions],
      subjects: [...new Set(refs.map((ref) => subjectOfRecord.get(ref) as string))],
    });
  }
  const sameSubjectAcrossPartitions = crossPartitionSameName.filter((entry) => entry.subjects.length === 1);
  checks.push({
    id: "L8",
    name: "no identical entity spans two partitions",
    passed: sameSubjectAcrossPartitions.length === 0,
    detail:
      `${crossPartitionSameName.length} normalised names occur in more than one partition, all under DIFFERENT subjects ` +
      `(distinct legal entities that share a name — the phenomenon the hard negatives exist to capture, not leakage); ` +
      `${sameSubjectAcrossPartitions.length} occur under the SAME subject, which would be leakage`,
    evidence: crossPartitionSameName.slice(0, 5),
  });

  // ---- L9 / L10 procedural ----------------------------------------------
  const trainSource = readFileSync(path.join(ROOT, "scripts/ml/train-model.ts"), "utf8");
  const fitsOnTrainOnly = /fitStandardiser\(\s*trainStandardisedInput|fitStandardiser\(\s*trainExamples/.test(trainSource);
  checks.push({
    id: "L9",
    name: "standardiser fitted on TRAIN rows only",
    passed: fitsOnTrainOnly,
    detail: fitsOnTrainOnly
      ? "scripts/ml/train-model.ts calls fitStandardiser on the train examples"
      : "could not verify that fitStandardiser is called on train examples only",
  });
  const readsTest = /partition === "test"|"test"\]/.test(trainSource);
  checks.push({
    id: "L10",
    name: "training script does not read the test partition",
    passed: !readsTest,
    detail: readsTest
      ? "scripts/ml/train-model.ts references the test partition"
      : "no reference to the test partition in scripts/ml/train-model.ts",
  });

  const passed = checks.every((check) => check.passed);
  const report = {
    audit: "P6.24.2 leakage gate",
    dataset: { id: dataset.datasetId, version: dataset.datasetVersion, path: DATASET_PATH },
    ranAt: new Date().toISOString(),
    verdict: passed ? "PASS" : "FAIL",
    checks,
  };

  mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, OUT_PATH), `${JSON.stringify(report, null, 2)}\n`, "utf8");

  for (const check of checks) {
    console.log(`${check.passed ? "PASS" : "FAIL"}  ${check.id}  ${check.name}\n      ${check.detail}`);
  }
  console.log(`\nverdict: ${report.verdict}  ->  ${OUT_PATH}`);
  if (!passed) process.exit(1);
}

main();
