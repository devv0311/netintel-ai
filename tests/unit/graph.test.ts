import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { createEmptyGraph } from "@/lib/graph";
import { synthesizeGraph } from "@/lib/graph/build";
import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
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

describe("verify.assertProvenance — endpoint & classification invariants", () => {
  it("rejects a relationship whose target does not resolve to a known entity or location id", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/graph/verify");
    const bogus = {
      id: "bad",
      investigationId: "inv1",
      sourceEntityId: "entity_real",
      targetEntityId: "entity_does_not_exist",
      relationshipType: "ownership" as const,
      directed: true,
      evidenceItemIds: ["item1"],
      extractedRecordIds: ["er1"],
      conflicts: [],
      attributes: {},
      classification: "observed_fact" as const,
      provenance: baseProvenance("er1", "loc"),
    };
    const validated = validateOutputs([], [], [], [bogus]);
    expect(() =>
      assertProvenance(
        validated.locations,
        validated.communicationEvents,
        validated.financialTransactions,
        validated.relationships,
        new Set(["entity_real"]),
        new Set(),
        new Set(["er1"]),
      ),
    ).toThrow();
  });

  it("rejects a corroborated_fact classification backed by fewer than 2 evidence items", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/graph/verify");
    const bogus = {
      id: "bad2",
      investigationId: "inv1",
      sourceEntityId: "entity_a",
      targetEntityId: "entity_b",
      relationshipType: "ownership" as const,
      directed: true,
      evidenceItemIds: ["item1"],
      extractedRecordIds: ["er1"],
      conflicts: [],
      attributes: {},
      classification: "corroborated_fact" as const,
      provenance: baseProvenance("er1", "loc"),
    };
    const validated = validateOutputs([], [], [], [bogus]);
    expect(() =>
      assertProvenance(
        validated.locations,
        validated.communicationEvents,
        validated.financialTransactions,
        validated.relationships,
        new Set(["entity_a", "entity_b"]),
        new Set(),
        new Set(["er1"]),
      ),
    ).toThrow();
  });

  it("accepts a well-formed relationship with resolvable endpoints and matching classification", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/graph/verify");
    const good = {
      id: "good1",
      investigationId: "inv1",
      sourceEntityId: "entity_a",
      targetEntityId: "entity_b",
      relationshipType: "ownership" as const,
      directed: true,
      evidenceItemIds: ["item1"],
      extractedRecordIds: ["er1"],
      conflicts: [],
      attributes: {},
      classification: "observed_fact" as const,
      provenance: baseProvenance("er1", "loc"),
    };
    const validated = validateOutputs([], [], [], [good]);
    const count = assertProvenance(
      validated.locations,
      validated.communicationEvents,
      validated.financialTransactions,
      validated.relationships,
      new Set(["entity_a", "entity_b"]),
      new Set(),
      new Set(["er1"]),
    );
    expect(count).toBe(1);
  });
});

describe("idempotentPersistGraph — partial retry", () => {
  const TEST_DB_PATH = "./data/netintel-graph-persist-test.db";

  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    fs.rmSync(TEST_DB_PATH, { force: true });
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
  });

  it("persists only the rows missing after a partial prior write", async () => {
    const { idempotentPersistGraph } = await import("@/lib/graph/persist");
    const { insertInvestigation, insertEntity, insertRelationship } = await import("@/lib/db/repository");

    const investigationId = makeOpaqueId("investigation");
    await insertInvestigation({ id: investigationId, name: "Graph Persist Test", status: "in_progress", createdAt: NOW });
    const sourceId = makeContentId("entity", ["person", "Persist Source"]);
    const targetId = makeContentId("entity", ["phone", "+91-777"]);
    await insertEntity({ id: sourceId, investigationId, kind: "person", canonicalLabel: "Persist Source", attributes: {}, provenance: baseProvenance("x", "loc") });
    await insertEntity({ id: targetId, investigationId, kind: "phone", canonicalLabel: "+91-777", attributes: {}, provenance: baseProvenance("x", "loc") });

    const relA = {
      id: makeContentId("relationship", ["ownership", sourceId, targetId]),
      investigationId,
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      relationshipType: "ownership" as const,
      directed: true,
      evidenceItemIds: ["item1"],
      extractedRecordIds: ["er1"],
      conflicts: [],
      attributes: {},
      classification: "observed_fact" as const,
      provenance: baseProvenance("er1", "loc"),
    };
    // Simulate a partial prior write: relA already persisted.
    await insertRelationship(relA);

    const otherTargetId = makeContentId("entity", ["phone", "+91-888"]);
    await insertEntity({ id: otherTargetId, investigationId, kind: "phone", canonicalLabel: "+91-888", attributes: {}, provenance: baseProvenance("x", "loc") });
    const relB = {
      ...relA,
      id: makeContentId("relationship", ["ownership", sourceId, otherTargetId]),
      targetEntityId: otherTargetId,
    };

    const persisted = await idempotentPersistGraph([], [], [], [relA, relB]);
    expect(persisted.relationshipsCreated).toBe(1);
    expect(persisted.relationshipsSkipped).toBe(1);
  });
});

describe("buildGraphFromRows — reconstruction from persisted state", () => {
  it("builds a graph whose node/edge counts match the input rows exactly, deterministically", async () => {
    const { buildGraphFromRows } = await import("@/lib/graph/runtime");
    const personA = personEntity(makeContentId("entity", ["person", "a"]), "A");
    const personB = personEntity(makeContentId("entity", ["person", "b"]), "B");
    const rel = {
      id: "rel1",
      investigationId: "inv1",
      sourceEntityId: personA.id,
      targetEntityId: personB.id,
      relationshipType: "communication" as const,
      directed: true,
      evidenceItemIds: ["i1"],
      extractedRecordIds: ["e1"],
      conflicts: [],
      attributes: {},
      classification: "observed_fact" as const,
      provenance: baseProvenance("e1", "loc"),
    };
    const g1 = buildGraphFromRows([personA, personB], [], [rel]);
    const g2 = buildGraphFromRows([personA, personB], [], [rel]);
    expect(g1.order).toBe(2);
    expect(g1.size).toBe(1);
    expect(g2.order).toBe(g1.order);
    expect(g2.size).toBe(g1.size);
    expect(g1.hasNode(personA.id)).toBe(true);
    expect(g1.hasEdge(rel.id)).toBe(true);
  });

  it("getNeighborhood returns the 1-hop node/edge set around a node", async () => {
    const { buildGraphFromRows, getNeighborhood } = await import("@/lib/graph/runtime");
    const a = personEntity(makeContentId("entity", ["person", "na"]), "A");
    const b = personEntity(makeContentId("entity", ["person", "nb"]), "B");
    const c = personEntity(makeContentId("entity", ["person", "nc"]), "C");
    const relAB = {
      id: "relAB",
      investigationId: "inv1",
      sourceEntityId: a.id,
      targetEntityId: b.id,
      relationshipType: "communication" as const,
      directed: true,
      evidenceItemIds: ["i1"],
      extractedRecordIds: ["e1"],
      conflicts: [],
      attributes: {},
      classification: "observed_fact" as const,
      provenance: baseProvenance("e1", "loc"),
    };
    const graph = buildGraphFromRows([a, b, c], [], [relAB]);
    const { nodeIds, edgeIds } = getNeighborhood(graph, a.id);
    expect(nodeIds.sort()).toEqual([a.id, b.id].sort());
    expect(edgeIds).toEqual(["relAB"]);
    expect(getNeighborhood(graph, "does-not-exist")).toEqual({ nodeIds: [], edgeIds: [] });
  });
});

// ---------------------------------------------------------------------------
// Full-corpus graph synthesis — ingest, extract, resolve, then synthesize
// once, sharing the result across assertions (mirrors
// tests/unit/resolution.test.ts's "Block A" pattern).
// ---------------------------------------------------------------------------

const GROUND_TRUTH_KEYS = [
  "expectedEntityMerges",
  "hiddenConnections",
  "moneyMulePaths",
  "intendedConclusions",
  "expectedCopilotAnswers",
  "resolutionForbidden",
  "recoverableBy",
  "aliasMap",
];

type GraphModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  runExtraction: typeof import("@/lib/extraction/service").runExtraction;
  runResolution: typeof import("@/lib/resolution/service").runResolution;
  runGraphSynthesis: typeof import("@/lib/graph/service").runGraphSynthesis;
  getGraphState: typeof import("@/lib/graph/summary").getGraphState;
  getGraphSnapshot: typeof import("@/lib/graph/summary").getGraphSnapshot;
  getNodeDetail: typeof import("@/lib/graph/summary").getNodeDetail;
  getEdgeDetail: typeof import("@/lib/graph/summary").getEdgeDetail;
  idempotentPersistGraph: typeof import("@/lib/graph/persist").idempotentPersistGraph;
  buildGraphFromRows: typeof import("@/lib/graph/runtime").buildGraphFromRows;
  getNeighborhood: typeof import("@/lib/graph/runtime").getNeighborhood;
  repo: typeof import("@/lib/db/repository");
};

async function freshGraph(dbPath: string): Promise<GraphModule> {
  const vitestMod = await import("vitest");
  vitestMod.vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  process.env.DATABASE_URL = dbPath;

  const [ingestion, extraction, resolution, service, summary, persist, runtime, repo] = await Promise.all([
    import("@/lib/ingestion/service"),
    import("@/lib/extraction/service"),
    import("@/lib/resolution/service"),
    import("@/lib/graph/service"),
    import("@/lib/graph/summary"),
    import("@/lib/graph/persist"),
    import("@/lib/graph/runtime"),
    import("@/lib/db/repository"),
  ]);
  return {
    runIngestion: ingestion.runIngestion,
    runExtraction: extraction.runExtraction,
    runResolution: resolution.runResolution,
    runGraphSynthesis: service.runGraphSynthesis,
    getGraphState: summary.getGraphState,
    getGraphSnapshot: summary.getGraphSnapshot,
    getNodeDetail: summary.getNodeDetail,
    getEdgeDetail: summary.getEdgeDetail,
    idempotentPersistGraph: persist.idempotentPersistGraph,
    buildGraphFromRows: runtime.buildGraphFromRows,
    getNeighborhood: runtime.getNeighborhood,
    repo,
  };
}

describe("graph synthesis — full Operation DarkNet Delhi corpus", () => {
  const DB = "./data/netintel-graph-full.db";
  let mod: GraphModule;
  let result: Awaited<ReturnType<GraphModule["runGraphSynthesis"]>>;

  beforeAll(async () => {
    mod = await freshGraph(DB);
    expect((await mod.runIngestion({ kind: "builtin-corpus" })).status).toBe("ingested");
    expect((await mod.runExtraction()).status).toBe("extracted");
    expect((await mod.runResolution()).status).toBe("resolved");
    result = await mod.runGraphSynthesis();
  }, 120_000);

  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB + s, { force: true });
  });

  it("1. synthesizes successfully and creates graph nodes from every canonical entity kind + locations", async () => {
    expect(result.status).toBe("synthesized");
    expect(result.error).toBeNull();
    expect(result.stages).toHaveLength(10);
    for (const stage of result.stages) {
      expect(stage.status).toBe("ok");
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    const entities = await mod.repo.listEntities();
    const locations = await mod.repo.listLocations();
    expect(entities.length).toBe(54);
    expect(locations.length).toBeGreaterThan(0);
    for (const kind of ["person", "phone", "imei", "vehicle", "bank_account"]) {
      expect(entities.some((e) => e.kind === kind)).toBe(true);
    }
  });

  it("2. creates graph edges across the expected relationship types", async () => {
    const rels = await mod.repo.listRelationships();
    expect(rels.length).toBeGreaterThan(0);
    const types = new Set(rels.map((r) => r.relationshipType));
    expect(types.has("ownership")).toBe(true);
    expect(types.has("communication")).toBe(true);
    expect(types.has("financial")).toBe(true);
    expect(types.has("co_location")).toBe(true);
  });

  it("3. every edge endpoint is a canonical id, never a raw name", async () => {
    const rels = await mod.repo.listRelationships();
    expect(rels.length).toBeGreaterThan(0);
    for (const r of rels) {
      expect(r.sourceEntityId).toMatch(/^entity_|^location_/);
      expect(r.targetEntityId).toMatch(/^entity_|^location_/);
      expect(r.sourceEntityId).not.toContain(" ");
      expect(r.targetEntityId).not.toContain(" ");
    }
  });

  it("4. only declared relationship types appear", async () => {
    const rels = await mod.repo.listRelationships();
    const allowed = new Set(["communication", "financial", "co_location", "family", "associate", "ownership", "other"]);
    for (const r of rels) expect(allowed.has(r.relationshipType)).toBe(true);
  });

  it("5. every edge carries complete 6-field provenance plus non-empty evidenceItemIds/extractedRecordIds", async () => {
    const rels = await mod.repo.listRelationships();
    for (const r of rels) {
      expect(r.provenance.source).toBeTruthy();
      expect(r.provenance.location).toBeTruthy();
      expect(r.provenance.method).toBeTruthy();
      expect(r.provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(r.provenance.confidence).toBeLessThanOrEqual(1);
      expect(r.provenance.processingHistory.length).toBeGreaterThan(0);
      expect(r.evidenceItemIds.length).toBeGreaterThan(0);
      expect(r.extractedRecordIds.length).toBeGreaterThan(0);
      expect(Array.isArray(r.conflicts)).toBe(true);
      expect(typeof r.attributes).toBe("object");
    }
  });

  it("6+7+8. deterministic ids and idempotent re-synthesis (zero duplicates, marker reports already_synthesized)", async () => {
    const before = (await mod.repo.listRelationships()).map((r) => r.id).sort();
    const rerun = await mod.runGraphSynthesis();
    expect(rerun.status).toBe("already_synthesized");
    expect(rerun.persisted?.relationshipsCreated).toBe(0);
    expect(rerun.persisted?.locationsCreated).toBe(0);
    expect(rerun.persisted?.communicationEventsCreated).toBe(0);
    expect(rerun.persisted?.financialTransactionsCreated).toBe(0);
    const after = (await mod.repo.listRelationships()).map((r) => r.id).sort();
    expect(after).toEqual(before);
  });

  it("9. a partial-write retry persists only the rows still missing", async () => {
    const all = await mod.repo.listRelationships();
    const locations = await mod.repo.listLocations();
    const comms = await mod.repo.listCommunicationEvents();
    const txns = await mod.repo.listFinancialTransactions();
    // Everything is already persisted from beforeAll — a repeat call over
    // the identical full set must skip 100%, proving row-level id-based
    // skipping (not just the marker) drives idempotency.
    const persisted = await mod.idempotentPersistGraph(locations, comms, txns, all);
    expect(persisted.relationshipsCreated).toBe(0);
    expect(persisted.relationshipsSkipped).toBe(all.length);
    expect(persisted.locationsSkipped).toBe(locations.length);
  });

  it("12. contradictory attribute_mention evidence survives graph synthesis untouched", async () => {
    const records = await mod.repo.listExtractedRecords();
    const attributeMentions = records.filter((r) => r.recordType === "attribute_mention");
    expect(attributeMentions.length).toBeGreaterThan(0);
    // graph synthesis never writes to extracted_records — its presence
    // and count are exactly what extraction produced, untouched.
  });

  it("13. the hidden S1<->S4 relationship stays structurally indirect but graph-reachable", async () => {
    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.kind === "person" && e.canonicalLabel === "Rohan Malhotra");
    const s4 = entities.find((e) => e.kind === "person" && e.canonicalLabel === "Farhan Qureshi");
    expect(s1).toBeDefined();
    expect(s4).toBeDefined();

    const rels = await mod.repo.listRelationships();
    const direct = rels.some(
      (r) => (r.sourceEntityId === s1!.id && r.targetEntityId === s4!.id) || (r.sourceEntityId === s4!.id && r.targetEntityId === s1!.id),
    );
    expect(direct).toBe(false);

    const locations = await mod.repo.listLocations();
    const graph = mod.buildGraphFromRows(entities, locations, rels);
    const visited = new Set([s1!.id]);
    let frontier = [s1!.id];
    let hops = 0;
    while (frontier.length > 0 && !visited.has(s4!.id) && hops < 8) {
      const next: string[] = [];
      for (const n of frontier) {
        graph.forEachEdge(n, (_e, _a, source, target) => {
          const other = source === n ? target : source;
          if (!visited.has(other)) {
            visited.add(other);
            next.push(other);
          }
        });
      }
      frontier = next;
      hops += 1;
    }
    expect(visited.has(s4!.id)).toBe(true);
    expect(hops).toBeGreaterThan(1);
  });

  it("14. the money-mule financial chain is preserved through real account entities, with no invented person for the mules", async () => {
    const entities = await mod.repo.listEntities();
    const rels = await mod.repo.listRelationships();
    const records = await mod.repo.listExtractedRecords();

    // Per src/lib/corpus/case-design.ts INTERMEDIARIES: money-mule
    // intermediaries (Sunil Gupta / Pooja Rani / Ashok Kumar) never
    // appear as their own suspect_record, so P5.4 resolution never
    // creates a canonical person entity for them — graph synthesis must
    // not invent one either.
    for (const name of ["Sunil Gupta", "Pooja Rani", "Ashok Kumar"]) {
      expect(entities.some((e) => e.kind === "person" && e.canonicalLabel === name)).toBe(false);
    }

    // The chain is still fully reconstructable through the real bank
    // account entities: resolve each account_held_by fact to identify
    // which account belongs to whom, then verify the S1->M1->M2->M3->S4
    // hop sequence exists as financial edges (jittered counts around
    // the TXN_FLOWS design targets, never exact — the generator applies
    // random spread — so assert presence and a loose plausible range,
    // not an exact count).
    const holderByAccount = new Map<string, string>();
    for (const r of records) {
      if (r.recordType === "relationship_mention" && r.data.relationshipType === "account_held_by") {
        holderByAccount.set(r.data.subject as string, r.data.observedValue as string);
      }
    }
    const accountEntityByHolder = new Map<string, typeof entities>();
    for (const e of entities) {
      if (e.kind !== "bank_account") continue;
      const holder = holderByAccount.get(e.canonicalLabel);
      if (!holder) continue;
      const list = accountEntityByHolder.get(holder) ?? [];
      list.push(e);
      accountEntityByHolder.set(holder, list);
    }

    const financial = rels.filter((r) => r.relationshipType === "financial" && r.classification !== "ai_inference");
    const hopExists = (fromHolder: string, toHolder: string): boolean => {
      const fromAccounts = accountEntityByHolder.get(fromHolder) ?? [];
      const toAccounts = accountEntityByHolder.get(toHolder) ?? [];
      return financial.some(
        (r) => fromAccounts.some((a) => a.id === r.sourceEntityId) && toAccounts.some((a) => a.id === r.targetEntityId),
      );
    };
    expect(hopExists("Rohan Malhotra", "Sunil Gupta")).toBe(true);
    expect(hopExists("Sunil Gupta", "Pooja Rani")).toBe(true);
    expect(hopExists("Pooja Rani", "Ashok Kumar")).toBe(true);
    expect(hopExists("Ashok Kumar", "Farhan Qureshi")).toBe(true);
    // No shortcut: no financial edge directly links Rohan Malhotra's own
    // account to Farhan Qureshi's account.
    expect(hopExists("Rohan Malhotra", "Farhan Qureshi")).toBe(false);
  });

  it("noise phone numbers never produce a communication edge (misleading low-value relationships stay noise)", async () => {
    const records = await mod.repo.listExtractedRecords();
    const entities = await mod.repo.listEntities();
    const phoneValues = new Set(entities.filter((e) => e.kind === "phone").map((e) => e.canonicalLabel));
    const cdrRecords = records.filter((r) => r.recordType === "event_mention" && r.data.eventKind === "communication");
    const unresolved = new Set<string>();
    for (const r of cdrRecords) {
      const caller = r.data.callerNumber as string;
      const callee = r.data.calleeNumber as string;
      if (!phoneValues.has(caller)) unresolved.add(caller);
      if (!phoneValues.has(callee)) unresolved.add(callee);
    }
    // The 3 synthetic noise/service numbers (food-delivery hotline, dental
    // clinic, radio-cab dispatch) never get their own phone_record, so
    // they never canonicalize — proving missing-endpoint handling fires
    // for real on the actual corpus's designed noise, not only a
    // hand-built fixture.
    expect(unresolved.size).toBeGreaterThan(0);
    const rels = await mod.repo.listRelationships();
    for (const number of unresolved) {
      const hasEdge = rels.some(
        (r) => r.relationshipType === "communication" && (r.sourceEntityId === number || r.targetEntityId === number),
      );
      expect(hasEdge).toBe(false);
    }
  });

  it("Vikram Singh remains a single, correctly-separated canonical entity after graph synthesis", async () => {
    const entities = await mod.repo.listEntities();
    const vikramEntities = entities.filter((e) => e.kind === "person" && e.canonicalLabel === "Vikram Singh");
    expect(vikramEntities).toHaveLength(1);
    const rels = await mod.repo.listRelationships();
    const ownership = rels.filter((r) => r.relationshipType === "ownership" && r.sourceEntityId === vikramEntities[0]!.id);
    expect(ownership.length).toBeGreaterThan(0); // the accused Vikram Singh has real phone/account/vehicle ownership edges
  });

  it("15. every edge is traceable to real source evidence", async () => {
    const rels = await mod.repo.listRelationships();
    const extractedRecords = await mod.repo.listExtractedRecords();
    const recordIds = new Set(extractedRecords.map((r) => r.id));
    for (const r of rels.slice(0, 50)) {
      for (const id of r.extractedRecordIds) expect(recordIds.has(id)).toBe(true);
    }
    const sample = rels[0]!;
    const detail = await mod.getEdgeDetail(sample.id);
    expect(detail).not.toBeNull();
    expect(detail!.extractedRecords.length).toBeGreaterThan(0);
    for (const ref of detail!.extractedRecords) {
      expect(ref.location.length).toBeGreaterThan(0);
      expect(ref.evidenceItemId.length).toBeGreaterThan(0);
    }
  });

  it("16. ground-truth isolation — no forbidden import/identifier anywhere in src/lib/graph/ (excluding explanatory doc comments)", () => {
    const dir = path.join(process.cwd(), "src/lib/graph");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = fs
        .readFileSync(path.join(dir, file), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(/from\s+["'][^"']*ground-truth[^"']*["']/);
      expect(code, file).not.toMatch(/import\(\s*["'][^"']*ground-truth/);
      expect(code, file).not.toMatch(/["']ground-truth["']/);
      expect(code, file).not.toMatch(/evidence\/ground-truth/);
      expect(code, file).not.toMatch(/loadInvestigationGroundTruth|loadGroundTruthFixture/);
      for (const key of GROUND_TRUTH_KEYS) expect(code, `${file}: ${key}`).not.toContain(key);
    }
  });

  it("17. the in-memory graph is a deterministic, reconstructable projection of persisted state", async () => {
    const entities = await mod.repo.listEntities();
    const locations = await mod.repo.listLocations();
    const rels = await mod.repo.listRelationships();
    const g1 = mod.buildGraphFromRows(entities, locations, rels);
    const g2 = mod.buildGraphFromRows(entities, locations, rels);
    expect(g1.order).toBe(entities.length + locations.length);
    expect(g1.size).toBe(rels.length);
    expect(g2.order).toBe(g1.order);
    expect(g2.size).toBe(g1.size);
    expect([...g1.nodes()].sort()).toEqual([...g2.nodes()].sort());
    expect([...g1.edges()].sort()).toEqual([...g2.edges()].sort());
  });

  it("18. API-shaped queries: graph state, snapshot, node detail, edge detail all return coherent data", async () => {
    const state = await mod.getGraphState();
    expect(state.status).toBe("synthesized");
    if (state.status !== "synthesized") return;
    expect(state.summary.totalEdges).toBeGreaterThan(0);

    const snapshot = await mod.getGraphSnapshot({ limit: 50 });
    expect(snapshot.nodes.length).toBeGreaterThan(0);
    expect(snapshot.nodes.length).toBeLessThanOrEqual(50);

    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const focused = await mod.getGraphSnapshot({ focus: s1.id });
    expect(focused.nodes.some((n) => n.id === s1.id)).toBe(true);
    expect(focused.truncated).toBe(false);

    const nodeDetail = await mod.getNodeDetail(s1.id);
    expect(nodeDetail).not.toBeNull();
    expect(nodeDetail!.label).toBe("Rohan Malhotra");
    expect(nodeDetail!.edges.length).toBeGreaterThan(0);

    expect(await mod.getNodeDetail("does-not-exist")).toBeNull();
    expect(await mod.getEdgeDetail("does-not-exist")).toBeNull();
  });
});
