import { describe, expect, it, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  DossierFindingSchema,
  DossierSchema,
  DossierSectionSchema,
  SECTION_ALLOWED_CLASSIFICATIONS,
  countReferences,
  emptyClassificationCensus,
  isNarrativeSection,
  type Dossier,
  type DossierFinding,
} from "@/lib/domain/dossier";
import type { AnalyticalSignal } from "@/lib/domain/derived";
import type { CorroborationFinding } from "@/lib/domain/corroboration";
import type { CommunicationEvent } from "@/lib/domain/events";
import type { Alias, Entity } from "@/lib/domain/entity";
import type { Location } from "@/lib/domain/location";
import type { EvidenceItem, EvidenceSource } from "@/lib/domain/evidence";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Provenance } from "@/lib/domain/provenance";
import type { Relationship } from "@/lib/domain/relationship";
import type { ResolutionDecision } from "@/lib/domain/resolution";
import {
  SECTION_LIMITS,
  assembleDeterministicSections,
  dossierContentDigest,
} from "@/lib/dossier/assemble";
import type { DossierSnapshot } from "@/lib/dossier/load";
import { assertTraceability, knownIdsFrom, validateReport } from "@/lib/dossier/verify";

import { prepareFreshDb, releaseAndRemoveDb } from "./helpers/db";

/**
 * P5.9 dossier / report.
 *
 * Two halves, deliberately kept apart:
 *
 *   - the pure half exercises assembly, the schema contract and
 *     traceability verification against a hand-built snapshot, so a
 *     classification-preservation or determinism regression names
 *     itself instead of showing up as a mysterious full-corpus diff;
 *   - the pipeline half runs the real thing end to end against the
 *     real Operation DarkNet Delhi corpus with no mocking.
 */

const NOW = "2026-09-03T00:00:00.000Z";
const LATER = "2027-01-01T12:34:56.000Z";
const GV = "2026-09-03T00:00:00.000Z";
const INV = "investigation_test";

function prov(source: string, confidence = 0.9, history: string[] = ["stage:test"]): Provenance {
  return {
    source,
    location: `rows/${source}`,
    method: "test:fixture",
    confidence,
    processingHistory: history,
    timestamp: NOW,
  };
}

// --- fixture snapshot ---------------------------------------------------

function source(id: string, label: string, sourceType: EvidenceSource["sourceType"]): EvidenceSource {
  return { id, investigationId: INV, sourceType, label, ingestedAt: NOW };
}

function item(id: string, sourceId: string, itemType: EvidenceItem["itemType"]): EvidenceItem {
  return {
    id,
    investigationId: INV,
    evidenceSourceId: sourceId,
    itemType,
    content: { note: "synthetic" },
    ingestedAt: NOW,
    validationStatus: "accepted",
    errors: [],
    warnings: [],
    confidence: 0.95,
  };
}

function record(id: string, evidenceItemId: string): ExtractedRecord {
  return {
    id,
    evidenceItemId,
    recordType: "entity_mention",
    data: { value: "synthetic" },
    classification: "observed_fact",
    provenance: prov(evidenceItemId, 0.9, ["ingestion", "extraction"]),
  };
}

function entity(id: string, label: string, kind: Entity["kind"] = "person"): Entity {
  return {
    id,
    investigationId: INV,
    kind,
    canonicalLabel: label,
    attributes: {},
    provenance: prov(id, 0.88, ["ingestion", "extraction", "resolution"]),
  };
}

function alias(id: string, entityId: string, value: string): Alias {
  return { id, entityId, aliasValue: value, provenance: prov(entityId) };
}

function decision(
  id: string,
  canonicalEntityId: string,
  overrides: Partial<ResolutionDecision> = {},
): ResolutionDecision {
  return {
    id,
    investigationId: INV,
    canonicalEntityId,
    extractedRecordIds: ["extracted_record_1"],
    resolutionType: "shared_identifier_merge",
    status: "resolved",
    candidateEntityIds: [],
    conflicts: [],
    reason: "Merged on a shared phone identifier stated by its own evidence item.",
    classification: "ai_inference",
    provenance: prov(canonicalEntityId, 0.82, ["extraction", "resolution"]),
    ...overrides,
  };
}

function relationship(
  id: string,
  from: string,
  to: string,
  overrides: Partial<Relationship> = {},
): Relationship {
  return {
    id,
    investigationId: INV,
    sourceEntityId: from,
    targetEntityId: to,
    relationshipType: "communication",
    directed: true,
    evidenceItemIds: ["evidence_item_1", "evidence_item_2"],
    extractedRecordIds: ["extracted_record_1"],
    conflicts: [],
    attributes: { eventCount: 12 },
    classification: "corroborated_fact",
    provenance: prov(id, 0.91, ["extraction", "resolution", "graph_synthesis"]),
    ...overrides,
  };
}

function signal(
  id: string,
  signalType: AnalyticalSignal["signalType"],
  value: Record<string, unknown>,
  targetEntityId?: string,
): AnalyticalSignal {
  return {
    id,
    investigationId: INV,
    graphVersion: GV,
    ...(targetEntityId ? { targetEntityId } : {}),
    signalType,
    value,
    method: `analytics:${signalType}`,
    explanation: `A ${signalType} signal computed over the analysis graph.`,
    classification: "algorithmic_signal",
    provenance: prov(id, 0.8, ["graph_synthesis", "analytics"]),
  };
}

function corroboration(
  id: string,
  overrides: Partial<CorroborationFinding> = {},
): CorroborationFinding {
  return {
    id,
    investigationId: INV,
    graphVersion: GV,
    findingType: "spatial_co_location",
    kind: "spatial",
    entityIds: ["entity_a", "entity_b"],
    locationIds: ["location_1"],
    window: { start: NOW },
    value: { occurrenceCount: 3 },
    method: "corroboration:co_location",
    explanation: "Both subjects were recorded at the same persisted location.",
    classification: "corroborated_fact",
    evidenceItemIds: ["evidence_item_1", "evidence_item_2"],
    supportingRecordIds: ["extracted_record_1", "communication_event_1"],
    provenance: prov(id, 0.87, ["graph_synthesis", "corroboration"]),
    ...overrides,
  };
}

function location(id: string, label: string): Location {
  return {
    id,
    investigationId: INV,
    label,
    locationType: "cell_tower",
    latitude: 28.6,
    longitude: 77.2,
    provenance: prov(id, 0.9, ["ingestion"]),
  };
}

function commEvent(id: string): CommunicationEvent {
  return {
    id,
    investigationId: INV,
    callerPhone: "+91-99000-00001",
    calleePhone: "+91-99000-00002",
    occurredAt: NOW,
    durationSeconds: 90,
    provenance: prov("evidence_item_2", 0.93, ["ingestion"]),
  };
}

function snapshot(overrides: Partial<DossierSnapshot> = {}): DossierSnapshot {
  return {
    investigationId: INV,
    investigationName: "Operation Test Case (synthetic)",
    investigationStatus: "active",
    graphVersion: GV,
    evidenceSources: [source("evidence_source_1", "FIR bundle", "document"), source("evidence_source_2", "CDR extract", "structured_dataset")],
    evidenceItems: [item("evidence_item_1", "evidence_source_1", "fir"), item("evidence_item_2", "evidence_source_2", "cdr_event")],
    extractedRecords: [record("extracted_record_1", "evidence_item_1")],
    entities: [entity("entity_a", "Subject A"), entity("entity_b", "Subject B"), entity("entity_c", "Subject C")],
    aliases: [alias("alias_1", "entity_a", "A. Subject")],
    locations: [location("location_1", "Tower North")],
    communicationEvents: [commEvent("communication_event_1")],
    resolutionDecisions: [
      decision("resolution_decision_1", "entity_a"),
      decision("resolution_decision_2", "entity_c", {
        status: "ambiguous",
        resolutionType: "ambiguous_name_conflict",
        candidateEntityIds: ["entity_a", "entity_b"],
        reason: "The exact name matched two distinct identifier-anchored clusters; it was not merged into either.",
      }),
    ],
    relationships: [
      relationship("relationship_1", "entity_a", "entity_b"),
      relationship("relationship_2", "entity_b", "entity_c", {
        classification: "ai_inference",
        evidenceItemIds: ["evidence_item_2"],
        conflicts: ["Two sources disagree on the direction of this link."],
      }),
    ],
    analyticalSignals: [
      signal("analytical_signal_rank_a", "ranking", { rank: 1, score: 0.91, supportingEdgeIds: ["relationship_1"] }, "entity_a"),
      signal("analytical_signal_rank_b", "ranking", { rank: 2, score: 0.44, supportingEdgeIds: ["relationship_1"] }, "entity_b"),
      signal(
        "analytical_signal_bridge_b",
        "bridge",
        { bridgeScore: 0.7, componentsBefore: 1, componentsAfter: 3, supportingEdgeIds: ["relationship_1", "relationship_2"] },
        "entity_b",
      ),
      signal("analytical_signal_comm_1", "community", {
        clusterId: "c1",
        size: 3,
        memberEntityIds: ["entity_a", "entity_b", "entity_c"],
        representativeEntityIds: ["entity_a"],
        internalEdgeIds: ["relationship_1"],
      }),
    ],
    corroborationFindings: [
      corroboration("corroboration_finding_1"),
      corroboration("corroboration_finding_2", {
        findingType: "spatiotemporal_contradiction",
        kind: "spatiotemporal",
        classification: "algorithmic_signal",
        entityIds: ["entity_a"],
        value: { impliedSpeedMps: 412.5 },
        explanation: "The two placements imply an impossible travel speed.",
      }),
    ],
    ...overrides,
  };
}

function allFindings(sections: { findings: DossierFinding[] }[]): DossierFinding[] {
  return sections.flatMap((s) => s.findings);
}

// --- pure assembly ------------------------------------------------------

describe("dossier assembly — determinism", () => {
  it("produces an identical report id, version and digest for identical case state", () => {
    const a = assembleDeterministicSections(snapshot(), NOW, false);
    const b = assembleDeterministicSections(snapshot(), NOW, false);

    expect(a.contentDigest).toBe(b.contentDigest);
    expect(a.dossierId).toBe(b.dossierId);
    expect(a.reportVersion).toBe(b.reportVersion);
    expect(JSON.stringify(a.sections)).toBe(JSON.stringify(b.sections));
  });

  it("is unaffected by the wall clock — only generatedAt and provenance timestamps move", () => {
    const a = assembleDeterministicSections(snapshot(), NOW, false);
    const b = assembleDeterministicSections(snapshot(), LATER, false);

    expect(b.contentDigest).toBe(a.contentDigest);
    expect(b.dossierId).toBe(a.dossierId);
    expect(b.reportVersion).toBe(a.reportVersion);

    // The timestamps themselves DO follow the clock, so provenance stays truthful.
    const [findingA] = allFindings(a.sections);
    const [findingB] = allFindings(b.sections);
    expect(findingA!.provenance.timestamp).toBe(NOW);
    expect(findingB!.provenance.timestamp).toBe(LATER);
  });

  it("yields a different report identity for a different graph version", () => {
    const a = assembleDeterministicSections(snapshot(), NOW, false);
    const b = assembleDeterministicSections(
      snapshot({
        graphVersion: "2026-09-04T00:00:00.000Z",
        analyticalSignals: snapshot().analyticalSignals.map((s) => ({ ...s, graphVersion: "2026-09-04T00:00:00.000Z" })),
        corroborationFindings: snapshot().corroborationFindings.map((f) => ({
          ...f,
          graphVersion: "2026-09-04T00:00:00.000Z",
        })),
      }),
      NOW,
      false,
    );

    expect(b.dossierId).not.toBe(a.dossierId);
    expect(b.reportVersion).not.toBe(a.reportVersion);
  });

  it("changes the digest when an upstream row actually changes", () => {
    const base = assembleDeterministicSections(snapshot(), NOW, false);
    const changed = assembleDeterministicSections(
      snapshot({ relationships: [relationship("relationship_1", "entity_a", "entity_b"), relationship("relationship_3", "entity_a", "entity_c")] }),
      NOW,
      false,
    );
    expect(changed.contentDigest).not.toBe(base.contentDigest);
  });

  it("orders findings deterministically regardless of input row order", () => {
    const forwards = snapshot();
    const backwards = snapshot({
      evidenceSources: [...forwards.evidenceSources].reverse(),
      relationships: [...forwards.relationships].reverse(),
      analyticalSignals: [...forwards.analyticalSignals].reverse(),
      corroborationFindings: [...forwards.corroborationFindings].reverse(),
      resolutionDecisions: [...forwards.resolutionDecisions].reverse(),
    });

    const a = assembleDeterministicSections(forwards, NOW, false);
    const b = assembleDeterministicSections(backwards, NOW, false);
    expect(b.dossierId).toBe(a.dossierId);
  });

  it("digests distinct reports to distinct values", () => {
    const one = dossierContentDigest(INV, GV, [], ["only limitation"]);
    const two = dossierContentDigest(INV, GV, [], ["a different limitation"]);
    expect(one).not.toBe(two);
  });
});

describe("dossier assembly — classification preservation", () => {
  it("carries each relationship's own classification through unchanged", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const rels = sections.find((s) => s.kind === "key_relationships")!;

    const byId = new Map(rels.findings.map((f) => [f.references.relationshipIds[0], f]));
    expect(byId.get("relationship_1")!.classification).toBe("corroborated_fact");
    expect(byId.get("relationship_2")!.classification).toBe("ai_inference");
  });

  it("never upgrades an entity above AI Inference, however confident the merge", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const entities = sections.find((s) => s.kind === "key_entities")!;
    expect(entities.findings.length).toBeGreaterThan(0);
    for (const f of entities.findings) expect(f.classification).toBe("ai_inference");
  });

  it("keeps every analytical signal an Algorithmic Signal", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const signals = sections.find((s) => s.kind === "analytical_signals")!;
    expect(signals.findings.length).toBeGreaterThan(0);
    for (const f of signals.findings) expect(f.classification).toBe("algorithmic_signal");
  });

  it("keeps every lead an Investigative Lead and never states it as fact", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const leads = sections.find((s) => s.kind === "investigative_leads")!;
    expect(leads.findings.length).toBeGreaterThan(0);
    for (const f of leads.findings) {
      expect(f.classification).toBe("investigative_lead");
      expect(f.explanation).toContain("never a claim of fact");
    }
  });

  it("reserves established-fact wording for observed and corroborated facts", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    for (const f of allFindings(sections)) {
      if (f.classification === "observed_fact" || f.classification === "corroborated_fact") continue;
      // Every non-fact statement attributes itself to the system or asks
      // for verification rather than asserting.
      expect(
        /system (infers|computes|detects|resolves)|Verify|Review|Establish|cannot both be right|flagged/i.test(f.statement),
        `unhedged ${f.classification} statement: ${f.statement}`,
      ).toBe(true);
    }
  });

  it("only ever emits classifications its section permits", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    for (const section of sections) {
      for (const f of section.findings) {
        expect(SECTION_ALLOWED_CLASSIFICATIONS[section.kind]).toContain(f.classification);
      }
    }
  });
});

describe("dossier assembly — contradiction preservation", () => {
  it("keeps a contradiction an Algorithmic Signal and leaves it unresolved", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const contradictions = sections.find((s) => s.kind === "contradictions")!;

    expect(contradictions.findings).toHaveLength(1);
    const finding = contradictions.findings[0]!;
    expect(finding.classification).toBe("algorithmic_signal");
    expect(finding.references.corroborationFindingIds).toContain("corroboration_finding_2");
    expect(finding.explanation).toMatch(/reported, not resolved/i);
    expect(finding.statement).toMatch(/neither is presumed correct/i);
  });

  it("also raises each contradiction as a human-verification lead", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const leads = sections.find((s) => s.kind === "investigative_leads")!;
    expect(leads.findings.some((f) => f.references.corroborationFindingIds.includes("corroboration_finding_2"))).toBe(true);
  });

  it("says a clean check ran rather than implying no check happened", () => {
    const clean = snapshot({ corroborationFindings: [corroboration("corroboration_finding_1")] });
    const { sections } = assembleDeterministicSections(clean, NOW, false);
    const contradictions = sections.find((s) => s.kind === "contradictions")!;

    expect(contradictions.findings).toHaveLength(0);
    expect(contradictions.summary).toMatch(/result of a check that ran/i);
  });
});

describe("dossier assembly — provenance & traceability", () => {
  it("gives every finding at least one persisted reference", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const findings = allFindings(sections);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(countReferences(f.references)).toBeGreaterThan(0);
  });

  it("gives every finding complete provenance ending at the assembly step", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    for (const f of allFindings(sections)) {
      expect(f.provenance.source.length).toBeGreaterThan(0);
      expect(f.provenance.location.length).toBeGreaterThan(0);
      expect(f.provenance.method.length).toBeGreaterThan(0);
      expect(f.provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(f.provenance.confidence).toBeLessThanOrEqual(1);
      expect(f.provenance.processingHistory.at(-1)).toBe("dossier:assemble");
      expect(f.provenance.processingHistory.length).toBeGreaterThan(1);
    }
  });

  it("preserves the upstream processing chain rather than replacing it", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const rels = sections.find((s) => s.kind === "key_relationships")!;
    expect(rels.findings[0]!.provenance.processingHistory).toEqual([
      "extraction",
      "resolution",
      "graph_synthesis",
      "dossier:assemble",
    ]);
  });

  it("carries each source row's own confidence rather than inventing one", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    const rels = sections.find((s) => s.kind === "key_relationships")!;
    const rel1 = rels.findings.find((f) => f.references.relationshipIds.includes("relationship_1"))!;
    expect(rel1.confidence).toBe(0.91);
  });

  it("caps referenced ids deterministically instead of inlining everything", () => {
    const many = snapshot({
      evidenceItems: Array.from({ length: 60 }, (_, i) => item(`evidence_item_${String(i).padStart(3, "0")}`, "evidence_source_1", "fir")),
    });
    const { sections } = assembleDeterministicSections(many, NOW, false);
    const inventory = sections.find((s) => s.kind === "evidence_inventory")!;
    const src1 = inventory.findings.find((f) => f.references.evidenceSourceIds.includes("evidence_source_1"))!;

    expect(src1.references.evidenceItemIds).toHaveLength(25);
    expect(src1.references.evidenceItemIds[0]).toBe("evidence_item_000");
    // The population is still stated, so nothing is silently dropped.
    expect(src1.statement).toContain("60");
  });
});

describe("dossier assembly — structure", () => {
  it("emits all twelve sections exactly once, in report order", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    // The copilot_material section is attached by the service, not here.
    expect(sections.map((s) => s.kind)).toEqual([
      "case_summary",
      "evidence_inventory",
      "key_entities",
      "key_relationships",
      "analytical_signals",
      "corroboration",
      "contradictions",
      "investigative_leads",
      "provenance_index",
      "classification_confidence",
      "limitations",
    ]);
  });

  it("keeps narrative sections free of findings", () => {
    const { sections } = assembleDeterministicSections(snapshot(), NOW, false);
    for (const s of sections) {
      if (isNarrativeSection(s.kind)) expect(s.findings).toHaveLength(0);
      expect(() => DossierSectionSchema.parse(s)).not.toThrow();
    }
  });

  it("always states limitations, including the synthetic-data and non-conclusion limits", () => {
    const { limitations } = assembleDeterministicSections(snapshot(), NOW, false);
    expect(limitations.length).toBeGreaterThan(0);
    expect(limitations.join(" ")).toMatch(/entirely synthetic/i);
    expect(limitations.join(" ")).toMatch(/decision support for a human reviewer/i);
    expect(limitations.join(" ")).toMatch(/not contact, association, or causation/i);
  });

  it("states that no AI synthesis was performed when no key is configured", () => {
    const withoutKey = assembleDeterministicSections(snapshot(), NOW, false);
    expect(withoutKey.limitations.join(" ")).toMatch(/No AI provider key was configured/i);
    expect(withoutKey.limitations.join(" ")).toMatch(/none was invented in its place/i);

    const withKey = assembleDeterministicSections(snapshot(), NOW, true);
    expect(withKey.limitations.join(" ")).toMatch(/worded by a language model/i);
  });

  it("records that ground truth is held out of the reporting path", () => {
    const { limitations } = assembleDeterministicSections(snapshot(), NOW, false);
    expect(limitations.join(" ")).toMatch(/ground truth .* held out/i);
  });

  it("honours the documented per-section selection limits", () => {
    const manyEntities = Array.from({ length: 40 }, (_, i) => entity(`entity_${i}`, `Subject ${i}`));
    const manySignals = manyEntities.map((e, i) =>
      signal(`analytical_signal_rank_${i}`, "ranking", { rank: i + 1, score: 1 - i / 100, supportingEdgeIds: [] }, e.id),
    );
    const { sections } = assembleDeterministicSections(
      snapshot({ entities: manyEntities, analyticalSignals: manySignals }),
      NOW,
      false,
    );
    const keyEntities = sections.find((s) => s.kind === "key_entities")!;
    expect(keyEntities.findings).toHaveLength(SECTION_LIMITS.keyEntities);
    expect(keyEntities.summary).toContain("40");
  });
});

// --- schema contract ----------------------------------------------------

describe("dossier contract — the schema refuses what the report must never say", () => {
  const baseFinding: DossierFinding = {
    id: "dossier_finding_x",
    sectionKind: "contradictions",
    statement: "Two sources disagree.",
    classification: "algorithmic_signal",
    confidence: 0.5,
    derivationMethod: "dossier:contradictions",
    explanation: "Flagged and left unresolved.",
    references: {
      evidenceSourceIds: [],
      evidenceItemIds: [],
      extractedRecordIds: [],
      entityIds: [],
      locationIds: [],
      resolutionDecisionIds: [],
      communicationEventIds: [],
      relationshipIds: [],
      analyticalSignalIds: [],
      corroborationFindingIds: ["corroboration_finding_2"],
    },
    provenance: prov("corroboration_finding_2", 0.5, ["corroboration", "dossier:assemble"]),
  };

  it("accepts a well-formed finding", () => {
    expect(() => DossierFindingSchema.parse(baseFinding)).not.toThrow();
  });

  it("rejects a contradiction promoted to a corroborated fact", () => {
    expect(() =>
      DossierFindingSchema.parse({ ...baseFinding, classification: "corroborated_fact" }),
    ).toThrow(/not permitted in this dossier section/);
  });

  it("rejects a lead promoted to an observed fact", () => {
    expect(() =>
      DossierFindingSchema.parse({
        ...baseFinding,
        sectionKind: "investigative_leads",
        classification: "observed_fact",
      }),
    ).toThrow(/not permitted in this dossier section/);
  });

  it("rejects an analytical signal recorded as an AI inference", () => {
    expect(() =>
      DossierFindingSchema.parse({
        ...baseFinding,
        sectionKind: "analytical_signals",
        classification: "ai_inference",
      }),
    ).toThrow(/not permitted in this dossier section/);
  });

  it("rejects a finding that cites nothing", () => {
    expect(() =>
      DossierFindingSchema.parse({
        ...baseFinding,
        references: { ...baseFinding.references, corroborationFindingIds: [] },
      }),
    ).toThrow(/must reference at least one persisted record/);
  });

  it("rejects a narrative section that smuggles in findings", () => {
    expect(() =>
      DossierSectionSchema.parse({
        kind: "limitations",
        title: "Limitations",
        summary: "s",
        sourceStages: ["P5.9"],
        findings: [{ ...baseFinding, sectionKind: "limitations" }],
        notes: [],
      }),
    ).toThrow();
  });

  it("rejects a report that switches off its own synthetic-data or verification declarations", () => {
    const { sections, limitations, dossierId, reportVersion } = assembleDeterministicSections(
      snapshot(),
      NOW,
      false,
    );
    const counts = emptyClassificationCensus();
    for (const f of allFindings(sections)) counts[f.classification] += 1;

    const base = {
      id: dossierId,
      investigationId: INV,
      investigationName: "Operation Test Case (synthetic)",
      graphVersion: GV,
      reportVersion,
      title: "t",
      generatedAt: NOW,
      syntheticDataOnly: true,
      humanVerificationRequired: true,
      aiSynthesisAvailable: false,
      aiSynthesisNote: "n",
      sections,
      copilotExcerpts: [],
      limitations,
      counts: {
        sections: sections.length,
        findings: allFindings(sections).length,
        evidenceSources: 2,
        evidenceItems: 2,
        entities: 3,
        relationships: 2,
        analyticalSignals: 4,
        corroborationFindings: 2,
        contradictions: 1,
        leads: sections.find((s) => s.kind === "investigative_leads")!.findings.length,
        copilotExcerpts: 0,
        byClassification: counts,
      },
      provenance: prov(INV, 1, ["corroboration", "dossier:assemble"]),
    };

    expect(() => DossierSchema.parse(base)).not.toThrow();
    expect(() => DossierSchema.parse({ ...base, syntheticDataOnly: false })).toThrow();
    expect(() => DossierSchema.parse({ ...base, humanVerificationRequired: false })).toThrow();
    expect(() => DossierSchema.parse({ ...base, limitations: [] })).toThrow();
  });
});

// --- traceability verification ------------------------------------------

/**
 * `assertTraceability` reports the summary in `message` and the specific
 * problems in `issues` — a reader should be told which finding failed,
 * not just that one did. Tests therefore assert on `issues`.
 */
function traceabilityIssues(fn: () => unknown): string[] {
  try {
    fn();
  } catch (err) {
    const issues = (err as { issues?: string[] }).issues;
    return issues ?? [`(no issues) ${(err as Error).message}`];
  }
  throw new Error("expected assertTraceability to throw, but it passed");
}

describe("dossier verification — fails loudly rather than emitting a partial report", () => {
  function reportFor(snap: DossierSnapshot): Dossier {
    const { sections, limitations, dossierId, reportVersion } = assembleDeterministicSections(snap, NOW, false);
    const byClassification = emptyClassificationCensus();
    for (const f of allFindings(sections)) byClassification[f.classification] += 1;
    return validateReport({
      id: dossierId,
      investigationId: snap.investigationId,
      investigationName: snap.investigationName,
      graphVersion: snap.graphVersion,
      reportVersion,
      title: "Test dossier",
      generatedAt: NOW,
      syntheticDataOnly: true,
      humanVerificationRequired: true,
      aiSynthesisAvailable: false,
      aiSynthesisNote: "No AI provider key is configured.",
      sections,
      copilotExcerpts: [],
      limitations,
      counts: {
        sections: sections.length,
        findings: allFindings(sections).length,
        evidenceSources: snap.evidenceSources.length,
        evidenceItems: snap.evidenceItems.length,
        entities: snap.entities.length,
        relationships: snap.relationships.length,
        analyticalSignals: snap.analyticalSignals.length,
        corroborationFindings: snap.corroborationFindings.length,
        contradictions: 1,
        leads: sections.find((s) => s.kind === "investigative_leads")!.findings.length,
        copilotExcerpts: 0,
        byClassification,
      },
      provenance: prov(snap.investigationId, 1, ["corroboration", "dossier:assemble"]),
    });
  }

  it("passes a well-formed report and reports how many findings it verified", () => {
    const snap = snapshot();
    const report = reportFor(snap);
    const verified = assertTraceability(report, knownIdsFrom(snap), snap.graphVersion);
    expect(verified).toBe(report.counts.findings);
    expect(verified).toBeGreaterThan(0);
  });

  it("rejects a reference that does not resolve to a persisted record", () => {
    const snap = snapshot();
    const report = reportFor(snap);
    const tampered: Dossier = {
      ...report,
      sections: report.sections.map((s) =>
        s.kind !== "contradictions"
          ? s
          : {
              ...s,
              findings: s.findings.map((f) => ({
                ...f,
                references: { ...f.references, corroborationFindingIds: ["corroboration_finding_does_not_exist"] },
              })),
            },
      ),
    };
    const issues = traceabilityIssues(() => assertTraceability(tampered, knownIdsFrom(snap), snap.graphVersion));
    expect(issues.join(" ")).toMatch(/does not resolve to a persisted record/);
  });

  it("rejects a report stamped with a graph version this run did not assemble", () => {
    const snap = snapshot();
    const report = reportFor(snap);
    const issues = traceabilityIssues(() =>
      assertTraceability(report, knownIdsFrom(snap), "some-other-graph-version"),
    );
    expect(issues.join(" ")).toMatch(/does not match the graph version this run assembled/);
  });

  it("rejects a classification upgrade that bypassed the schema", () => {
    const snap = snapshot();
    const report = reportFor(snap);
    const tampered = {
      ...report,
      sections: report.sections.map((s) =>
        s.kind !== "contradictions"
          ? s
          : { ...s, findings: s.findings.map((f) => ({ ...f, classification: "corroborated_fact" as const })) },
      ),
    } as Dossier;
    const issues = traceabilityIssues(() => assertTraceability(tampered, knownIdsFrom(snap), snap.graphVersion));
    expect(issues.join(" ")).toMatch(/must remain an Algorithmic Signal|may never relabel a claim/);
  });

  it("rejects a finding whose provenance chain was truncated", () => {
    const snap = snapshot();
    const report = reportFor(snap);
    const tampered = {
      ...report,
      sections: report.sections.map((s) =>
        s.kind !== "key_relationships"
          ? s
          : {
              ...s,
              findings: s.findings.map((f) => ({
                ...f,
                provenance: { ...f.provenance, processingHistory: ["graph_synthesis"] },
              })),
            },
      ),
    } as Dossier;
    const issues = traceabilityIssues(() => assertTraceability(tampered, knownIdsFrom(snap), snap.graphVersion));
    expect(issues.join(" ")).toMatch(/does not end at the dossier assembly step/);
  });

  it("rejects an excerpt claiming AI synthesis on a run that had none", () => {
    const snap = snapshot();
    const report = reportFor(snap);
    const tampered = {
      ...report,
      copilotExcerpts: [
        {
          questionId: "dq1",
          question: "q",
          status: "answered" as const,
          answer: "a",
          grounding: "fully_grounded" as const,
          classification: "observed_fact" as const,
          confidence: 0.9,
          synthesisMode: "llm_synthesis" as const,
          aiSynthesized: true,
          claimCount: 1,
          references: {
            evidenceSourceIds: [],
            evidenceItemIds: ["evidence_item_1"],
            extractedRecordIds: [],
            entityIds: [],
            locationIds: [],
            resolutionDecisionIds: [],
            communicationEventIds: [],
            relationshipIds: [],
            analyticalSignalIds: [],
            corroborationFindingIds: [],
          },
          note: null,
        },
      ],
    } as Dossier;
    const issues = traceabilityIssues(() => assertTraceability(tampered, knownIdsFrom(snap), snap.graphVersion));
    expect(issues.join(" ")).toMatch(/marked AI-synthesized on a run with no AI synthesis available/);
  });

  it("rejects an assembled report whose validation fails, without writing anything", () => {
    expect(() => validateReport({ id: "", sections: [] })).toThrow(/failed validation/);
  });
});

// --- ground-truth isolation ---------------------------------------------

/** Identifiers that exist only in the held-out answer key — none may appear in the reporting path. */
const GROUND_TRUTH_KEYS = [
  "recoverableBy",
  "aliasMap",
  "temporalCorrelations",
  "spatialCorrelations",
  "HIDDEN_CONNECTION",
  "TEMPORAL_CORRELATIONS",
  "CONTRADICTIONS",
  "expectedAnswer",
  "answer_key",
];

describe("dossier — ground-truth isolation", () => {
  /**
   * Comments are stripped before scanning, matching the convention the
   * corroboration suite already uses: a comment SAYING the layer never
   * reads ground truth is the documentation of the guarantee, not a
   * violation of it.
   */
  function codeOf(file: string): string {
    return fs
      .readFileSync(path.join(process.cwd(), "src/lib/dossier", file), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  function dossierFiles(): string[] {
    const files = fs.readdirSync(path.join(process.cwd(), "src/lib/dossier")).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    return files;
  }

  it("never imports or references the held-out answer key from any dossier source file", () => {
    for (const file of dossierFiles()) {
      const code = codeOf(file);
      expect(code, file).not.toMatch(/from\s+["'][^"']*ground-truth[^"']*["']/);
      expect(code, file).not.toMatch(/import\(\s*["'][^"']*ground-truth/);
      expect(code, file).not.toMatch(/evidence\/ground-truth/);
      expect(code, file).not.toMatch(/loadInvestigationGroundTruth|loadGroundTruthFixture/);
      for (const key of GROUND_TRUTH_KEYS) expect(code, `${file}: ${key}`).not.toContain(key);
    }
  });

  it("never reads the filesystem or the network from the dossier layer", () => {
    for (const file of dossierFiles()) {
      const code = codeOf(file);
      // node:crypto, for the content digest, is the only node builtin the
      // layer is allowed. Filesystem and network access are not.
      expect(code, `${file} imports node:fs`).not.toMatch(/from\s+["']node:fs["']/);
      expect(code, `${file} calls fetch`).not.toMatch(/\bfetch\(/);
      expect(code, `${file} opens a socket`).not.toMatch(/XMLHttpRequest|WebSocket/);
    }
  });
});

// --- full pipeline ------------------------------------------------------

type DossierModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  runExtraction: typeof import("@/lib/extraction/service").runExtraction;
  runResolution: typeof import("@/lib/resolution/service").runResolution;
  runGraphSynthesis: typeof import("@/lib/graph/service").runGraphSynthesis;
  runAnalyticsSynthesis: typeof import("@/lib/analytics/service").runAnalyticsSynthesis;
  runCorroborationSynthesis: typeof import("@/lib/corroboration/service").runCorroborationSynthesis;
  runDossierGeneration: typeof import("@/lib/dossier/service").runDossierGeneration;
  getDossierState: typeof import("@/lib/dossier/summary").getDossierState;
  getDossierDetail: typeof import("@/lib/dossier/summary").getDossierDetail;
  repo: typeof import("@/lib/db/repository");
};

async function freshDossier(dbPath: string): Promise<DossierModule> {
  await prepareFreshDb(dbPath);
  vi.resetModules();
  process.env.DATABASE_URL = dbPath;
  delete process.env.AI_PROVIDER_API_KEY;

  const [ingestion, extraction, resolution, graph, analytics, corroboration, service, summary, repo] =
    await Promise.all([
      import("@/lib/ingestion/service"),
      import("@/lib/extraction/service"),
      import("@/lib/resolution/service"),
      import("@/lib/graph/service"),
      import("@/lib/analytics/service"),
      import("@/lib/corroboration/service"),
      import("@/lib/dossier/service"),
      import("@/lib/dossier/summary"),
      import("@/lib/db/repository"),
    ]);

  return {
    runIngestion: ingestion.runIngestion,
    runExtraction: extraction.runExtraction,
    runResolution: resolution.runResolution,
    runGraphSynthesis: graph.runGraphSynthesis,
    runAnalyticsSynthesis: analytics.runAnalyticsSynthesis,
    runCorroborationSynthesis: corroboration.runCorroborationSynthesis,
    runDossierGeneration: service.runDossierGeneration,
    getDossierState: summary.getDossierState,
    getDossierDetail: summary.getDossierDetail,
    repo,
  };
}

async function advanceToCorroboration(mod: DossierModule): Promise<void> {
  expect((await mod.runIngestion({ kind: "builtin-corpus" })).status).toBe("ingested");
  expect((await mod.runExtraction()).status).toBe("extracted");
  expect((await mod.runResolution()).status).toBe("resolved");
  expect((await mod.runGraphSynthesis()).status).toBe("synthesized");
  expect((await mod.runAnalyticsSynthesis()).status).toBe("synthesized");
  expect((await mod.runCorroborationSynthesis()).status).toBe("synthesized");
}

describe("dossier generation — full Operation DarkNet Delhi corpus", () => {
  const DB = "./data/cipher-dossier-full.db";
  let mod: DossierModule;
  let result: Awaited<ReturnType<DossierModule["runDossierGeneration"]>>;

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("runs all eleven stages to completion against the real corpus", async () => {
    mod = await freshDossier(DB);
    await advanceToCorroboration(mod);
    result = await mod.runDossierGeneration();

    expect(result.error).toBeNull();
    expect(result.status).toBe("generated");
    expect(result.stages).toHaveLength(11);
    for (const stage of result.stages) {
      expect(stage.status, `${stage.stage}: ${stage.detail}`).toBe("ok");
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    expect(result.persisted).toEqual({ created: 1, skipped: 0 });
  }, 300_000);

  it("produces a report with every section and a non-empty classification census", async () => {
    const detail = await mod.getDossierDetail();
    expect(detail).not.toBeNull();
    const { dossier } = detail!;

    expect(dossier.sections.map((s) => s.kind)).toEqual([
      "case_summary",
      "evidence_inventory",
      "key_entities",
      "key_relationships",
      "analytical_signals",
      "corroboration",
      "contradictions",
      "investigative_leads",
      "copilot_material",
      "provenance_index",
      "classification_confidence",
      "limitations",
    ]);
    expect(dossier.counts.findings).toBeGreaterThan(0);
    expect(dossier.counts.byClassification.observed_fact).toBeGreaterThan(0);
    expect(dossier.counts.byClassification.ai_inference).toBeGreaterThan(0);
    expect(dossier.counts.byClassification.algorithmic_signal).toBeGreaterThan(0);
    expect(dossier.syntheticDataOnly).toBe(true);
    expect(dossier.humanVerificationRequired).toBe(true);
    expect(dossier.limitations.length).toBeGreaterThan(0);
  }, 120_000);

  it("reloads the persisted report through the validated repository unchanged", async () => {
    const stored = await mod.repo.getDossierById(result.dossierId!);
    expect(stored).not.toBeNull();
    expect(stored!.reportVersion).toBe(result.reportVersion);
    expect(stored!.counts.findings).toBe(result.counts!.findings);
    expect(() => DossierSchema.parse(stored)).not.toThrow();
  }, 60_000);

  it("resolves every reference in the report to a live persisted row", async () => {
    const detail = await mod.getDossierDetail();
    const { dossier, references } = detail!;

    let checked = 0;
    for (const section of dossier.sections) {
      for (const finding of section.findings) {
        const ids = [
          ...finding.references.evidenceSourceIds,
          ...finding.references.evidenceItemIds,
          ...finding.references.extractedRecordIds,
          ...finding.references.entityIds,
          ...finding.references.locationIds,
          ...finding.references.resolutionDecisionIds,
          ...finding.references.communicationEventIds,
          ...finding.references.relationshipIds,
          ...finding.references.analyticalSignalIds,
          ...finding.references.corroborationFindingIds,
        ];
        expect(ids.length).toBeGreaterThan(0);
        for (const id of ids) {
          expect(references[id], `unresolved reference ${id}`).toBeDefined();
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  }, 120_000);

  it("offers a navigable view for the references that have one", async () => {
    const { references } = (await mod.getDossierDetail())!;
    const resolved = Object.values(references);
    expect(resolved.some((r) => r.view === "graph" && r.focusEntityId !== null)).toBe(true);
    expect(resolved.some((r) => r.view === "analytics")).toBe(true);
    expect(resolved.some((r) => r.view === "corroboration")).toBe(true);
    expect(resolved.some((r) => r.view === "evidence")).toBe(true);
  }, 60_000);

  it("reports generated state, not stale, at the current graph version", async () => {
    const state = await mod.getDossierState();
    expect(state.status).toBe("generated");
    if (state.status !== "generated") throw new Error("unreachable");
    expect(state.summary.dossierId).toBe(result.dossierId);
    expect(state.summary.reportVersion).toBe(result.reportVersion);

    const detail = await mod.getDossierDetail();
    expect(detail!.stale).toBe(false);
  }, 60_000);

  it("is idempotent — regenerating identical state writes nothing and keeps the same identity", async () => {
    const again = await mod.runDossierGeneration();

    expect(again.status).toBe("already_generated");
    expect(again.error).toBeNull();
    expect(again.dossierId).toBe(result.dossierId);
    expect(again.reportVersion).toBe(result.reportVersion);
    expect(again.persisted).toEqual({ created: 0, skipped: 1 });
    expect(again.counts!.findings).toBe(result.counts!.findings);

    expect(await mod.repo.listDossiers()).toHaveLength(1);
  }, 300_000);

  it("keeps the original generation time on an idempotent re-run", async () => {
    const state = await mod.getDossierState();
    if (state.status !== "generated") throw new Error("unreachable");
    const stored = await mod.repo.getDossierById(result.dossierId!);
    expect(state.summary.generatedAt).toBe(stored!.generatedAt);
  }, 60_000);

  it("preserves every contradiction as an algorithmic signal in the persisted report", async () => {
    const { dossier } = (await mod.getDossierDetail())!;
    const contradictions = dossier.sections.find((s) => s.kind === "contradictions")!;
    expect(contradictions.findings.length).toBeGreaterThan(0);
    for (const f of contradictions.findings) expect(f.classification).toBe("algorithmic_signal");

    const persistedContradictions = (await mod.repo.listCorroborationFindings()).filter(
      (f) => f.findingType === "spatiotemporal_contradiction",
    );
    expect(persistedContradictions.length).toBeGreaterThan(0);
    for (const f of contradictions.findings) {
      expect(persistedContradictions.some((p) => f.references.corroborationFindingIds.includes(p.id))).toBe(true);
    }
  }, 120_000);

  it("labels Copilot material deterministic and AI synthesis unavailable with no key", async () => {
    const { dossier } = (await mod.getDossierDetail())!;

    expect(dossier.aiSynthesisAvailable).toBe(false);
    expect(dossier.aiSynthesisNote).toMatch(/No AI provider key is configured/i);
    expect(dossier.aiSynthesisNote).toMatch(/none was invented in its place/i);

    expect(dossier.copilotExcerpts.length).toBeGreaterThan(0);
    for (const excerpt of dossier.copilotExcerpts) {
      // The whole point: no key must not mean no grounded material, and
      // must never mean fabricated material.
      expect(excerpt.aiSynthesized).toBe(false);
      expect(excerpt.synthesisMode === null || excerpt.synthesisMode === "deterministic").toBe(true);
      if (excerpt.status === "unavailable") {
        expect(excerpt.answer).toBeNull();
        expect(excerpt.note).not.toBeNull();
      } else {
        expect(excerpt.answer).not.toBeNull();
        expect(excerpt.grounding).not.toBeNull();
      }
    }

    const copilotSection = dossier.sections.find((s) => s.kind === "copilot_material")!;
    expect(copilotSection.notes.join(" ")).toMatch(/No AI provider key is configured/i);
  }, 120_000);

  it("never leaks ground truth into the persisted report", async () => {
    const stored = await mod.repo.getDossierById(result.dossierId!);
    const serialized = JSON.stringify(stored);
    for (const forbidden of ["ground-truth", "groundTruth", "ground_truth", "expectedAnswer", "answer_key"]) {
      expect(serialized, `persisted dossier contains "${forbidden}"`).not.toContain(forbidden);
    }
  }, 60_000);

  it("keeps every user-facing string free of filesystem paths and secrets", async () => {
    const stored = await mod.repo.getDossierById(result.dossierId!);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toMatch(/[A-Za-z]:\\\\/);
    expect(serialized).not.toContain("/Users/");
    expect(serialized).not.toContain("node_modules");
    expect(serialized).not.toMatch(/sk-ant/);
  }, 60_000);
});

describe("dossier generation — stale graph handling", () => {
  const DB = "./data/cipher-dossier-stale.db";

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("marks a report stale once the graph it describes is superseded", async () => {
    const mod = await freshDossier(DB);
    await advanceToCorroboration(mod);
    const first = await mod.runDossierGeneration();
    expect(first.status).toBe("generated");

    // Move the graph on without regenerating the report: the existing
    // dossier still describes a real past state, but it is no longer a
    // description of the case as it now stands.
    const { setGraphMarker, graphMarkerKey } = await import("@/lib/graph/marker");
    const { getGraphMarker } = await import("@/lib/graph/marker");
    const key = graphMarkerKey(first.investigationId!);
    const marker = await getGraphMarker(key);
    await setGraphMarker(key, { ...marker!, synthesizedAt: "2099-01-01T00:00:00.000Z" });

    const state = await mod.getDossierState();
    // Analytics/corroboration have not run against the new version, so
    // the screen correctly reports the upstream gap first.
    expect(["stale", "not_available"]).toContain(state.status);

    const detail = await mod.getDossierDetail();
    expect(detail).not.toBeNull();
    expect(detail!.stale).toBe(true);
    expect(detail!.currentGraphVersion).toBe("2099-01-01T00:00:00.000Z");
    expect(detail!.dossier.graphVersion).toBe(first.graphVersion);
  }, 300_000);
});

describe("dossier generation — structured errors on an incomplete pipeline", () => {
  const DB = "./data/cipher-dossier-empty.db";

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("reports NO_INVESTIGATION on a completely empty database, with no filesystem path in the message", async () => {
    const mod = await freshDossier(DB);
    const result = await mod.runDossierGeneration();

    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_INVESTIGATION");
    expect(result.error?.stage).toBe("load_case_state");
    expect(result.error?.message).not.toMatch(/[A-Za-z]:\\/);
    expect(result.error?.message).not.toContain("/");
    expect(await mod.repo.listDossiers()).toHaveLength(0);
  }, 60_000);

  it("reports NO_GRAPH when the graph has not been synthesized", async () => {
    const mod = await freshDossier(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
    await mod.runResolution();

    const result = await mod.runDossierGeneration();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_GRAPH");
    expect(await mod.repo.listDossiers()).toHaveLength(0);
  }, 300_000);

  it("reports NO_DERIVED_INTELLIGENCE when analytics has not run against the current graph", async () => {
    const mod = await freshDossier(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
    await mod.runResolution();
    await mod.runGraphSynthesis();

    const result = await mod.runDossierGeneration();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_DERIVED_INTELLIGENCE");
    expect(result.error?.message).toMatch(/analytics/i);

    const state = await mod.getDossierState();
    expect(state.status).toBe("not_available");
    expect(await mod.repo.listDossiers()).toHaveLength(0);
  }, 300_000);
});
