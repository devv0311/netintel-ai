import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildFeatures,
  deterministicPairDecision,
  FEATURE_NAMES,
  TRAINABLE_FEATURE_NAMES,
  type FeatureRecord,
} from "@/lib/ml/features";
import { metricsAt, prAuc, rocAuc, selectThreshold, type ScoredPair } from "@/lib/ml/metrics";
import {
  artifactSha256,
  loadArtifact,
  MODEL_ARTIFACT_FORMAT,
  projectOntoArtifact,
  scoreVector,
  weightsDigest,
  scoreWithModel,
  serialiseArtifact,
  type ModelArtifact,
} from "@/lib/ml/model";
import { ML_SUGGESTION_CLASSIFICATION, pairClassifier, suggestSameEntity } from "@/lib/ml/service";

const ROOT = process.cwd();
/**
 * The SHIPPED artifact. P6.28 replaced v2 with v2lr — the same logistic
 * regression on the P6.27 feature set — after frozen test #4 scored it once
 * against v2 under a rule fixed before the test existed. This constant is the
 * shipped one on purpose: the point of the contract test below is that the
 * service serves the artifact the frozen evaluation actually measured.
 */
const ARTIFACT_PATH = path.join(ROOT, "models/cipher-er-pair-classifier.v2lr.json");
/** The superseded P6.25 artifact, still loadable — the format has not changed. */
const V2_ARTIFACT_PATH = path.join(ROOT, "models/cipher-er-pair-classifier.v2.json");
/** The superseded P6.24 artifact, kept loadable on purpose — see the backward-compatibility test. */
const V1_ARTIFACT_PATH = path.join(ROOT, "models/cipher-er-pair-classifier.v1.json");

const record = (name: string): FeatureRecord => ({ name });

describe("metrics", () => {
  const pairs: ScoredPair[] = [
    { label: 1, score: 0.9 },
    { label: 1, score: 0.8 },
    { label: 0, score: 0.4 },
    { label: 0, score: 0.1 },
  ];

  it("computes a perfect ROC-AUC for a perfectly separated set", () => {
    expect(rocAuc(pairs)).toBe(1);
  });

  it("gives a random-order set an ROC-AUC of 0.5", () => {
    expect(
      rocAuc([
        { label: 1, score: 0.9 },
        { label: 0, score: 0.8 },
        { label: 1, score: 0.4 },
        { label: 0, score: 0.1 },
      ]),
    ).toBeCloseTo(0.75, 6);
    expect(
      rocAuc([
        { label: 1, score: 0.5 },
        { label: 0, score: 0.5 },
      ]),
    ).toBe(0.5);
  });

  it("computes PR-AUC of 1 for perfect separation", () => {
    expect(prAuc(pairs)).toBeCloseTo(1, 6);
  });

  it("reports precision, recall, false-merge and false-split rates", () => {
    const m = metricsAt(pairs, 0.5);
    expect(m.truePositives).toBe(2);
    expect(m.falsePositives).toBe(0);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.falseMergeRate).toBe(0);
    expect(m.falseSplitRate).toBe(0);
  });

  it("respects the false-merge ceiling when selecting a threshold", () => {
    const noisy: ScoredPair[] = [
      { label: 1, score: 0.95 },
      { label: 1, score: 0.6 },
      { label: 0, score: 0.7 },
      { label: 0, score: 0.1 },
    ];
    // Any threshold that catches the 0.6 positive also catches the 0.7
    // negative, so a zero ceiling must give up that recall rather than
    // buy it with a false merge.
    const selected = selectThreshold(noisy, 0);
    expect(selected.falseMergeRate).toBe(0);
    expect(selected.truePositives).toBe(1);
  });
});

describe("model artifact", () => {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");

  it("loads independently from its file, with no training code in the path", () => {
    const artifact = loadArtifact(raw);
    expect(artifact.format).toBe(MODEL_ARTIFACT_FORMAT);
    // By NAME and a subset of what this build computes, not the whole list:
    // `officialNameBothPresent` is computed but excluded from training.
    for (const name of artifact.featureNames) expect(FEATURE_NAMES).toContain(name);
    expect(new Set(artifact.featureNames).size).toBe(artifact.featureNames.length);
    /**
     * A SUBSET, not an equality — which is what the comment above always
     * said, while the assertion underneath it said something stricter.
     *
     * Equality reads as "the shipped model uses every feature this build
     * trains on", and that is false the moment a feature is added ahead of a
     * retrain: P6.27 added five, and this artifact is the frozen P6.25 model,
     * which was fitted without them and must keep scoring exactly as it did.
     * Asserting equality here would force every feature experiment to ship a
     * new model in the same commit, which is the opposite of the separation
     * the name-based feature contract and `weightsDigest` exist to provide.
     *
     * What must hold is that the artifact asks for nothing this build cannot
     * compute (above), asks for nothing twice (above), and does not use a
     * feature excluded from training (below). A NEWLY trained artifact gets
     * the full trainable set by construction, because the trainer builds its
     * matrix from TRAINABLE_FEATURE_NAMES.
     */
    for (const name of artifact.featureNames) {
      expect(TRAINABLE_FEATURE_NAMES, `${name} is excluded from training`).toContain(name);
    }
    expect(Number.isFinite(artifact.decisionThreshold)).toBe(true);
  });

  it("round-trips: serialise -> parse -> identical scores and identical hash", () => {
    const artifact = loadArtifact(raw);
    const reserialised = serialiseArtifact(artifact);
    expect(artifactSha256(reserialised)).toBe(artifactSha256(raw));
    const again = loadArtifact(reserialised);
    const vector = buildFeatures(record("BNP PARIBAS"), record("BNP PARIBAS CARDIF")).values;
    expect(scoreVector(again, vector)).toBe(scoreVector(artifact, vector));
  });

  it("refuses a vector of the wrong width rather than scoring nonsense", () => {
    const artifact = loadArtifact(raw);
    expect(() => scoreVector(artifact, [0, 1])).toThrow(/feature vector has 2 values/);
  });

  it("refuses an artifact declaring a feature this build cannot compute", () => {
    const artifact = loadArtifact(raw);
    const bogus = {
      ...artifact,
      featureNames: [...artifact.featureNames.slice(0, -1), "nameRhymesWith"],
    } as unknown as ModelArtifact;
    expect(() => scoreWithModel(bogus, record("a"), record("b"))).toThrow(/does not compute/);
  });

  it("refuses an artifact that declares the same feature twice", () => {
    const artifact = loadArtifact(raw);
    const duplicated = {
      ...artifact,
      featureNames: [...artifact.featureNames.slice(0, -1), artifact.featureNames[0]],
    } as ModelArtifact;
    expect(() => scoreWithModel(duplicated, record("a"), record("b"))).toThrow(/more than once/);
  });

  it("refuses an artifact whose declared digest disagrees with its contents", () => {
    // The feature contract is by NAME, so weights are aligned to the
    // artifact's own order. Re-labelling that order without moving the
    // weights would score confidently wrong; the digest is what catches it.
    const artifact = loadArtifact(raw);
    const withDigest = { ...artifact, weightsDigest: weightsDigest(artifact) };
    const tampered = {
      ...withDigest,
      featureNames: [...withDigest.featureNames].reverse(),
    } as ModelArtifact;
    expect(() => loadArtifact(JSON.stringify(tampered))).toThrow(/weightsDigest does not match/);
  });

  it("produces a probability with a per-feature explanation for every feature", () => {
    const artifact = loadArtifact(raw);
    const scored = scoreWithModel(artifact, record("Genertel"), record("GENERTEL S.P.A."));
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(1);
    expect(scored.features).toHaveLength(artifact.featureNames.length);
    expect(scored.features.map((feature) => feature.name)).toEqual([...artifact.featureNames]);
  });
});

describe("artifact compatibility across feature-set versions", () => {
  const raw = readFileSync(ARTIFACT_PATH, "utf8");

  it("still loads and scores the superseded P6.24 artifact", () => {
    // The P6.25 feature contract is by NAME precisely so that dropping one
    // leaky feature does not invalidate every artifact ever trained. If
    // this breaks, the project has lost the ability to measure a new model
    // against the one it replaces, which is how the v1/v2 head-to-head in
    // reports/ml/final-test-comparison.json was produced.
    const v1 = loadArtifact(readFileSync(V1_ARTIFACT_PATH, "utf8"));
    expect(v1.featureNames.length).toBe(25);
    const scored = scoreWithModel(v1, record("Barclays PLC"), record("Barclays Bank PLC"));
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(1);
    expect(scored.features).toHaveLength(25);
  });

  it("still loads and scores the superseded P6.25 artifact, which P6.28 replaced", () => {
    // v2 is the model the shipped one was measured against on frozen test #4,
    // and the head-to-head in reports/ml/final-test-4-comparison.json only
    // exists because an artifact keeps working after it stops shipping. It is
    // 26 features against the shipped 31; the contract is by NAME, so both
    // load against the same build.
    const v2 = loadArtifact(readFileSync(V2_ARTIFACT_PATH, "utf8"));
    expect(v2.featureNames.length).toBe(26);
    expect(v2.decisionThreshold).toBe(0.9774753387972909);
    const scored = scoreWithModel(v2, record("Barclays PLC"), record("Barclays Bank PLC"));
    expect(scored.features).toHaveLength(26);
  });

  it("scores a full vector and a pre-projected vector identically", () => {
    const artifact = loadArtifact(raw);
    const full = buildFeatures(record("Amundi"), record("Amundi Asset Management")).values;
    const projected = projectOntoArtifact(artifact, full);
    expect(projected).toHaveLength(artifact.featureNames.length);
    expect(scoreVector(artifact, projected)).toBe(scoreVector(artifact, full));
  });
});

describe("CIPHER integration contract", () => {
  it("labels every model output as an algorithmic signal, never a fact", () => {
    const a = record("Bell Canada");
    const b = record("The Bell Telephone Company of Canada or Bell Canada");
    const suggestion = suggestSameEntity(a, b, deterministicPairDecision(a, b));
    expect(suggestion.classification).toBe(ML_SUGGESTION_CLASSIFICATION);
    expect(suggestion.classification).toBe("algorithmic_signal");
  });

  it("always reports the deterministic verdict alongside the score", () => {
    const a = record("ENDESA");
    const b = record("ENDESA SA");
    const suggestion = suggestSameEntity(a, b, deterministicPairDecision(a, b));
    expect(["would merge", "would not merge"]).toContain(suggestion.deterministicVerdict);
    expect(suggestion.deterministicVerdict).toBe(deterministicPairDecision(a, b) ? "would merge" : "would not merge");
  });

  it("carries the model version, threshold and full feature evidence", () => {
    const suggestion = suggestSameEntity(record("Cultura"), record("Cultura Sparebank"), false);
    expect(suggestion.modelVersion).toBe(pairClassifier().modelVersion);
    expect(suggestion.threshold).toBe(pairClassifier().decisionThreshold);
    expect(suggestion.evidence).toHaveLength(pairClassifier().featureNames.length);
    expect(suggestion.disclaimer).toMatch(/not a finding/i);
  });

  it("serves the same artifact the evaluation used", () => {
    expect(pairClassifier().modelId).toBe(loadArtifact(raw).modelId);
    expect(pairClassifier().decisionThreshold).toBe(loadArtifact(raw).decisionThreshold);
  });

  const raw = readFileSync(ARTIFACT_PATH, "utf8");
});
