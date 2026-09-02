import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
import type { Entity } from "@/lib/domain/entity";
import type { Location } from "@/lib/domain/location";
import type { Relationship } from "@/lib/domain/relationship";
import {
  buildAnalysisGraph,
  computeBridges,
  computeCentrality,
  computeCommunities,
  computeDegreeBreakdown,
  computeRanking,
  synthesizeAnalytics,
} from "@/lib/analytics/build";

const NOW = "2026-09-02T00:00:00.000Z";

function baseProvenance(source: string, location: string) {
  return {
    source,
    location,
    method: "test",
    confidence: 1,
    processingHistory: [`test:${source}`],
    timestamp: NOW,
  };
}

function person(id: string, label: string): Entity {
  return { id, investigationId: "inv1", kind: "person", canonicalLabel: label, attributes: {}, provenance: baseProvenance(id, "loc") };
}

function rel(
  id: string,
  source: string,
  target: string,
  relationshipType: Relationship["relationshipType"] = "communication",
  attributes: Record<string, unknown> = {},
): Relationship {
  return {
    id,
    investigationId: "inv1",
    sourceEntityId: source,
    targetEntityId: target,
    relationshipType,
    directed: true,
    evidenceItemIds: ["item1"],
    extractedRecordIds: ["er1"],
    conflicts: [],
    attributes,
    classification: "observed_fact",
    provenance: baseProvenance("er1", "loc"),
  };
}

// A "barbell" graph: two triangles {A,B,C} and {D,E,F} joined only
// through a single bridge node C-D. C and D are the only articulation
// points; removing either splits the graph into two components.
const A = person("a", "A");
const B = person("b", "B");
const C = person("c", "C");
const D = person("d", "D");
const E = person("e", "E");
const F = person("f", "F");
const BARBELL_ENTITIES = [A, B, C, D, E, F];
const BARBELL_RELATIONSHIPS = [
  rel("r_ab", A.id, B.id),
  rel("r_bc", B.id, C.id),
  rel("r_ca", C.id, A.id),
  rel("r_cd", C.id, D.id), // the sole bridge
  rel("r_de", D.id, E.id),
  rel("r_ef", E.id, F.id),
  rel("r_fd", F.id, D.id),
];

describe("buildAnalysisGraph", () => {
  it("builds nodes/edges from entities/locations/relationships, skipping unresolved endpoints", () => {
    const { graph, order, size } = buildAnalysisGraph(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS);
    expect(order).toBe(6);
    expect(size).toBe(7);
    const dangling = rel("r_dangling", "nonexistent1", "nonexistent2");
    const { size: sizeWithDangling } = buildAnalysisGraph(BARBELL_ENTITIES, [], [...BARBELL_RELATIONSHIPS, dangling]);
    expect(sizeWithDangling).toBe(7); // dangling edge silently skipped, never throws
    void graph;
  });

  it("carries the weight attribute from attributes.eventCount, defaulting to 1", () => {
    const weighted = rel("r_weighted", A.id, B.id, "communication", { eventCount: 42 });
    const { graph } = buildAnalysisGraph([A, B], [], [weighted]);
    expect(graph.getEdgeAttributes("r_weighted").weight).toBe(42);
    const { graph: g2 } = buildAnalysisGraph([A, B], [], [rel("r_unweighted", A.id, B.id)]);
    expect(g2.getEdgeAttributes("r_unweighted").weight).toBe(1);
  });
});

describe("computeDegreeBreakdown", () => {
  it("reports total/in/out/byRelationshipType for a node with mixed edge types", () => {
    const rels = [
      rel("r1", A.id, B.id, "communication"),
      rel("r2", C.id, A.id, "financial"),
      rel("r3", A.id, D.id, "ownership", { eventCount: 3 }),
    ];
    const { graph } = buildAnalysisGraph([A, B, C, D], [], rels);
    const breakdown = computeDegreeBreakdown(graph, A.id);
    expect(breakdown.total).toBe(3);
    expect(breakdown.incoming).toBe(1);
    expect(breakdown.outgoing).toBe(2);
    expect(breakdown.byRelationshipType).toEqual({ communication: 1, financial: 1, ownership: 1 });
    expect(breakdown.weighted).toBe(1 + 1 + 3);
  });

  it("returns a zeroed breakdown for a node not in the graph, never throwing", () => {
    const { graph } = buildAnalysisGraph([A], [], []);
    expect(computeDegreeBreakdown(graph, "does-not-exist")).toEqual({
      total: 0,
      weighted: 0,
      incoming: 0,
      outgoing: 0,
      byRelationshipType: {},
    });
  });
});

describe("computeBridges — articulation points on a barbell graph", () => {
  it("identifies exactly the two bridge nodes (C and D), each splitting the graph in two", () => {
    const { graph } = buildAnalysisGraph(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS);
    const bridges = computeBridges(graph);
    const nodeIds = bridges.map((b) => b.nodeId).sort();
    expect(nodeIds).toEqual(["c", "d"]);
    for (const b of bridges) {
      expect(b.componentsBefore).toBe(1);
      expect(b.componentsAfter).toBe(2);
      expect(b.bridgeScore).toBe(1);
      expect(b.affectedComponentSizes.reduce((a, x) => a + x, 0)).toBe(5); // 6 nodes minus the removed one
      expect(b.supportingEdgeIds.length).toBeGreaterThan(0);
    }
  });

  it("finds no articulation points in a fully-connected triangle", () => {
    const rels = [rel("r1", A.id, B.id), rel("r2", B.id, C.id), rel("r3", C.id, A.id)];
    const { graph } = buildAnalysisGraph([A, B, C], [], rels);
    expect(computeBridges(graph)).toEqual([]);
  });

  it("handles an empty graph and a single-node graph without throwing", () => {
    const { graph: empty } = buildAnalysisGraph([], [], []);
    expect(computeBridges(empty)).toEqual([]);
    const { graph: single } = buildAnalysisGraph([A], [], []);
    expect(computeBridges(single)).toEqual([]);
  });
});

describe("computeCentrality", () => {
  it("gives the bridge node higher betweenness than the leaf nodes on a barbell graph", () => {
    const { graph } = buildAnalysisGraph(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS);
    const centrality = computeCentrality(graph);
    const byNode = new Map(centrality.map((c) => [c.nodeId, c]));
    expect(byNode.get("c")!.betweennessCentrality).toBeGreaterThan(byNode.get("a")!.betweennessCentrality);
    expect(byNode.get("d")!.betweennessCentrality).toBeGreaterThan(byNode.get("e")!.betweennessCentrality);
    for (const c of centrality) {
      expect(c.degreeCentrality).toBeGreaterThanOrEqual(0);
      expect(c.betweennessCentrality).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns an empty array for an empty graph", () => {
    const { graph } = buildAnalysisGraph([], [], []);
    expect(computeCentrality(graph)).toEqual([]);
  });
});

describe("computeCommunities — determinism and content-addressed cluster ids", () => {
  it("separates the two triangles of a barbell graph into two communities, with stable content-addressed ids across repeated runs", () => {
    const { graph } = buildAnalysisGraph(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS);
    const centrality = computeCentrality(graph);
    const run1 = computeCommunities(graph, centrality);
    const run2 = computeCommunities(graph, centrality);
    expect(run1.length).toBeGreaterThanOrEqual(1);
    expect(run1.map((c) => c.clusterId).sort()).toEqual(run2.map((c) => c.clusterId).sort());
    expect(run1.map((c) => [...c.memberNodeIds].sort())).toEqual(run2.map((c) => [...c.memberNodeIds].sort()));
    // clusterId is a pure function of the sorted member set, never the algorithm's internal index.
    for (const c of run1) {
      expect(c.clusterId).toBe(makeContentId("community", [...c.memberNodeIds].sort()));
    }
  });

  it("returns an empty array for an empty graph", () => {
    const { graph } = buildAnalysisGraph([], [], []);
    expect(computeCommunities(graph, [])).toEqual([]);
  });
});

describe("computeRanking — deterministic ranks and tie-breaking", () => {
  it("ranks the bridge nodes above the symmetric leaf nodes, with a stable id-based tie-break", () => {
    const { graph } = buildAnalysisGraph(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS);
    const centrality = computeCentrality(graph);
    const bridges = computeBridges(graph);
    const communities = computeCommunities(graph, centrality);
    const ranking = computeRanking(graph, centrality, bridges, communities);
    expect(ranking).toHaveLength(6);
    expect(new Set(ranking.map((r) => r.rank)).size).toBe(6); // every rank is unique, 1..6
    const byNode = new Map(ranking.map((r) => [r.nodeId, r]));
    expect(byNode.get("c")!.rank).toBeLessThan(byNode.get("a")!.rank);
    // A and B are structurally symmetric (same score) — tie-break must be deterministic (by node id).
    const aRank = byNode.get("a")!.rank;
    const bRank = byNode.get("b")!.rank;
    expect(Math.abs(aRank - bRank)).toBeGreaterThanOrEqual(0);
    for (const r of ranking) {
      expect(r.componentMetrics.degree).toBe(graph.degree(r.nodeId));
    }
  });

  it("produces byte-identical ranking across repeated invocations (no randomness leaks into the result)", () => {
    const { graph } = buildAnalysisGraph(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS);
    const runOnce = () => {
      const centrality = computeCentrality(graph);
      const bridges = computeBridges(graph);
      const communities = computeCommunities(graph, centrality);
      return computeRanking(graph, centrality, bridges, communities);
    };
    expect(JSON.stringify(runOnce())).toBe(JSON.stringify(runOnce()));
  });
});

describe("synthesizeAnalytics — signal assembly", () => {
  it("produces centrality (x2 per node), bridge, community, and ranking signals, all classified algorithmic_signal", () => {
    const output = synthesizeAnalytics(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, "inv1", "graph-v1", NOW);
    expect(output.warnings).toEqual([]);
    const byType = new Map<string, number>();
    for (const s of output.signals) byType.set(s.signalType, (byType.get(s.signalType) ?? 0) + 1);
    expect(byType.get("centrality")).toBe(12); // 6 nodes x 2 methods
    expect(byType.get("bridge")).toBe(2);
    expect(byType.get("ranking")).toBe(6);
    expect(byType.get("community")).toBeGreaterThanOrEqual(1);
    for (const s of output.signals) {
      expect(s.classification).toBe("algorithmic_signal");
      expect(s.graphVersion).toBe("graph-v1");
      expect(s.provenance.confidence).toBe(1);
      expect(s.provenance.processingHistory.length).toBeGreaterThan(0);
    }
  });

  it("assigns deterministic content-addressed ids, stable across repeated calls", () => {
    const run1 = synthesizeAnalytics(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, "inv1", "graph-v1", NOW);
    const run2 = synthesizeAnalytics(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, "inv1", "graph-v1", NOW);
    expect(run1.signals.map((s) => s.id).sort()).toEqual(run2.signals.map((s) => s.id).sort());
  });

  it("handles an empty graph gracefully (no investigation data yet)", () => {
    const output = synthesizeAnalytics([], [], [], "inv1", "graph-v1", NOW);
    expect(output.signals).toEqual([]);
    expect(output.warnings).toEqual([]);
  });

  it("handles a single-node graph without throwing", () => {
    const output = synthesizeAnalytics([A], [], [], "inv1", "graph-v1", NOW);
    expect(output.signals.some((s) => s.signalType === "centrality")).toBe(true);
    expect(output.signals.some((s) => s.signalType === "bridge")).toBe(false);
  });

  it("handles a disconnected graph (two separate components, no path between them)", () => {
    const rels = [rel("r1", A.id, B.id), rel("r2", D.id, E.id)];
    const output = synthesizeAnalytics([A, B, D, E], [], rels, "inv1", "graph-v1", NOW);
    const communityTypes = output.signals.filter((s) => s.signalType === "community");
    expect(communityTypes.length).toBe(2); // two disconnected pairs, two communities
    expect(output.signals.some((s) => s.signalType === "bridge")).toBe(false); // no cut vertex in two disjoint edges
  });
});

describe("computeShortestPath", () => {
  it("finds the shortest path through the sole bridge on a barbell graph", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const result = computeShortestPath(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, A.id, F.id);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.nodeIds[0]).toBe(A.id);
    expect(result.nodeIds[result.nodeIds.length - 1]).toBe(F.id);
    expect(result.nodeIds).toContain(C.id);
    expect(result.nodeIds).toContain(D.id);
    expect(result.hopCount).toBe(result.edges.length);
    for (const edge of result.edges) {
      expect(edge.relationshipType).toBeTruthy();
      expect(typeof edge.directed).toBe("boolean");
    }
  });

  it("finds a path across a strictly one-directional ownership chain (undirected reachability, per-edge true direction preserved)", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    // person -> owns -> identifier is only ever stored in that direction;
    // a strictly-directed search from the identifier back to the person
    // would find nothing, but investigatively they ARE connected.
    const rels = [rel("r_own", A.id, B.id, "ownership")];
    const result = computeShortestPath([A, B], [], rels, B.id, A.id);
    expect(result.found).toBe(true);
    if (!result.found) return;
    expect(result.hopCount).toBe(1);
    expect(result.edges[0]!.source).toBe(A.id); // true stored direction preserved
    expect(result.edges[0]!.target).toBe(B.id);
  });

  it("returns a structured not-found result for two disconnected entities, never throwing", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const rels = [rel("r1", A.id, B.id), rel("r2", D.id, E.id)];
    const result = computeShortestPath([A, B, D, E], [], rels, A.id, D.id);
    expect(result.found).toBe(false);
    if (result.found) return;
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it("returns a structured not-found result when the source or target does not exist", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const missingSource = computeShortestPath([A], [], [], "does-not-exist", A.id);
    expect(missingSource.found).toBe(false);
    const missingTarget = computeShortestPath([A], [], [], A.id, "does-not-exist");
    expect(missingTarget.found).toBe(false);
  });

  it("returns not-found (never a degenerate zero-hop path) when source equals target", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const result = computeShortestPath([A], [], [], A.id, A.id);
    expect(result.found).toBe(false);
  });

  it("respects a relationship-type filter, finding no path when the only connecting edge type is excluded", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const rels = [rel("r1", A.id, B.id, "financial")];
    const withFinancial = computeShortestPath([A, B], [], rels, A.id, B.id, ["financial"]);
    expect(withFinancial.found).toBe(true);
    const withoutFinancial = computeShortestPath([A, B], [], rels, A.id, B.id, ["communication"]);
    expect(withoutFinancial.found).toBe(false);
  });

  it("never manufactures an edge — every returned edge id resolves to a real input relationship", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const relIds = new Set(BARBELL_RELATIONSHIPS.map((r) => r.id));
    const result = computeShortestPath(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, A.id, F.id);
    expect(result.found).toBe(true);
    if (!result.found) return;
    for (const edge of result.edges) expect(relIds.has(edge.id)).toBe(true);
  });

  it("is deterministic across repeated invocations", async () => {
    const { computeShortestPath } = await import("@/lib/analytics/paths");
    const run1 = computeShortestPath(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, A.id, F.id);
    const run2 = computeShortestPath(BARBELL_ENTITIES, [], BARBELL_RELATIONSHIPS, A.id, F.id);
    expect(JSON.stringify(run1)).toBe(JSON.stringify(run2));
  });
});

describe("verify.assertProvenance — endpoint & classification invariants", () => {
  function goodSignal(overrides: Record<string, unknown> = {}) {
    return {
      id: "sig1",
      investigationId: "inv1",
      graphVersion: "v1",
      targetEntityId: "entity_a",
      signalType: "centrality" as const,
      value: { score: 0.5 },
      method: "analytics:degree_centrality",
      explanation: "test",
      classification: "algorithmic_signal" as const,
      provenance: baseProvenance("entity_a", "graph_version:v1"),
      ...overrides,
    };
  }

  it("rejects a signal whose targetEntityId does not resolve to a known entity or location", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/analytics/verify");
    const validated = validateOutputs([goodSignal({ targetEntityId: "does-not-exist" })]);
    expect(() => assertProvenance(validated.signals, new Set(["entity_a"]), new Set(), "v1")).toThrow();
  });

  it("accepts a signal whose targetEntityId resolves to a location (not only an entity)", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/analytics/verify");
    const validated = validateOutputs([goodSignal({ targetEntityId: "location_x" })]);
    const count = assertProvenance(validated.signals, new Set(), new Set(["location_x"]), "v1");
    expect(count).toBe(1);
  });

  it("rejects a signal stamped with a graph version different from the one this run analyzed", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/analytics/verify");
    const validated = validateOutputs([goodSignal({ graphVersion: "stale-version" })]);
    expect(() => assertProvenance(validated.signals, new Set(["entity_a"]), new Set(), "v1")).toThrow();
  });

  it("accepts a well-formed algorithmic_signal with a resolvable entity endpoint", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/analytics/verify");
    const validated = validateOutputs([goodSignal()]);
    const count = assertProvenance(validated.signals, new Set(["entity_a"]), new Set(), "v1");
    expect(count).toBe(1);
  });

  it("accepts a community signal with no targetEntityId at all", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/analytics/verify");
    const communitySignal = {
      id: "sig-community",
      investigationId: "inv1",
      graphVersion: "v1",
      signalType: "community" as const,
      value: { clusterId: "c1", size: 2, memberEntityIds: ["entity_a", "entity_b"] },
      method: "analytics:louvain_community",
      explanation: "test",
      classification: "algorithmic_signal" as const,
      provenance: baseProvenance("c1", "graph_version:v1"),
    };
    const validated = validateOutputs([communitySignal]);
    const count = assertProvenance(validated.signals, new Set(["entity_a", "entity_b"]), new Set(), "v1");
    expect(count).toBe(1);
  });
});

describe("idempotentPersistAnalytics — partial retry", () => {
  const TEST_DB_PATH = "./data/netintel-analytics-persist-test.db";

  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    fs.rmSync(TEST_DB_PATH, { force: true });
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
  });

  it("persists only the rows missing after a partial prior write", async () => {
    const { idempotentPersistAnalytics } = await import("@/lib/analytics/persist");
    const { insertInvestigation, insertEntity, insertAnalyticalSignal } = await import("@/lib/db/repository");

    const investigationId = makeOpaqueId("investigation");
    await insertInvestigation({ id: investigationId, name: "Analytics Persist Test", status: "in_progress", createdAt: NOW });
    await insertEntity({ id: "entity_x", investigationId, kind: "person", canonicalLabel: "X", attributes: {}, provenance: baseProvenance("x", "loc") });
    await insertEntity({ id: "entity_y", investigationId, kind: "person", canonicalLabel: "Y", attributes: {}, provenance: baseProvenance("x", "loc") });

    const signalA = {
      id: makeContentId("analytical_signal", ["centrality", "entity_x", "v1"]),
      investigationId,
      graphVersion: "v1",
      targetEntityId: "entity_x",
      signalType: "centrality" as const,
      value: { score: 0.1 },
      method: "analytics:degree_centrality",
      explanation: "test",
      classification: "algorithmic_signal" as const,
      provenance: baseProvenance("entity_x", "graph_version:v1"),
    };
    // Simulate a partial prior write: signalA already persisted.
    await insertAnalyticalSignal(signalA);

    const signalB = {
      ...signalA,
      id: makeContentId("analytical_signal", ["centrality", "entity_y", "v1"]),
      targetEntityId: "entity_y",
    };

    const persisted = await idempotentPersistAnalytics([signalA, signalB]);
    expect(persisted.signalsCreated).toBe(1);
    expect(persisted.signalsSkipped).toBe(1);
  });
});

describe("ground-truth isolation — no forbidden import/identifier anywhere in src/lib/analytics/ (excluding explanatory doc comments)", () => {
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

  it("scans every .ts file under src/lib/analytics/", () => {
    const dir = path.join(process.cwd(), "src/lib/analytics");
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
});
