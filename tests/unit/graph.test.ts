import { describe, expect, it } from "vitest";

import { createEmptyGraph } from "@/lib/graph";
import { synthesizeGraph } from "@/lib/graph/build";
import { makeContentId } from "@/lib/domain/ids";
import type { Entity } from "@/lib/domain/entity";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { ResolutionDecision } from "@/lib/domain/resolution";

describe("createEmptyGraph", () => {
  it("creates a directed, empty graphology graph", () => {
    const graph = createEmptyGraph();

    expect(graph.order).toBe(0);
    expect(graph.size).toBe(0);
    expect(graph.type).toBe("directed");
  });
});

const NOW = "2026-09-02T00:00:00.000Z";

function baseProvenance(source: string, location: string) {
  return {
    source,
    location,
    method: "test",
    confidence: 1,
    processingHistory: [`evidence_item:${source}`],
    timestamp: NOW,
  };
}

function personEntity(id: string, label: string): Entity {
  return {
    id,
    investigationId: "inv1",
    kind: "person",
    canonicalLabel: label,
    attributes: {},
    provenance: baseProvenance(id, "loc"),
  };
}

function identifierEntity(id: string, kind: Entity["kind"], value: string): Entity {
  return {
    id,
    investigationId: "inv1",
    kind,
    canonicalLabel: value,
    attributes: {},
    provenance: baseProvenance(id, "loc"),
  };
}

function decision(canonicalEntityId: string, extractedRecordId: string): ResolutionDecision {
  return {
    id: makeContentId("resolution_decision", [extractedRecordId]),
    investigationId: "inv1",
    canonicalEntityId,
    extractedRecordIds: [extractedRecordId],
    resolutionType: "new_entity",
    status: "resolved",
    candidateEntityIds: [],
    conflicts: [],
    reason: "test",
    classification: "ai_inference",
    provenance: baseProvenance(extractedRecordId, "loc"),
  };
}

function record(
  id: string,
  evidenceItemId: string,
  recordType: ExtractedRecord["recordType"],
  data: Record<string, unknown>,
): ExtractedRecord {
  return {
    id,
    evidenceItemId,
    recordType,
    data,
    classification: "observed_fact",
    provenance: baseProvenance(evidenceItemId, `${evidenceItemId}#field`),
  };
}

describe("synthesizeGraph — ownership edges via same-item sibling lookup", () => {
  it("links a person to a phone via has_phone using the sibling person entity_mention, not name matching", () => {
    const personEntityMention = record("er_p1", "item1", "entity_mention", {
      mentionKind: "person",
      observedValue: "Test Person",
    });
    const hasPhone = record("er_r1", "item1", "relationship_mention", {
      relationshipType: "has_phone",
      subject: "Test Person",
      observedValue: "+91-000",
    });
    const phoneEntityMention = record("er_p2", "item2", "entity_mention", {
      mentionKind: "phone",
      observedValue: "+91-000",
    });

    const personId = makeContentId("entity", ["person", "er_p1"]);
    const phoneId = makeContentId("entity", ["phone", "+91-000"]);

    const entities = [personEntity(personId, "Test Person"), identifierEntity(phoneId, "phone", "+91-000")];
    const decisions = [decision(personId, "er_p1"), decision(phoneId, "er_p2")];
    const records = [personEntityMention, hasPhone, phoneEntityMention];

    const output = synthesizeGraph(entities, [], decisions, records, "inv1", NOW);

    const edge = output.relationships.find((r) => r.relationshipType === "ownership");
    expect(edge).toBeDefined();
    expect(edge!.sourceEntityId).toBe(personId);
    expect(edge!.targetEntityId).toBe(phoneId);
    expect(edge!.extractedRecordIds).toContain("er_r1");
    expect(edge!.classification).toBe("observed_fact");
    expect(edge!.directed).toBe(true);
    expect(output.warnings).toEqual([]);
  });

  it("corroborates the same edge when a second, distinct evidence item states the same link", () => {
    const personEntityMention = record("er_p1", "item1", "entity_mention", {
      mentionKind: "person",
      observedValue: "Test Person",
    });
    const hasPhone = record("er_r1", "item1", "relationship_mention", {
      relationshipType: "has_phone",
      subject: "Test Person",
      observedValue: "+91-000",
    });
    const phoneEntityMention = record("er_p2", "item2", "entity_mention", {
      mentionKind: "phone",
      observedValue: "+91-000",
    });
    const subscriberRel = record("er_r2", "item2", "relationship_mention", {
      relationshipType: "phone_subscriber",
      subject: "+91-000",
      observedValue: "Test Person",
    });

    const personId = makeContentId("entity", ["person", "er_p1"]);
    const phoneId = makeContentId("entity", ["phone", "+91-000"]);

    const entities = [personEntity(personId, "Test Person"), identifierEntity(phoneId, "phone", "+91-000")];
    const decisions = [decision(personId, "er_p1"), decision(phoneId, "er_p2")];
    const records = [personEntityMention, hasPhone, phoneEntityMention, subscriberRel];

    const output = synthesizeGraph(entities, [], decisions, records, "inv1", NOW);
    const edges = output.relationships.filter((r) => r.relationshipType === "ownership");
    expect(edges).toHaveLength(1); // aggregated, not duplicated
    expect(edges[0]!.evidenceItemIds.sort()).toEqual(["item1", "item2"]);
    expect(edges[0]!.classification).toBe("corroborated_fact");
  });
});

describe("synthesizeGraph — identifier-anchored ownership via bounded name lookup", () => {
  it("resolves vehicle_registered_to via the already-resolved canonical registry, never a new merge", () => {
    const vehicleEntityMention = record("er_v1", "item_v1", "entity_mention", {
      mentionKind: "vehicle",
      observedValue: "SYN-VEH-0099",
    });
    const registeredTo = record("er_v2", "item_v1", "relationship_mention", {
      relationshipType: "vehicle_registered_to",
      subject: "SYN-VEH-0099",
      observedValue: "Registrant Person",
    });

    const personId = makeContentId("entity", ["person", "isolated"]);
    const vehicleId = makeContentId("entity", ["vehicle", "SYN-VEH-0099"]);
    const entities = [personEntity(personId, "Registrant Person"), identifierEntity(vehicleId, "vehicle", "SYN-VEH-0099")];
    const decisions = [decision(vehicleId, "er_v1")];
    const records = [vehicleEntityMention, registeredTo];

    const output = synthesizeGraph(entities, [], decisions, records, "inv1", NOW);
    const edge = output.relationships.find((r) => r.relationshipType === "ownership");
    expect(edge).toBeDefined();
    expect(edge!.sourceEntityId).toBe(personId);
    expect(edge!.targetEntityId).toBe(vehicleId);
  });

  it("drops the contribution when the name matches zero or multiple canonical persons, never guessing", () => {
    const vehicleEntityMention = record("er_v1", "item_v1", "entity_mention", {
      mentionKind: "vehicle",
      observedValue: "SYN-VEH-0100",
    });
    const registeredTo = record("er_v2", "item_v1", "relationship_mention", {
      relationshipType: "vehicle_registered_to",
      subject: "SYN-VEH-0100",
      observedValue: "Ambiguous Person",
    });
    const personA = makeContentId("entity", ["person", "a"]);
    const personB = makeContentId("entity", ["person", "b"]);
    const vehicleId = makeContentId("entity", ["vehicle", "SYN-VEH-0100"]);
    const entities = [
      { ...personEntity(personA, "Ambiguous Person") },
      { ...personEntity(personB, "Ambiguous Person") },
      identifierEntity(vehicleId, "vehicle", "SYN-VEH-0100"),
    ];
    const decisions = [decision(vehicleId, "er_v1")];
    const records = [vehicleEntityMention, registeredTo];

    const output = synthesizeGraph(entities, [], decisions, records, "inv1", NOW);
    expect(output.relationships).toEqual([]);
    expect(output.warnings.some((w) => w.includes("did not resolve to exactly one"))).toBe(true);
  });
});

describe("synthesizeGraph — financial chain and non-invention of a direct link", () => {
  it("builds a 3-hop A→B→C financial chain without inventing an A→C edge", () => {
    const accA = identifierEntity(makeContentId("entity", ["bank_account", "AC-A"]), "bank_account", "AC-A");
    const accB = identifierEntity(makeContentId("entity", ["bank_account", "AC-B"]), "bank_account", "AC-B");
    const accC = identifierEntity(makeContentId("entity", ["bank_account", "AC-C"]), "bank_account", "AC-C");
    const entities = [accA, accB, accC];
    const txn1 = record("er_t1", "item_t1", "event_mention", {
      eventKind: "financial_transaction",
      fromAccount: "AC-A",
      toAccount: "AC-B",
      amount: 1000,
      currency: "INR",
      valueDate: NOW,
    });
    const txn2 = record("er_t2", "item_t2", "event_mention", {
      eventKind: "financial_transaction",
      fromAccount: "AC-B",
      toAccount: "AC-C",
      amount: 900,
      currency: "INR",
      valueDate: NOW,
    });
    const output = synthesizeGraph(entities, [], [], [txn1, txn2], "inv1", NOW);
    const financial = output.relationships.filter((r) => r.relationshipType === "financial");
    expect(financial.some((r) => r.sourceEntityId === accA.id && r.targetEntityId === accB.id)).toBe(true);
    expect(financial.some((r) => r.sourceEntityId === accB.id && r.targetEntityId === accC.id)).toBe(true);
    expect(financial.some((r) => r.sourceEntityId === accA.id && r.targetEntityId === accC.id)).toBe(false);
    expect(output.financialTransactions).toHaveLength(2);
  });

  it("derives a person↔person financial edge only via the ownership chain, classified ai_inference", () => {
    const personA = personEntity(makeContentId("entity", ["person", "pa"]), "Person A");
    const personB = personEntity(makeContentId("entity", ["person", "pb"]), "Person B");
    const accA = identifierEntity(makeContentId("entity", ["bank_account", "AC-X"]), "bank_account", "AC-X");
    const accB = identifierEntity(makeContentId("entity", ["bank_account", "AC-Y"]), "bank_account", "AC-Y");
    const entities = [personA, personB, accA, accB];

    const personAMention = record("er_pa", "item_pa", "entity_mention", { mentionKind: "person", observedValue: "Person A" });
    const hasAccountA = record("er_haa", "item_pa", "relationship_mention", {
      relationshipType: "has_account",
      subject: "Person A",
      observedValue: "AC-X",
    });
    const personBMention = record("er_pb", "item_pb", "entity_mention", { mentionKind: "person", observedValue: "Person B" });
    const hasAccountB = record("er_hab", "item_pb", "relationship_mention", {
      relationshipType: "has_account",
      subject: "Person B",
      observedValue: "AC-Y",
    });
    const txn = record("er_txn", "item_txn", "event_mention", {
      eventKind: "financial_transaction",
      fromAccount: "AC-X",
      toAccount: "AC-Y",
      amount: 500,
      currency: "INR",
      valueDate: NOW,
    });

    const decisions = [decision(personA.id, "er_pa"), decision(personB.id, "er_pb")];
    const records = [personAMention, hasAccountA, personBMention, hasAccountB, txn];

    const output = synthesizeGraph(entities, [], decisions, records, "inv1", NOW);
    const derived = output.relationships.find(
      (r) => r.relationshipType === "financial" && r.sourceEntityId === personA.id && r.targetEntityId === personB.id,
    );
    expect(derived).toBeDefined();
    expect(derived!.classification).toBe("ai_inference");
    const direct = output.relationships.find((r) => r.sourceEntityId === accA.id && r.targetEntityId === accB.id);
    expect(direct).toBeDefined();
    expect(direct!.classification).toBe("observed_fact");
  });
});

describe("synthesizeGraph — communication and co-location", () => {
  it("builds a phone↔phone communication edge and phone↔location co_location edges from a CDR event", () => {
    const phoneA = identifierEntity(makeContentId("entity", ["phone", "+91-111"]), "phone", "+91-111");
    const phoneB = identifierEntity(makeContentId("entity", ["phone", "+91-222"]), "phone", "+91-222");
    const towerLabel = "SYN-CT-07";
    const towerId = makeContentId("location", [towerLabel]);
    const entities = [phoneA, phoneB];
    const locationMention = record("er_loc1", "item_loc1", "entity_mention", {
      mentionKind: "location",
      observedValue: towerLabel,
      locationType: "cell_tower",
      latitude: 28.5,
      longitude: 77.2,
    });
    const cdr = record("er_cdr1", "item_cdr1", "event_mention", {
      eventKind: "communication",
      callerNumber: "+91-111",
      calleeNumber: "+91-222",
      startedAt: NOW,
      durationSeconds: 120,
      cellTower: towerLabel,
    });

    const output = synthesizeGraph(entities, [], [], [locationMention, cdr], "inv1", NOW);

    expect(output.locations).toHaveLength(1);
    expect(output.locations[0]!.id).toBe(towerId);

    const comm = output.relationships.find((r) => r.relationshipType === "communication");
    expect(comm).toBeDefined();
    expect(comm!.sourceEntityId).toBe(phoneA.id);
    expect(comm!.targetEntityId).toBe(phoneB.id);

    const coLocations = output.relationships.filter((r) => r.relationshipType === "co_location");
    expect(coLocations.some((r) => r.sourceEntityId === phoneA.id && r.targetEntityId === towerId)).toBe(true);
    expect(coLocations.some((r) => r.sourceEntityId === phoneB.id && r.targetEntityId === towerId)).toBe(true);

    expect(output.communicationEvents).toHaveLength(1);
    expect(output.communicationEvents[0]!.callerEntityId).toBe(phoneA.id);
    expect(output.communicationEvents[0]!.cellLocationId).toBe(towerId);
  });
});

describe("synthesizeGraph — unsupported and missing-endpoint handling", () => {
  it("skips an unsupported relationship_mention type without throwing", () => {
    const r = record("er_x1", "item_x1", "relationship_mention", {
      relationshipType: "not_a_real_type",
      subject: "a",
      observedValue: "b",
    });
    const output = synthesizeGraph([], [], [], [r], "inv1", NOW);
    expect(output.relationships).toEqual([]);
    expect(output.warnings.some((w) => w.includes("Unsupported relationship_mention type"))).toBe(true);
  });

  it("skips a relationship_mention whose identifier endpoint was never canonicalized", () => {
    const r = record("er_x2", "item_x2", "relationship_mention", {
      relationshipType: "phone_bound_to_imei",
      subject: "+91-999",
      observedValue: "IMEI-999",
    });
    const output = synthesizeGraph([], [], [], [r], "inv1", NOW);
    expect(output.relationships).toEqual([]);
    expect(output.warnings.some((w) => w.includes("never canonicalized"))).toBe(true);
  });

  it("skips has_phone when no sibling person entity_mention exists in the same evidence item", () => {
    const phoneEntity = identifierEntity(makeContentId("entity", ["phone", "+91-333"]), "phone", "+91-333");
    const hasPhone = record("er_x3", "item_x3", "relationship_mention", {
      relationshipType: "has_phone",
      subject: "Nobody",
      observedValue: "+91-333",
    });
    const output = synthesizeGraph([phoneEntity], [], [], [hasPhone], "inv1", NOW);
    expect(output.relationships).toEqual([]);
    expect(output.warnings.some((w) => w.includes("no sibling person entity_mention"))).toBe(true);
  });

  it("never creates a has_alias/alias_of graph edge (resolution's job)", () => {
    const r1 = record("er_a1", "item_a1", "relationship_mention", { relationshipType: "has_alias", subject: "X", observedValue: "Y" });
    const r2 = record("er_a2", "item_a2", "relationship_mention", { relationshipType: "alias_of", subject: "X", observedValue: "Y" });
    const output = synthesizeGraph([], [], [], [r1, r2], "inv1", NOW);
    expect(output.relationships).toEqual([]);
    expect(output.warnings).toEqual([]);
  });
});
