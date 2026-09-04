import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildFeatures, deterministicPairDecision, FEATURE_NAMES, type FeatureRecord } from "@/lib/ml/features";
import { metricsAt, prAuc, rocAuc, selectThreshold, type ScoredPair } from "@/lib/ml/metrics";
import {
  artifactSha256,
  loadArtifact,
  MODEL_ARTIFACT_FORMAT,
  scoreVector,
  scoreWithModel,
  serialiseArtifact,
  type ModelArtifact,
} from "@/lib/ml/model";
import { ML_SUGGESTION_CLASSIFICATION, pairClassifier, suggestSameEntity } from "@/lib/ml/service";

const ROOT = process.cwd();
const ARTIFACT_PATH = path.join(ROOT, "models/cipher-er-pair-classifier.v1.json");

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
    expect(artifact.featureNames).toEqual([...FEATURE_NAMES]);
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

  it("refuses an artifact whose feature order disagrees with this build", () => {
    const artifact = loadArtifact(raw);
    const reordered = {
      ...artifact,
      featureNames: [...artifact.featureNames].reverse(),
    } as ModelArtifact;
    expect(() => scoreWithModel(reordered, record("a"), record("b"))).toThrow(/feature 0 is/);
  });

  it("produces a probability with a per-feature explanation for every feature", () => {
    const artifact = loadArtifact(raw);
    const scored = scoreWithModel(artifact, record("Genertel"), record("GENERTEL S.P.A."));
    expect(scored.score).toBeGreaterThanOrEqual(0);
    expect(scored.score).toBeLessThanOrEqual(1);
    expect(scored.features).toHaveLength(FEATURE_NAMES.length);
    expect(scored.features.map((feature) => feature.name)).toEqual([...FEATURE_NAMES]);
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
    expect(suggestion.evidence).toHaveLength(FEATURE_NAMES.length);
    expect(suggestion.disclaimer).toMatch(/not a finding/i);
  });

  it("serves the same artifact the evaluation used", () => {
    expect(pairClassifier().modelId).toBe(loadArtifact(raw).modelId);
    expect(pairClassifier().decisionThreshold).toBe(loadArtifact(raw).decisionThreshold);
  });

  const raw = readFileSync(ARTIFACT_PATH, "utf8");
});
