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
 *   L11 frozen test is a ratchet - no subject that a PREVIOUS frozen test
 *                                 contained may appear in this dataset's
 *                                 train or validation partition.
 *
 *   L12 no one-way veto feature - no feature VALUE may be a perfect
 *                                 one-way indicator of a class while
 *                                 carrying real support.
 *
 *   L13 nothing here was fitted  - no subject in THIS test partition may
 *       on before                  have contributed train or validation
 *                                  pairs to an earlier dataset.
 *
 * L12 exists because L7 provably cannot catch this class of artefact,
 * and one got through. In the P6.24 dataset `jurisdictionBothKnown` was
 * true for 0 of 222 positives and 196 of 1,216 negatives: Wikidata
 * published no jurisdiction at all, and every positive was cross-source
 * WITH Wikidata, so "both sides state a jurisdiction" meant "this pair is
 * same-source" and therefore "not a positive". The model learned it, and
 * learned it correctly for that corpus.
 *
 * L7 rates a feature by its standalone ROC-AUC and passes anything inside
 * [0.01, 0.99]. A one-way indicator that fires on 16% of one class and 0%
 * of the other scores about 0.42 — comfortably inside the band — because
 * AUC averages over the whole distribution and cannot see that one VALUE
 * of the feature is a categorical veto. That is not a tuning problem;
 * it is the wrong statistic for this failure. L12 asks the other
 * question directly: is there a value of this feature which, when
 * present in quantity, is never seen alongside one of the labels?
 *
 * L11 exists because a corpus expansion can undo a freeze without anyone
 * touching the split rule. A subject reaches TEST either by its own
 * `heldout_evaluation` designation or by contagion through its connected
 * component, and component boundaries MOVE when records are added. Five
 * subjects frozen into the P6.24 test partition by contagion fell out of
 * it the first time the v2 corpus was built, and four landed in TRAIN.
 * Nothing in L1-L10 could see that: the new split is internally
 * disjoint, and disjointness says nothing about what an EARLIER frozen
 * test contained. The freeze is a ratchet across dataset versions, and
 * this is the check that makes it one.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  buildFeatures,
  FEATURE_NAMES,
  TRAINABLE_FEATURE_NAMES,
  type FeatureRecord,
} from "@/lib/ml/features";
import { rocAuc } from "@/lib/ml/metrics";
import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

const DATASET_PATH = arg("dataset", "evidence/ml/pair-dataset.json");
const OUT_DIR = "reports/ml";
const OUT_PATH = path.join(OUT_DIR, arg("out", "leakage-audit.json"));
/**
 * Datasets whose frozen test partition this one must not have absorbed into
 * train or validation. Comma-separated; empty means there is no earlier
 * frozen test to honour, which is true only of the first dataset version.
 */
const PRIOR_DATASETS = arg("prior-datasets", "")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);

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

  // ---- L11 the frozen test is a ratchet ----------------------------------
  const nonTestSubjects = new Set<string>();
  for (const pair of dataset.pairs) {
    if (pair.partition === "test") continue;
    nonTestSubjects.add(pair.subjectA);
    nonTestSubjects.add(pair.subjectB);
  }
  const escapees: { priorDataset: string; subject: string; nowIn: string[] }[] = [];
  for (const priorPath of PRIOR_DATASETS) {
    const prior = JSON.parse(readFileSync(path.join(ROOT, priorPath), "utf8")) as Dataset;
    const priorFrozen = new Set<string>();
    for (const pair of prior.pairs) {
      if (pair.partition !== "test") continue;
      priorFrozen.add(pair.subjectA);
      priorFrozen.add(pair.subjectB);
    }
    for (const subject of priorFrozen) {
      if (!nonTestSubjects.has(subject)) continue;
      const nowIn = [
        ...new Set(
          dataset.pairs
            .filter((p) => p.partition !== "test" && (p.subjectA === subject || p.subjectB === subject))
            .map((p) => p.partition),
        ),
      ].sort();
      escapees.push({ priorDataset: priorPath, subject, nowIn });
    }
  }
  checks.push({
    id: "L11",
    name: "no subject from an earlier frozen test appears in train or validation",
    passed: escapees.length === 0,
    detail:
      PRIOR_DATASETS.length === 0
        ? "no prior dataset declared; this is the first frozen test, so there is nothing to ratchet against"
        : `${PRIOR_DATASETS.length} prior dataset(s) checked; ${escapees.length} subject(s) escaped a frozen test into train or validation`,
    evidence: escapees.slice(0, 10),
  });

  // ---- L13 nothing here was fitted on by a prior model -------------------
  //
  // L11 runs one direction: a subject an EARLIER test froze must not reach
  // THIS train or validation. L13 runs the other: a subject an earlier
  // build actually FITTED ON must not reach this test, or this test is
  // measuring memorisation and reporting generalisation.
  //
  // The two are not the same check and only one of them was here. The
  // P6.25 final test shares three subjects with the v2 dataset
  // (CIK:1534701, CIK:1610520, CIK:823094) because the builder's exclusion
  // scanned prior PAIRS while those subjects live only in v2's
  // `partitionOfSubject` map. The test survives this check because those
  // subjects carry zero v2 pairs and so were never fitted on — which is
  // the distinction that matters, and is exactly what this asserts rather
  // than assumes.
  //
  // It deliberately reports SUBJECTS FITTED ON, not subjects merely seen.
  // A check that failed on any overlap would fail the committed final test
  // over three inert sampled negatives, and the only ways to make it green
  // would be to re-cut a frozen test or to weaken the check — the first
  // silently redefines the instrument, the second removes it.
  const testSubjects = new Set<string>();
  for (const pair of dataset.pairs) {
    if (pair.partition !== "test") continue;
    testSubjects.add(pair.subjectA);
    testSubjects.add(pair.subjectB);
  }
  const fittedOn: { priorDataset: string; subject: string; fittedIn: string[] }[] = [];
  for (const priorPath of PRIOR_DATASETS) {
    const prior = JSON.parse(readFileSync(path.join(ROOT, priorPath), "utf8")) as Dataset;
    const priorFitted = new Map<string, Set<string>>();
    for (const pair of prior.pairs) {
      if (pair.partition === "test") continue;
      for (const subject of [pair.subjectA, pair.subjectB]) {
        if (!priorFitted.has(subject)) priorFitted.set(subject, new Set());
        priorFitted.get(subject)?.add(pair.partition);
      }
    }
    for (const [subject, partitions] of priorFitted) {
      if (!testSubjects.has(subject)) continue;
      fittedOn.push({ priorDataset: priorPath, subject, fittedIn: [...partitions].sort() });
    }
  }
  // Scope: this is binding on a FROZEN TEST — a dataset that is one test
  // partition and nothing else — because that is the only artifact that
  // claims to measure generalisation to unseen data.
  //
  // It is NOT binding on a training dataset's held-out partition, which
  // never made that claim. v2's held-out partition legitimately contains
  // subjects the P6.24 build fitted on; P6.25 documented that it had
  // stopped being an untouched exam and built the final test precisely
  // because of it. Failing v2 here would assert an invariant v2 never
  // held, so the number is reported instead of enforced — and the number
  // is worth reporting, because it quantifies exactly how much of that
  // partition an earlier model had already seen.
  const isFrozenTest = dataset.pairs.every((p) => p.partition === "test");
  checks.push({
    id: "L13",
    name: isFrozenTest
      ? "no subject in this frozen test was fitted on by an earlier build"
      : "subjects in this held-out partition that an earlier build fitted on (reported, not enforced)",
    passed: isFrozenTest ? fittedOn.length === 0 : true,
    detail:
      PRIOR_DATASETS.length === 0
        ? "no prior dataset declared; nothing could have been fitted on before this one"
        : isFrozenTest
          ? `${PRIOR_DATASETS.length} prior dataset(s) checked; ${fittedOn.length} subject(s) in this FROZEN TEST contributed train or validation pairs to an earlier dataset`
          : `${PRIOR_DATASETS.length} prior dataset(s) checked; ${fittedOn.length} subject(s) in this held-out partition were fitted on by an earlier build. NOT a failure: this is a training dataset's held-out partition, not a frozen test. It is the measured reason the P6.25 final test exists.`,
    evidence: fittedOn.slice(0, 10),
  });

  // ---- L12 no one-way veto feature ---------------------------------------
  //
  // Only the TRAIN partition is examined: this asks what the model could
  // have learned, and the model sees train.
  const MIN_SUPPORT = 30;
  const trainFeatureRows = trainVectors;
  const vetoes: {
    feature: string;
    value: number;
    support: number;
    positives: number;
    negatives: number;
    reading: string;
  }[] = [];
  // Audited over the TRAINABLE set: this asks what a model fitted by this
  // build could learn, and a feature excluded from training cannot be
  // learned from at all. Features already excluded are listed separately
  // rather than silently dropped, so the exclusion stays visible.
  FEATURE_NAMES.forEach((feature, index) => {
    if (!(TRAINABLE_FEATURE_NAMES as readonly string[]).includes(feature)) return;
    // Binary features only. A continuous feature taking one exact value
    // across a large support is a different phenomenon and would be noise
    // here; L7 covers the continuous case.
    const distinct = new Set(trainFeatureRows.map((row) => row.values[index] as number));
    if (distinct.size !== 2 || ![...distinct].every((v) => v === 0 || v === 1)) return;
    for (const value of [0, 1]) {
      const matching = trainFeatureRows.filter((row) => row.values[index] === value);
      if (matching.length < MIN_SUPPORT) continue;
      const positives = matching.filter((row) => row.label === 1).length;
      const negatives = matching.length - positives;
      if (positives !== 0 && negatives !== 0) continue;
      vetoes.push({
        feature,
        value,
        support: matching.length,
        positives,
        negatives,
        reading:
          positives === 0
            ? `${feature}=${value} occurs ${matching.length} times in TRAIN and NEVER alongside a positive — the model can read it as a veto`
            : `${feature}=${value} occurs ${matching.length} times in TRAIN and NEVER alongside a negative — the model can read it as a guarantee`,
      });
    }
  });
  const excludedFeatures = FEATURE_NAMES.filter(
    (name) => !(TRAINABLE_FEATURE_NAMES as readonly string[]).includes(name),
  );
  checks.push({
    id: "L12",
    name: "no trainable feature value is a perfect one-way indicator with real support",
    passed: vetoes.length === 0,
    detail:
      (vetoes.length === 0
        ? `every trainable binary feature value with at least ${MIN_SUPPORT} TRAIN rows occurs alongside BOTH labels`
        : `${vetoes.length} trainable feature value(s) never co-occur with one of the labels despite at least ${MIN_SUPPORT} TRAIN rows`) +
      (excludedFeatures.length > 0
        ? `; ${excludedFeatures.length} feature(s) are excluded from training and therefore unlearnable: ${excludedFeatures.join(", ")}`
        : ""),
    evidence: vetoes,
  });

  const passed = checks.every((check) => check.passed);
  const report = {
    audit: "P6.24.2 leakage gate",
    dataset: { id: dataset.datasetId, version: dataset.datasetVersion, path: DATASET_PATH },
    priorFrozenTestsHonoured: PRIOR_DATASETS,
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
