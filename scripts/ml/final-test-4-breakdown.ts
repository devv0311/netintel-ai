/**
 * P6.28 — the comparison table for frozen test #4, derived from ONE scoring
 * run per model.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/ml/final-test-4-breakdown.ts
 *
 * This script scores nothing. It reads the two evaluation reports and the two
 * error tables that `evaluate-model.ts` already wrote, plus the dataset, and
 * assembles the slices the P6.28 declaration requires. That constraint is the
 * point: "scored once" has to mean once, so every slice here is reconstructed
 * as `positives in slice − false splits in slice` rather than by re-running a
 * model over the test with a new filter each time a question occurs to someone.
 *
 * The slices the declaration names and the evaluation report does not already
 * carry are the last three: legal-form-sensitive pairs, the Latvian
 * `sabiedrība` case P6.27 pre-registered as a known limitation, and the
 * corporate-family versus wholly-unrelated split of the false merges.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const read = <T,>(p: string): T => JSON.parse(readFileSync(path.join(ROOT, p), "utf8")) as T;

interface Rec { name: string; officialName: string | null; aliases: string[]; jurisdiction: string | null; registry: string }
interface Pair {
  pairId: string; label: 0 | 1; labelClass: string; labelBasis?: string;
  partition: string; aRef: string; bRef: string; sourcePairing?: string;
  variation: string | null;
}
interface Dataset { datasetId: string; datasetVersion: string; featureRecords: Record<string, Rec>; pairs: Pair[] }
interface Metrics {
  truePositives: number; falsePositives: number; trueNegatives: number; falseNegatives: number;
  threshold: number; precision: number; recall: number; f1: number; falseMergeRate: number; falseSplitRate: number;
}
interface Evaluation {
  artifact: { path: string; modelVersion: string; experimentId: string; modelKind: string; decisionThreshold: number };
  heldOut: { pairs: number; positives: number; negatives: number; curatedHardNegatives: number; minedHardNegatives: number; sampledNegatives: number; subjects: number };
  headline: { model: Metrics; deterministicBaseline: Metrics };
  breakdowns: { dimension: string; slices: Record<string, { positives: number; model: number; modelPct: string; deterministic: number; deterministicPct: string }> }[];
  errorCategoryCounts: Record<string, number>;
}
interface ErrorRow { pairId: string; truth: string; prediction: string; score: number; labelClass: string; labelBasis: string; failureCategory: string; sources: string; fields: Record<string, string | null> }
interface ErrorReport { totalErrors: number; rows: ErrorRow[] }

const DATASET = "evidence/ml/pair-dataset-final-test-4.json";
const MODELS = [
  { tag: "v2", label: "shipped v2 (LR, 26 features)", evaluation: "reports/ml/final-test-4-evaluation-v2.json", errors: "reports/ml/final-test-4-error-analysis-v2.json", validationFalseMergeRate: 0.0012919896640826874, registry: "reports/ml/experiment-registry-v2.json" },
  { tag: "v2lr", label: "candidate E2 (LR, 31 features)", evaluation: "reports/ml/final-test-4-evaluation-v2lr.json", errors: "reports/ml/final-test-4-error-analysis-v2lr.json", validationFalseMergeRate: 0.0012919896640826874, registry: "reports/ml/experiment-registry-v2lr.json" },
] as const;

/**
 * Latvian is not a guess. P6.27 measured `sabiedriba` at df=7 across 8,146
 * training documents — too rare for corpus-level IDF to recognise as the
 * boilerplate it is — and the freeze pre-registered it as something to MEASURE
 * on test #4, never to patch after reading one. Two objective slices, so the
 * finding does not depend on which one a reader prefers: the publisher-stated
 * jurisdiction, and the token itself wherever it appears.
 */
const LATVIAN_FORM_TOKENS = ["sabiedriba", "sabiedrība"];
const hasLatvianForm = (record: Rec): boolean => {
  const haystack = [record.name, record.officialName ?? "", ...(record.aliases ?? [])].join(" ").toLowerCase();
  const normalised = normalizeName(haystack).normalized;
  return LATVIAN_FORM_TOKENS.some((token) => haystack.includes(token) || normalised.includes(token));
};

/**
 * A pair is legal-form-sensitive when the two sides carry DIFFERENT legal-form
 * boilerplate, or one carries it and the other does not — the case the P6.27
 * features exist for. Mined vocabulary only; nothing is added here, because
 * adding a form after reading a test is the post-hoc heuristic the freeze bans.
 */
const VOCAB = read<{ forms: { form: string; position: string; tokens: number }[] }>("evidence/ml/legal-form-vocabulary.json");
const FORMS = VOCAB.forms.map((f) => f.form.toLowerCase()).filter((f) => f.length > 0);
/**
 * Forms are PHRASES, not tokens — `anonim sirketi`, `публичное акционерное
 * общество` — so membership is a token-boundary phrase match on the normalised
 * name rather than a set lookup on single tokens.
 */
const formsOf = (record: Rec): Set<string> => {
  const padded = ` ${normalizeName(record.name).normalized} `;
  return new Set(FORMS.filter((form) => padded.includes(` ${form} `)));
};
const legalFormSensitive = (a: Rec, b: Rec): boolean => {
  const fa = formsOf(a), fb = formsOf(b);
  if (fa.size === 0 && fb.size === 0) return false;
  if (fa.size !== fb.size) return true;
  for (const t of fa) if (!fb.has(t)) return true;
  return false;
};

function main(): void {
  const dataset = read<Dataset>(DATASET);
  const recordOf = (ref: string): Rec => {
    const record = dataset.featureRecords[ref];
    if (!record) throw new Error(`no projection for ${ref}`);
    return record;
  };

  const SLICES: { name: string; note: string; test: (pair: Pair, a: Rec, b: Rec) => boolean }[] = [
    { name: "domestic (both stated, same country)", note: "the majority case", test: (_p, a, b) => a.jurisdiction !== null && b.jurisdiction !== null && a.jurisdiction.slice(0, 2) === b.jurisdiction.slice(0, 2) },
    { name: "cross-border (both stated, different country)", note: "the gap P6.25/P6.26/P6.27 measured three times", test: (_p, a, b) => a.jurisdiction !== null && b.jurisdiction !== null && a.jurisdiction.slice(0, 2) !== b.jurisdiction.slice(0, 2) },
    { name: "jurisdiction not stated by both", note: "no jurisdiction feature can fire", test: (_p, a, b) => a.jurisdiction === null || b.jurisdiction === null },
    { name: "legal-form-sensitive (forms differ or one side has none)", note: "what the P6.27 feature set was built for", test: (_p, a, b) => legalFormSensitive(a, b) },
    { name: "aliases present on at least one side", note: "name-variant evidence available", test: (_p, a, b) => (a.aliases?.length ?? 0) > 0 || (b.aliases?.length ?? 0) > 0 },
    { name: "Latvian legal form present (sabiedriba token)", note: "pre-registered known limitation; df=7 in 8,146 training documents", test: (_p, a, b) => hasLatvianForm(a) || hasLatvianForm(b) },
    { name: "Latvian jurisdiction on either side", note: "the publisher-stated version of the same slice", test: (_p, a, b) => a.jurisdiction?.slice(0, 2) === "LV" || b.jurisdiction?.slice(0, 2) === "LV" },
  ];

  const jurisdictions = new Set<string>();
  for (const record of Object.values(dataset.featureRecords)) {
    if (record.jurisdiction) jurisdictions.add(record.jurisdiction.slice(0, 2));
  }

  const pairSlices = new Map<string, boolean[]>();
  const slicePositives = SLICES.map(() => 0);
  const sliceNegatives = SLICES.map(() => 0);
  for (const pair of dataset.pairs) {
    const a = recordOf(pair.aRef), b = recordOf(pair.bRef);
    const flags = SLICES.map((slice) => slice.test(pair, a, b));
    pairSlices.set(pair.pairId, flags);
    flags.forEach((inSlice, i) => {
      if (!inSlice) return;
      if (pair.label === 1) slicePositives[i] = (slicePositives[i] as number) + 1;
      else sliceNegatives[i] = (sliceNegatives[i] as number) + 1;
    });
  }

  const models = MODELS.map((model) => {
    const evaluation = read<Evaluation>(model.evaluation);
    const errors = read<ErrorReport>(model.errors);
    const m = evaluation.headline.model;

    const falseSplits = errors.rows.filter((r) => r.truth === "same_entity" && r.prediction === "different_entities");
    const falseMerges = errors.rows.filter((r) => r.truth === "different_entities" && r.prediction === "same_entity");

    const sliceRows = SLICES.map((slice, i) => {
      const positives = slicePositives[i] as number;
      const negatives = sliceNegatives[i] as number;
      const fn = falseSplits.filter((r) => pairSlices.get(r.pairId)?.[i]).length;
      const fp = falseMerges.filter((r) => pairSlices.get(r.pairId)?.[i]).length;
      return {
        slice: slice.name, note: slice.note, positives, negatives,
        truePositives: positives - fn, falseNegatives: fn, falseMerges: fp,
        recall: positives === 0 ? null : Number(((positives - fn) / positives).toFixed(4)),
        falseMergeRate: negatives === 0 ? null : Number((fp / negatives).toFixed(6)),
      };
    });

    /**
     * Criterion (b) of the freeze, computed and not eyeballed. A merged
     * `sampled_negative` shares neither a normalised name nor a leading token
     * with its partner: the two records have nothing in common but an
     * identifier scheme they disagree on. `evaluate-model.ts` already labels
     * that `false_merge_unrelated_pair`, which is why the criterion is
     * decidable from the report rather than from someone's reading of a list.
     */
    const unrelated = falseMerges.filter((r) => r.failureCategory === "false_merge_unrelated_pair");
    const nameCollision = falseMerges.filter((r) => r.failureCategory === "false_merge_identical_normalised_name");
    const corporateFamily = falseMerges.filter((r) => r.failureCategory === "false_merge_shared_leading_token");

    const negatives = evaluation.heldOut.negatives;
    const positives = evaluation.heldOut.positives;
    return {
      tag: model.tag, label: model.label,
      artifact: evaluation.artifact,
      confusion: { truePositives: m.truePositives, falsePositives: m.falsePositives, trueNegatives: m.trueNegatives, falseNegatives: m.falseNegatives },
      precision: m.precision, recall: m.recall, f1: m.f1,
      falseMergeRate: m.falseMergeRate,
      falsePositiveRate: Number((m.falsePositives / negatives).toFixed(6)),
      falseNegativeRate: Number((m.falseNegatives / positives).toFixed(6)),
      validationFalseMergeRate: model.validationFalseMergeRate,
      /**
       * The reporting obligation §3.1 of the freeze imposed. v2lf's
       * validation false-merge rate understated its test rate eighteenfold,
       * and a ceiling measured on the partition being selected on is not a
       * ceiling. Reported whatever the ship decision is.
       */
      falseMergeInflationFactor: Number((m.falseMergeRate / model.validationFalseMergeRate).toFixed(2)),
      falseMergesByClass: {
        identicalNormalisedName: nameCollision.length,
        sharedLeadingTokenCorporateFamily: corporateFamily.length,
        whollyUnrelated: unrelated.length,
      },
      whollyUnrelatedMerges: unrelated.slice(0, 25).map((r) => ({
        pairId: r.pairId, score: r.score, sources: r.sources,
        a: r.fields.aName, b: r.fields.bName,
        aJurisdiction: r.fields.aJurisdiction, bJurisdiction: r.fields.bJurisdiction,
      })),
      slices: sliceRows,
      reportBreakdowns: evaluation.breakdowns,
      errorCategoryCounts: evaluation.errorCategoryCounts,
    };
  });

  const shipped = models[0]!, candidate = models[1]!;
  const criterionA = candidate.confusion.truePositives > shipped.confusion.truePositives;
  const criterionB = candidate.falseMergesByClass.whollyUnrelated <= shipped.falseMergesByClass.whollyUnrelated;

  const evaluation0 = read<Evaluation>(MODELS[0].evaluation);
  const out = {
    report: "P6.28 frozen test #4 — one-shot comparison",
    dataClass: "REAL",
    ranAt: new Date().toISOString(),
    dataset: { path: DATASET, id: dataset.datasetId, version: dataset.datasetVersion },
    instrument: { ...evaluation0.heldOut, jurisdictions: jurisdictions.size },
    decisionRule: {
      source: "docs/evaluation/ml-selection-freeze-e2.md §3, carried forward unchanged from the P6.27 freeze",
      criterionA: {
        statement: "net identity recovery improves — the candidate recovers more true positives than the shipped model, each at its own frozen threshold",
        shippedTruePositives: shipped.confusion.truePositives,
        candidateTruePositives: candidate.confusion.truePositives,
        passed: criterionA,
      },
      criterionB: {
        statement: "false merges do not get qualitatively worse — the candidate introduces no merges between wholly unrelated companies beyond the shipped model's",
        shippedWhollyUnrelated: shipped.falseMergesByClass.whollyUnrelated,
        candidateWhollyUnrelated: candidate.falseMergesByClass.whollyUnrelated,
        passed: criterionB,
      },
      f1IsNotTheCriterion: "A false merge fuses two real companies into one node and every downstream inference inherits it; a miss leaves two nodes a human can still join. A blended score treats them as interchangeable and they are not.",
      decision: criterionA && criterionB ? "SHIP E2" : "KEEP V2",
    },
    models,
  };

  writeFileSync(path.join(ROOT, "reports/ml/final-test-4-comparison.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");

  const pct = (v: number): string => `${(100 * v).toFixed(1)}%`;
  console.log(`instrument: ${out.instrument.pairs} pairs, ${out.instrument.positives} positives, ${out.instrument.subjects} subjects, ${out.instrument.jurisdictions} jurisdictions\n`);
  for (const model of models) {
    console.log(
      `${model.label.padEnd(32)} TP ${String(model.confusion.truePositives).padStart(5)}  FP ${String(model.confusion.falsePositives).padStart(4)}  ` +
        `P ${pct(model.precision)}  R ${pct(model.recall)}  F1 ${pct(model.f1)}  FMR ${(100 * model.falseMergeRate).toFixed(3)}%  ` +
        `unrelated merges ${model.falseMergesByClass.whollyUnrelated}  validation->test FMR x${model.falseMergeInflationFactor}`,
    );
  }
  console.log(`\n(a) net identity recovery improves : ${criterionA ? "PASS" : "FAIL"}`);
  console.log(`(b) false merges not qualitatively worse : ${criterionB ? "PASS" : "FAIL"}`);
  console.log(`\nDECISION: ${out.decisionRule.decision}  ->  reports/ml/final-test-4-comparison.json`);
}

main();
