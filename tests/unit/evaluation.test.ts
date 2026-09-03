import { describe, expect, it } from "vitest";

import {
  assignGroundTruthKey,
  indexGroundTruthEntities,
  loadCorpusIndex,
  loadGroundTruth,
  normalizeMentionToRecordRef,
  nameKey,
  type GroundTruth,
} from "@/lib/evaluation/ground-truth";
import { splitProvenanceLocation } from "@/lib/evaluation/snapshot";
import { alignMentions, pairwiseCounts } from "@/lib/evaluation/metrics/entity-resolution";
import { f1, precision, ratioMetric, recall } from "@/lib/evaluation/types";

/**
 * Tests for the evaluation harness itself.
 *
 * The harness reports on the pipeline, so nothing else in the suite
 * would notice if its arithmetic were wrong — a silently broken
 * evaluator produces confident numbers, which is worse than no
 * evaluator. These tests pin the parts that could fail quietly: the
 * pair-counting maths, the ground-truth mention normalisation, and the
 * refusal to guess when a mention is ambiguous.
 */

describe("precision / recall / F1", () => {
  it("computes the textbook values", () => {
    const counts = { truePositives: 6, falsePositives: 2, falseNegatives: 3 };
    expect(precision(counts)).toBeCloseTo(6 / 8);
    expect(recall(counts)).toBeCloseTo(6 / 9);
    expect(f1(counts)).toBeCloseTo((2 * (6 / 8) * (6 / 9)) / (6 / 8 + 6 / 9));
  });

  it("returns null rather than 0 when a denominator is empty", () => {
    expect(precision({ truePositives: 0, falsePositives: 0, falseNegatives: 5 })).toBeNull();
    expect(recall({ truePositives: 0, falsePositives: 5, falseNegatives: 0 })).toBeNull();
    expect(f1({ truePositives: 0, falsePositives: 0, falseNegatives: 0 })).toBeNull();
  });
});

describe("ratioMetric", () => {
  const base = {
    id: "t",
    name: "t",
    category: "t",
    definition: "d",
    numeratorDefinition: "n",
    denominatorDefinition: "d",
    groundTruthSource: "g",
    systemInput: "s",
    limitations: [],
  };

  it("leaves passed null when the project has fixed no threshold", () => {
    const metric = ratioMetric({ ...base, numerator: 1, denominator: 2 });
    expect(metric.value).toBe(0.5);
    expect(metric.threshold).toBeNull();
    expect(metric.passed).toBeNull();
  });

  it("judges only against a supplied threshold", () => {
    const pass = ratioMetric({
      ...base,
      numerator: 10,
      denominator: 10,
      threshold: { value: 1, comparison: "gte", source: "docs/requirements.md §8" },
    });
    expect(pass.passed).toBe(true);
    const fail = ratioMetric({
      ...base,
      numerator: 9,
      denominator: 10,
      threshold: { value: 1, comparison: "gte", source: "docs/requirements.md §8" },
    });
    expect(fail.passed).toBe(false);
  });

  it("does not divide by zero", () => {
    expect(ratioMetric({ ...base, numerator: 0, denominator: 0 }).value).toBeNull();
  });
});

describe("pairwiseCounts", () => {
  const mention = (recordRef: string, groundTruthKey: string, systemCluster: string) => ({
    recordId: recordRef,
    recordRef,
    fieldPath: "",
    observedName: null,
    canonicalEntityId: systemCluster,
    groundTruthKey,
    systemCluster,
  });

  it("scores a perfect clustering as all true positives", () => {
    const counts = pairwiseCounts([
      mention("a", "S1", "e1"),
      mention("b", "S1", "e1"),
      mention("c", "S2", "e2"),
    ]);
    expect(counts).toEqual({ truePositives: 1, falsePositives: 0, falseNegatives: 0 });
  });

  it("counts an over-merge as a false positive", () => {
    const counts = pairwiseCounts([mention("a", "S1", "e1"), mention("b", "S2", "e1")]);
    expect(counts).toEqual({ truePositives: 0, falsePositives: 1, falseNegatives: 0 });
  });

  it("counts an under-merge as a false negative", () => {
    const counts = pairwiseCounts([mention("a", "S1", "e1"), mention("b", "S1", "e2")]);
    expect(counts).toEqual({ truePositives: 0, falsePositives: 0, falseNegatives: 1 });
  });

  it("grows quadratically with cluster size, as pair counting does", () => {
    const four = pairwiseCounts([
      mention("a", "S1", "e1"),
      mention("b", "S1", "e1"),
      mention("c", "S1", "e1"),
      mention("d", "S1", "e1"),
    ]);
    expect(four.truePositives).toBe(6);
  });
});

describe("provenance location parsing", () => {
  it("splits the `recordRef#fieldPath` shape the extractor writes", () => {
    expect(splitProvenanceLocation("fir:001#accused[0]")).toEqual({
      recordRef: "fir:001",
      fieldPath: "accused[0]",
    });
  });

  it("treats a location with no field path as a bare record ref", () => {
    expect(splitProvenanceLocation("witness:W1")).toEqual({
      recordRef: "witness:W1",
      fieldPath: "",
    });
  });
});

describe("ground-truth mention normalisation", () => {
  const corpus = loadCorpusIndex();

  it("resolves every documented mention to a real corpus record", () => {
    const gt = loadGroundTruth();
    const unresolved: string[] = [];
    for (const merge of gt.expectedEntityMerges) {
      for (const mention of merge.sourceMentions) {
        if (normalizeMentionToRecordRef(mention, corpus) === null) unresolved.push(mention);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("handles all three shapes ground truth uses", () => {
    expect(normalizeMentionToRecordRef("subscriber-registry:suspect:S1", corpus)).toBe("suspect:S1");
    expect(normalizeMentionToRecordRef("fir:001:accused", corpus)).toBe("fir:001");
    expect(normalizeMentionToRecordRef("witness:W1", corpus)).toBe("witness:W1");
  });

  it("returns null for a mention the corpus does not contain", () => {
    expect(normalizeMentionToRecordRef("fir:999:accused", corpus)).toBeNull();
  });

  it("normalises names case- and whitespace-insensitively", () => {
    expect(nameKey("  Rohan   Malhotra ")).toBe("rohan malhotra");
  });
});

describe("ground-truth key assignment", () => {
  const corpus = loadCorpusIndex();
  const gt: GroundTruth = loadGroundTruth();
  const index = indexGroundTruthEntities(gt, corpus);

  it("assigns directly when a record belongs to one entity", () => {
    expect(assignGroundTruthKey("suspect:S1", "Rohan Malhotra", index).key).toBe("S1");
  });

  it("uses the observed name to split a record two entities share", () => {
    // fir:001 names both Rohan Malhotra (S1) and Kabir Sharma (S3).
    expect(assignGroundTruthKey("fir:001", "Rohan Malhotra", index).key).toBe("S1");
    expect(assignGroundTruthKey("fir:001", "Kabir Sharma", index).key).toBe("S3");
  });

  it("refuses to guess when the shared record gives no usable name", () => {
    const outcome = assignGroundTruthKey("fir:001", null, index);
    expect(outcome.key).toBeNull();
    expect(outcome.reason).toMatch(/shared by/);
  });

  it("refuses to guess for a record no cluster claims", () => {
    expect(assignGroundTruthKey("cdr:000001", "Rohan Malhotra", index).key).toBeNull();
  });
});

describe("mention alignment", () => {
  const corpus = loadCorpusIndex();
  const index = indexGroundTruthEntities(loadGroundTruth(), corpus);

  it("excludes an unclustered mention instead of inventing a singleton", () => {
    const { aligned, excluded } = alignMentions(
      [
        {
          recordId: "r1",
          recordRef: "suspect:S1",
          fieldPath: "name",
          observedName: "Rohan Malhotra",
          canonicalEntityId: null,
        },
      ],
      index,
    );
    expect(aligned).toHaveLength(0);
    expect(excluded[0]?.reason).toMatch(/no resolution decision/);
  });
});
