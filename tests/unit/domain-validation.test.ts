import { describe, expect, it } from "vitest";

import { validateSafe, validateOrThrow, DomainValidationError } from "@/lib/domain/validation";
import { EvidenceClassificationSchema, ProvenanceSchema } from "@/lib/domain/provenance";
import { RelationshipSchema } from "@/lib/domain/relationship";
import { TemporalIntervalSchema } from "@/lib/domain/temporal";
import {
  AnalyticalSignalSchema,
  AIInferenceSchema,
  InvestigativeLeadSchema,
} from "@/lib/domain/derived";

function validProvenance() {
  return {
    source: "fixture:test",
    location: "record[0]",
    method: "unit-test",
    confidence: 0.8,
    processingHistory: ["created-for-test"],
    timestamp: new Date().toISOString(),
  };
}

describe("EvidenceClassificationSchema", () => {
  it("accepts all five required classifications", () => {
    for (const value of [
      "observed_fact",
      "corroborated_fact",
      "algorithmic_signal",
      "ai_inference",
      "investigative_lead",
    ]) {
      expect(EvidenceClassificationSchema.safeParse(value).success).toBe(true);
    }
  });

  it("rejects an established-fact-sounding value that isn't one of the five", () => {
    expect(EvidenceClassificationSchema.safeParse("established_fact").success).toBe(false);
    expect(EvidenceClassificationSchema.safeParse("").success).toBe(false);
  });
});

describe("ProvenanceSchema — confidence and classification are separate concepts", () => {
  it("Provenance carries a numeric confidence, not a classification label", () => {
    const shape = ProvenanceSchema.shape;
    expect("confidence" in shape).toBe(true);
    expect("classification" in shape).toBe(false);
  });

  it("rejects a confidence value outside [0, 1]", () => {
    expect(ProvenanceSchema.safeParse({ ...validProvenance(), confidence: -0.1 }).success).toBe(
      false,
    );
    expect(ProvenanceSchema.safeParse({ ...validProvenance(), confidence: 1.1 }).success).toBe(
      false,
    );
  });
});

describe("classification is independent of confidence on derived items", () => {
  it("AnalyticalSignal, AIInference, and InvestigativeLead each fix their own classification literal", () => {
    const base = { investigationId: "inv_1", provenance: validProvenance() };

    const signal = AnalyticalSignalSchema.safeParse({
      ...base,
      id: "sig_1",
      graphVersion: "v1",
      signalType: "centrality",
      value: { score: 0.5 },
      method: "betweenness",
      explanation: "test",
      classification: "algorithmic_signal",
    });
    expect(signal.success).toBe(true);

    // A signal mislabeled as an AI inference must fail — classification
    // is not a free-form field an agent could set incorrectly.
    const mislabeled = AnalyticalSignalSchema.safeParse({
      ...base,
      id: "sig_2",
      graphVersion: "v1",
      signalType: "centrality",
      value: { score: 0.5 },
      method: "betweenness",
      explanation: "test",
      classification: "ai_inference",
    });
    expect(mislabeled.success).toBe(false);

    const inference = AIInferenceSchema.safeParse({
      ...base,
      id: "inf_1",
      claim: "these two aliases likely refer to the same person",
      basedOn: ["entity_1", "entity_2"],
      confidence: 0.6,
      classification: "ai_inference",
    });
    expect(inference.success).toBe(true);

    const lead = InvestigativeLeadSchema.safeParse({
      ...base,
      id: "lead_1",
      suggestion: "verify whether entity_3 has additional undisclosed accounts",
      relatedEntityIds: ["entity_3"],
      classification: "investigative_lead",
    });
    expect(lead.success).toBe(true);
  });
});

describe("RelationshipSchema", () => {
  it("requires an evidence classification distinct from confidence", () => {
    const result = RelationshipSchema.safeParse({
      id: "rel_1",
      investigationId: "inv_1",
      sourceEntityId: "entity_1",
      targetEntityId: "entity_2",
      relationshipType: "communication",
      classification: "corroborated_fact",
      provenance: validProvenance(),
    });
    expect(result.success).toBe(true);
  });

  it("rejects an unrecognized relationship type", () => {
    const result = RelationshipSchema.safeParse({
      id: "rel_2",
      investigationId: "inv_1",
      sourceEntityId: "entity_1",
      targetEntityId: "entity_2",
      relationshipType: "telepathic_link",
      classification: "observed_fact",
      provenance: validProvenance(),
    });
    expect(result.success).toBe(false);
  });
});

describe("TemporalIntervalSchema", () => {
  it("accepts a point-in-time interval (start only)", () => {
    expect(
      TemporalIntervalSchema.safeParse({ start: new Date().toISOString() }).success,
    ).toBe(true);
  });

  it("rejects an interval where end precedes start", () => {
    const start = new Date("2026-01-02T00:00:00.000Z").toISOString();
    const end = new Date("2026-01-01T00:00:00.000Z").toISOString();
    expect(TemporalIntervalSchema.safeParse({ start, end }).success).toBe(false);
  });
});

describe("validateOrThrow / validateSafe", () => {
  it("validateOrThrow throws DomainValidationError with issue detail on invalid input", () => {
    try {
      validateOrThrow(EvidenceClassificationSchema, "not_a_real_classification", "test-context");
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DomainValidationError);
      expect((err as DomainValidationError).issues.length).toBeGreaterThan(0);
    }
  });

  it("validateSafe returns a discriminated result instead of throwing", () => {
    const result = validateSafe(EvidenceClassificationSchema, "not_a_real_classification");
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});
