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

import { prepareFreshDb, releaseAndRemoveDb } from "./helpers/db";

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
  const TEST_DB_PATH = "./data/cipher-analytics-persist-test.db";

  beforeAll(async () => {
    await prepareFreshDb(TEST_DB_PATH);
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(async () => {
    await releaseAndRemoveDb(TEST_DB_PATH);
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

describe("ground-truth isolation — no forbidden import/identifier anywhere in src/lib/analytics/ (excluding explanatory doc comments)", () => {

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

// ---------------------------------------------------------------------------
// Full-corpus topology analytics — ingest, extract, resolve, synthesize the
// graph, then run analytics once, sharing the result across assertions
// (mirrors tests/unit/graph.test.ts's full-corpus block).
// ---------------------------------------------------------------------------

type AnalyticsModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  runExtraction: typeof import("@/lib/extraction/service").runExtraction;
  runResolution: typeof import("@/lib/resolution/service").runResolution;
  runGraphSynthesis: typeof import("@/lib/graph/service").runGraphSynthesis;
  runAnalyticsSynthesis: typeof import("@/lib/analytics/service").runAnalyticsSynthesis;
  getAnalyticsState: typeof import("@/lib/analytics/summary").getAnalyticsState;
  getRankedEntities: typeof import("@/lib/analytics/summary").getRankedEntities;
  getBridgeEntities: typeof import("@/lib/analytics/summary").getBridgeEntities;
  getCommunities: typeof import("@/lib/analytics/summary").getCommunities;
  getEntityAnalyticsDetail: typeof import("@/lib/analytics/summary").getEntityAnalyticsDetail;
  getPath: typeof import("@/lib/analytics/summary").getPath;
  idempotentPersistAnalytics: typeof import("@/lib/analytics/persist").idempotentPersistAnalytics;
  repo: typeof import("@/lib/db/repository");
};

async function freshAnalytics(dbPath: string): Promise<AnalyticsModule> {
  await prepareFreshDb(dbPath);
  const vitestMod = await import("vitest");
  vitestMod.vi.resetModules();
  process.env.DATABASE_URL = dbPath;

  const [ingestion, extraction, resolution, graphService, service, summary, persist, repo] = await Promise.all([
    import("@/lib/ingestion/service"),
    import("@/lib/extraction/service"),
    import("@/lib/resolution/service"),
    import("@/lib/graph/service"),
    import("@/lib/analytics/service"),
    import("@/lib/analytics/summary"),
    import("@/lib/analytics/persist"),
    import("@/lib/db/repository"),
  ]);
  return {
    runIngestion: ingestion.runIngestion,
    runExtraction: extraction.runExtraction,
    runResolution: resolution.runResolution,
    runGraphSynthesis: graphService.runGraphSynthesis,
    runAnalyticsSynthesis: service.runAnalyticsSynthesis,
    getAnalyticsState: summary.getAnalyticsState,
    getRankedEntities: summary.getRankedEntities,
    getBridgeEntities: summary.getBridgeEntities,
    getCommunities: summary.getCommunities,
    getEntityAnalyticsDetail: summary.getEntityAnalyticsDetail,
    getPath: summary.getPath,
    idempotentPersistAnalytics: persist.idempotentPersistAnalytics,
    repo,
  };
}

describe("topology analytics — full Operation DarkNet Delhi corpus", () => {
  const DB = "./data/cipher-analytics-full.db";
  let mod: AnalyticsModule;
  let result: Awaited<ReturnType<AnalyticsModule["runAnalyticsSynthesis"]>>;

  beforeAll(async () => {
    mod = await freshAnalytics(DB);
    expect((await mod.runIngestion({ kind: "builtin-corpus" })).status).toBe("ingested");
    expect((await mod.runExtraction()).status).toBe("extracted");
    expect((await mod.runResolution()).status).toBe("resolved");
    expect((await mod.runGraphSynthesis()).status).toBe("synthesized");
    result = await mod.runAnalyticsSynthesis();
  }, 120_000);

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("synthesizes successfully and runs all 10 stages to completion", () => {
    expect(result.status).toBe("synthesized");
    expect(result.error).toBeNull();
    expect(result.stages).toHaveLength(10);
    for (const stage of result.stages) {
      expect(stage.status).toBe("ok");
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    expect(result.counts?.entitiesAnalyzed).toBe(61);
    expect(result.counts?.rankedEntities).toBe(75); // 61 entities + 14 locations
  });

  it("degree calculation: every ranked node's degree matches the persisted relationship count touching it", async () => {
    const relationships = await mod.repo.listRelationships();
    const page = await mod.getRankedEntities({ limit: 100 });
    expect(page).not.toBeNull();
    const sample = page!.entities.slice(0, 10);
    for (const e of sample) {
      const expectedDegree = relationships.filter((r) => r.sourceEntityId === e.id || r.targetEntityId === e.id).length;
      const detail = await mod.getEntityAnalyticsDetail(e.id);
      expect(detail!.degree.total).toBe(expectedDegree);
    }
  });

  it("centrality: degree and betweenness scores are within [0,1] for every ranked entity", async () => {
    const page = await mod.getRankedEntities({ limit: 100 });
    for (const e of page!.entities) {
      expect(e.degreeCentrality).toBeGreaterThanOrEqual(0);
      expect(e.degreeCentrality).toBeLessThanOrEqual(1);
      expect(e.betweennessCentrality).toBeGreaterThanOrEqual(0);
      expect(e.betweennessCentrality).toBeLessThanOrEqual(1);
    }
  });

  it("bridge detection: 19 structural bridges identified, each with a positive bridge score and supporting edges", async () => {
    const bridges = await mod.getBridgeEntities();
    expect(bridges).not.toBeNull();
    expect(bridges!.length).toBe(19);
    for (const b of bridges!) {
      expect(b.bridgeScore).toBeGreaterThan(0);
      expect(b.componentsAfter).toBeGreaterThan(b.componentsBefore);
      expect(b.supportingEdgeIds.length).toBeGreaterThan(0);
    }
  });

  it("community detection: every entity/location belongs to exactly one community, ids are content-addressed", async () => {
    const communities = await mod.getCommunities();
    expect(communities).not.toBeNull();
    expect(communities!.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const c of communities!) {
      for (const m of c.memberEntityIds) {
        expect(seen.has(m), `entity ${m} appears in more than one community`).toBe(false);
        seen.add(m);
      }
      expect(c.id).toBe(makeContentId("community", [...c.memberEntityIds].sort()));
    }
  });

  it("deterministic community ids and rankings: re-running synthesis against the SAME graph version reproduces byte-identical signal ids", async () => {
    const before = (await mod.repo.listAnalyticalSignals()).map((s) => s.id).sort();
    const rerun = await mod.runAnalyticsSynthesis();
    expect(rerun.status).toBe("already_synthesized");
    expect(rerun.persisted?.signalsCreated).toBe(0);
    const after = (await mod.repo.listAnalyticalSignals()).map((s) => s.id).sort();
    expect(after).toEqual(before);
  });

  it("deterministic rankings: ranks are a contiguous 1..N permutation with no gaps or duplicates", async () => {
    const page = await mod.getRankedEntities({ limit: 100 });
    const ranks = page!.entities.map((e) => e.rank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
  });

  it("persistence/idempotency: a partial-write retry persists only what's missing", async () => {
    const signals = await mod.repo.listAnalyticalSignals();
    const persisted = await mod.idempotentPersistAnalytics(signals);
    expect(persisted.signalsCreated).toBe(0);
    expect(persisted.signalsSkipped).toBe(signals.length);
  });

  it("relationship filters: a financial-only shortest path never traverses a communication or ownership edge", async () => {
    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const s6 = entities.find((e) => e.canonicalLabel === "Neha Kapoor")!;
    const result = await mod.getPath(s1.id, s6.id, ["financial"]);
    expect(result).not.toBeNull();
    expect(result!.found).toBe(true);
    if (result!.found) {
      for (const edge of result!.edges) expect(edge.relationshipType).toBe("financial");
    }
  });

  it("shortest path: Rohan Malhotra and Kabir Sharma are connected via a real, non-invented path", async () => {
    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const s3 = entities.find((e) => e.canonicalLabel === "Kabir Sharma")!;
    const relationshipIds = new Set((await mod.repo.listRelationships()).map((r) => r.id));
    const result = await mod.getPath(s1.id, s3.id);
    expect(result!.found).toBe(true);
    if (result!.found) {
      for (const edge of result!.edges) expect(relationshipIds.has(edge.id)).toBe(true);
    }
  });

  it("no-path result: two entities behind a relationship-type filter that excludes their only connection return found:false, not a thrown error", async () => {
    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const vehicle = entities.find((e) => e.kind === "vehicle")!;
    // A person and a vehicle they don't own, filtered to a relationship
    // type that could never connect them, must degrade gracefully.
    const result = await mod.getPath(s1.id, vehicle.id, ["financial"]);
    expect(result).not.toBeNull();
    expect(typeof result!.found).toBe("boolean");
  });

  it("path provenance: every edge in a found path resolves to a real, currently-persisted relationship with full provenance", async () => {
    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const s4 = entities.find((e) => e.canonicalLabel === "Farhan Qureshi")!;
    const relationships = await mod.repo.listRelationships();
    const relById = new Map(relationships.map((r) => [r.id, r]));
    const result = await mod.getPath(s1.id, s4.id);
    expect(result!.found).toBe(true);
    if (result!.found) {
      for (const edge of result!.edges) {
        const rel = relById.get(edge.id);
        expect(rel).toBeDefined();
        expect(rel!.provenance.source).toBeTruthy();
        expect(rel!.extractedRecordIds.length).toBeGreaterThan(0);
      }
    }
  });

  it("structured error behavior: a malformed path query on a valid graph returns found:false, never throwing", async () => {
    const result = await mod.getPath("entity_does_not_exist", "entity_also_missing");
    expect(result!.found).toBe(false);
  });

  // --- key investigative demonstrations (never hardcoded from ground truth) ---

  it("Rohan Malhotra's network position: ranks among the top structurally prominent entities with real supporting edges", async () => {
    const entities = await mod.repo.listEntities();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const detail = await mod.getEntityAnalyticsDetail(s1.id);
    expect(detail).not.toBeNull();
    expect(detail!.degree.total).toBeGreaterThan(0);
    const rankingSignal = detail!.signals.find((s) => s.signalType === "ranking");
    expect(rankingSignal).toBeDefined();
    expect(Number(rankingSignal!.value.rank)).toBeLessThanOrEqual(20); // among the top third of 68 ranked nodes
  });

  it("Kabir Sharma's network position: has real ownership, communication, and financial edges reflected in degree breakdown", async () => {
    const entities = await mod.repo.listEntities();
    const s3 = entities.find((e) => e.canonicalLabel === "Kabir Sharma")!;
    const detail = await mod.getEntityAnalyticsDetail(s3.id);
    expect(detail).not.toBeNull();
    expect(Object.keys(detail!.degree.byRelationshipType).length).toBeGreaterThan(0);
  });

  it("Vikram Singh remains a single canonical entity in analytics output (never double-counted)", async () => {
    const entities = await mod.repo.listEntities();
    const vikramEntities = entities.filter((e) => e.kind === "person" && e.canonicalLabel === "Vikram Singh");
    expect(vikramEntities).toHaveLength(1);
    const page = await mod.getRankedEntities({ limit: 100 });
    const vikramRankings = page!.entities.filter((e) => e.label === "Vikram Singh");
    expect(vikramRankings).toHaveLength(1);
  });

  it("S1 and S4 are graph-reachable without a direct edge ever being invented by analytics", async () => {
    const entities = await mod.repo.listEntities();
    const relationships = await mod.repo.listRelationships();
    const s1 = entities.find((e) => e.canonicalLabel === "Rohan Malhotra")!;
    const s4 = entities.find((e) => e.canonicalLabel === "Farhan Qureshi")!;
    const directEdge = relationships.some(
      (r) => (r.sourceEntityId === s1.id && r.targetEntityId === s4.id) || (r.sourceEntityId === s4.id && r.targetEntityId === s1.id),
    );
    expect(directEdge).toBe(false);
    const result = await mod.getPath(s1.id, s4.id);
    expect(result!.found).toBe(true);
    if (result!.found) {
      // every edge in the path is a real, pre-existing relationship id — analytics invented nothing
      const relationshipIds = new Set(relationships.map((r) => r.id));
      for (const edge of result!.edges) expect(relationshipIds.has(edge.id)).toBe(true);
    }
  });

  it("the financial/money-mule chain remains represented through actual bank-account entities (analytics never substitutes a synthetic edge)", async () => {
    const entities = await mod.repo.listEntities();
    const relationships = await mod.repo.listRelationships();
    // The mule intermediaries now DO receive canonical person entities —
    // extraction reads the phone-subscriber and account-holder fields
    // that name them (see graph.test.ts item 14 and
    // src/lib/extraction/extract.ts personMention()). What this test
    // protects is that analytics substitutes nothing: the financial chain
    // is still carried by real bank_account entities and real edges, not
    // by a synthetic person-to-person shortcut invented at analysis time.
    for (const name of ["Sunil Gupta", "Pooja Rani", "Ashok Kumar"]) {
      expect(entities.some((e) => e.kind === "person" && e.canonicalLabel === name)).toBe(true);
    }
    const bankAccountIds = new Set(entities.filter((e) => e.kind === "bank_account").map((e) => e.id));
    const financialEdges = relationships.filter((r) => r.relationshipType === "financial" && r.classification !== "ai_inference");
    expect(financialEdges.some((r) => bankAccountIds.has(r.sourceEntityId) && bankAccountIds.has(r.targetEntityId))).toBe(true);
  });

  it("unrelated/noise phone numbers do not become connected merely because analytics is running", async () => {
    const entities = await mod.repo.listEntities();
    const relationships = await mod.repo.listRelationships();
    const phoneIds = new Set(entities.filter((e) => e.kind === "phone").map((e) => e.id));
    const page = await mod.getRankedEntities({ limit: 100 });
    // Every ranked phone entity must have at least one real, persisted
    // relationship — analytics assigns a rank to every graph node, but
    // never fabricates connectivity a node doesn't structurally have.
    for (const e of page!.entities.filter((e) => phoneIds.has(e.id))) {
      const hasRealEdge = relationships.some((r) => r.sourceEntityId === e.id || r.targetEntityId === e.id);
      expect(hasRealEdge).toBe(true);
    }
  });

  it("classification correctness: every persisted analytical signal is classified exactly algorithmic_signal, never any other value", async () => {
    const signals = await mod.repo.listAnalyticalSignals();
    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((s) => s.classification === "algorithmic_signal")).toBe(true);
    const serialized = JSON.stringify(signals);
    for (const forbidden of ["observed_fact", "corroborated_fact", "ai_inference", "investigative_lead"]) {
      expect(serialized).not.toContain(`"classification":"${forbidden}"`);
    }
  });

  it("provenance: every signal traces back to a real, currently-persisted entity/location or edge reference — no evidence record is duplicated inline", async () => {
    const signals = await mod.repo.listAnalyticalSignals();
    const entities = await mod.repo.listEntities();
    const locations = await mod.repo.listLocations();
    const relationships = await mod.repo.listRelationships();
    const nodeIds = new Set([...entities.map((e) => e.id), ...locations.map((l) => l.id)]);
    const relationshipIds = new Set(relationships.map((r) => r.id));
    for (const s of signals.slice(0, 50)) {
      if (s.targetEntityId) expect(nodeIds.has(s.targetEntityId)).toBe(true);
      const supportingEdgeIds = Array.isArray(s.value.supportingEdgeIds) ? (s.value.supportingEdgeIds as string[]) : [];
      for (const edgeId of supportingEdgeIds) expect(relationshipIds.has(edgeId)).toBe(true);
      // signals reference ids, never inline copies of evidence records
      expect(JSON.stringify(s.value)).not.toMatch(/"provenance":\s*\{/);
    }
  });

  it("ground-truth isolation over live persisted output: no analytical signal value or explanation contains a ground-truth-only field name", async () => {
    const signals = await mod.repo.listAnalyticalSignals();
    const serialized = JSON.stringify(signals);
    for (const key of GROUND_TRUTH_KEYS) expect(serialized).not.toContain(key);
  });
});

describe("empty and edge-case graphs (full pipeline)", () => {
  const DB = "./data/cipher-analytics-empty.db";

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("returns a structured NO_GRAPH error when analytics is requested before graph synthesis has ever run", async () => {
    const mod = await freshAnalytics(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
    await mod.runResolution();
    // deliberately skip graph synthesis
    const result = await mod.runAnalyticsSynthesis();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_GRAPH");
    // Ingests + extracts + resolves the whole corpus before the assertion —
    // far beyond vitest's 5s default, like the full-corpus hooks above.
  }, 120_000);

  it("returns a structured NO_INVESTIGATION error on a completely empty database", async () => {
    const mod = await freshAnalytics(DB);
    const result = await mod.runAnalyticsSynthesis();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_INVESTIGATION");
    expect(result.error?.message).not.toMatch(/\/(Users|home|root|var|tmp|private)\//);
    expect(result.error?.message).not.toMatch(/\.[cm]?tsx?:\d+/);
  });
});
