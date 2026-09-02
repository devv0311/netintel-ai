import Graph from "graphology";
import { degreeCentrality } from "graphology-metrics/centrality/degree";
import betweennessCentrality from "graphology-metrics/centrality/betweenness";
import louvain from "graphology-communities-louvain";

import { createEmptyGraph } from "@/lib/graph";
import type { Entity } from "@/lib/domain/entity";
import type { AnalyticalSignalType } from "@/lib/domain/derived";
import { makeContentId } from "@/lib/domain/ids";
import type { Location } from "@/lib/domain/location";
import type { EvidenceClassification, Provenance } from "@/lib/domain/provenance";
import type { Relationship } from "@/lib/domain/relationship";

/**
 * Topology analytics core: deterministic structural computation over
 * the P5.5 graph. Every function here is pure — given the same
 * entities/locations/relationships, it produces byte-identical output,
 * every time. No randomness reaches an observable result (Louvain's
 * internal RNG is seeded with a fixed constant, never `Math.random`).
 *
 * This module builds its OWN graphology instance from the persisted
 * rows (via `buildAnalysisGraph`) rather than reusing
 * `src/lib/graph/runtime.ts`'s `buildGraphFromRows` — that function's
 * edge attributes deliberately omit `attributes.eventCount` (P5.5's
 * graph engine has no analytics need for it), and per this milestone's
 * constraint ("do not replace or rewrite the P5.5 graph engine"),
 * extending it is out of scope; duplicating a ~15-line, purely additive
 * graph-construction step here is far lower risk than modifying the
 * shared module every other consumer depends on. Both graphs are built
 * from the exact same source rows and the same `createEmptyGraph()`
 * factory, so they are structurally identical projections.
 *
 * Every analytical signal is classified exactly "algorithmic_signal"
 * (docs/requirements.md §7) — a topology calculation describes the
 * graph; it is never itself a claim about the world, and this module
 * never invents a relationship or asserts guilt/importance beyond the
 * structural fact being reported.
 */

// --- deterministic RNG (Louvain defaults to Math.random — must be pinned) ---

/** Tiny, self-contained, deterministic PRNG (mulberry32). Fixed seed only. */
function makeDeterministicRng(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const ANALYTICS_RNG_SEED = 0x4e6574; // "Net" — fixed, arbitrary, never varies run to run

/** Rounds a metric to a fixed precision so float summation-order noise never leaks into presented/persisted values. */
function round(n: number, digits = 6): number {
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

// --- graph construction (local, additive — see module doc) ---------------

export interface AnalysisGraph {
  graph: Graph;
  order: number;
  size: number;
}

export function buildAnalysisGraph(entities: Entity[], locations: Location[], relationships: Relationship[]): AnalysisGraph {
  const graph = createEmptyGraph();
  const sortedEntities = [...entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedLocations = [...locations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedRelationships = [...relationships].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const e of sortedEntities) graph.addNode(e.id, { kind: e.kind, label: e.canonicalLabel });
  for (const l of sortedLocations) graph.addNode(l.id, { kind: "location", label: l.label });
  for (const r of sortedRelationships) {
    if (!graph.hasNode(r.sourceEntityId) || !graph.hasNode(r.targetEntityId)) continue;
    if (graph.hasEdge(r.id)) continue;
    const eventCount = typeof r.attributes.eventCount === "number" ? r.attributes.eventCount : 1;
    graph.addEdgeWithKey(r.id, r.sourceEntityId, r.targetEntityId, {
      relationshipType: r.relationshipType,
      directed: r.directed,
      classification: r.classification,
      confidence: r.provenance.confidence,
      weight: eventCount,
    });
  }
  return { graph, order: graph.order, size: graph.size };
}

// --- degree (computed live by summary.ts too — exported for reuse) --------

export interface DegreeBreakdown {
  total: number;
  weighted: number;
  incoming: number;
  outgoing: number;
  byRelationshipType: Record<string, number>;
}

export function computeDegreeBreakdown(graph: Graph, nodeId: string): DegreeBreakdown {
  if (!graph.hasNode(nodeId)) {
    return { total: 0, weighted: 0, incoming: 0, outgoing: 0, byRelationshipType: {} };
  }
  const byRelationshipType: Record<string, number> = {};
  let weighted = 0;
  graph.forEachEdge(nodeId, (_edge, attrs) => {
    const type = String(attrs.relationshipType);
    byRelationshipType[type] = (byRelationshipType[type] ?? 0) + 1;
    weighted += typeof attrs.weight === "number" ? attrs.weight : 1;
  });
  return {
    total: graph.degree(nodeId),
    weighted: round(weighted),
    incoming: graph.inDegree(nodeId),
    outgoing: graph.outDegree(nodeId),
    byRelationshipType,
  };
}

// --- undirected adjacency (connectivity is inherently undirected) --------

function undirectedAdjacency(graph: Graph): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const n of graph.nodes()) adj.set(n, new Set());
  for (const e of graph.edges()) {
    const [a, b] = graph.extremities(e);
    if (a === b) continue;
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  return adj;
}

function connectedComponents(adj: Map<string, Set<string>>, exclude?: string): string[][] {
  const nodes = [...adj.keys()].filter((n) => n !== exclude).sort();
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const comp: string[] = [];
    const queue = [start];
    visited.add(start);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      comp.push(cur);
      const neighbors = [...(adj.get(cur) ?? new Set())].filter((n) => n !== exclude).sort();
      for (const nb of neighbors) {
        if (!visited.has(nb)) {
          visited.add(nb);
          queue.push(nb);
        }
      }
    }
    components.push(comp.sort());
  }
  return components;
}

/** Deterministic (sorted-neighbor-order) Tarjan's articulation-point algorithm over an undirected adjacency map. */
function findArticulationPoints(adj: Map<string, Set<string>>): Set<string> {
  const disc = new Map<string, number>();
  const low = new Map<string, number>();
  const parent = new Map<string, string | null>();
  const artPoints = new Set<string>();
  let timer = 0;

  function dfs(u: string): void {
    disc.set(u, timer);
    low.set(u, timer);
    timer++;
    let children = 0;
    const neighbors = [...(adj.get(u) ?? new Set())].sort();
    for (const v of neighbors) {
      if (!disc.has(v)) {
        children++;
        parent.set(v, u);
        dfs(v);
        low.set(u, Math.min(low.get(u)!, low.get(v)!));
        const isRoot = parent.get(u) === null;
        if (!isRoot && low.get(v)! >= disc.get(u)!) artPoints.add(u);
        if (isRoot && children > 1) artPoints.add(u);
      } else if (v !== parent.get(u)) {
        low.set(u, Math.min(low.get(u)!, disc.get(v)!));
      }
    }
  }

  for (const n of [...adj.keys()].sort()) {
    if (!disc.has(n)) {
      parent.set(n, null);
      dfs(n);
    }
  }
  return artPoints;
}

export interface BridgeCandidate {
  nodeId: string;
  bridgeScore: number;
  componentsBefore: number;
  componentsAfter: number;
  affectedComponentSizes: number[];
  supportingEdgeIds: string[];
}

export function computeBridges(graph: Graph): BridgeCandidate[] {
  const adj = undirectedAdjacency(graph);
  const componentsBefore = connectedComponents(adj).length;
  const articulationPoints = [...findArticulationPoints(adj)].sort();

  return articulationPoints.map((nodeId) => {
    const after = connectedComponents(adj, nodeId);
    const supportingEdgeIds = [...graph.edges(nodeId)].sort();
    return {
      nodeId,
      bridgeScore: after.length - componentsBefore,
      componentsBefore,
      componentsAfter: after.length,
      affectedComponentSizes: after.map((c) => c.length).sort((a, b) => b - a),
      supportingEdgeIds,
    };
  });
}

// --- centrality ------------------------------------------------------

export interface CentralityCandidate {
  nodeId: string;
  degreeCentrality: number;
  betweennessCentrality: number;
}

export function computeCentrality(graph: Graph): CentralityCandidate[] {
  if (graph.order === 0) return [];
  const degreeScores = degreeCentrality(graph);
  const betweennessScores = betweennessCentrality(graph, { getEdgeWeight: null });
  return [...graph.nodes()].sort().map((nodeId) => ({
    nodeId,
    degreeCentrality: round(degreeScores[nodeId] ?? 0),
    betweennessCentrality: round(betweennessScores[nodeId] ?? 0),
  }));
}

// --- communities -------------------------------------------------------

export interface CommunityCandidate {
  clusterId: string;
  memberNodeIds: string[];
  dominantEntityTypes: Record<string, number>;
  dominantRelationshipTypes: Record<string, number>;
  representativeNodeIds: string[];
  internalEdgeIds: string[];
}

export function computeCommunities(graph: Graph, centrality: CentralityCandidate[]): CommunityCandidate[] {
  if (graph.order === 0) return [];
  const rng = makeDeterministicRng(ANALYTICS_RNG_SEED);
  const assignments = louvain(graph, { rng, getEdgeWeight: "weight" });

  const membersByRawCommunity = new Map<number, string[]>();
  for (const nodeId of [...graph.nodes()].sort()) {
    const community = assignments[nodeId] ?? 0;
    const list = membersByRawCommunity.get(community) ?? [];
    list.push(nodeId);
    membersByRawCommunity.set(community, list);
  }

  const betweennessByNode = new Map(centrality.map((c) => [c.nodeId, c.betweennessCentrality]));

  const candidates: CommunityCandidate[] = [];
  for (const rawMembers of membersByRawCommunity.values()) {
    const memberNodeIds = [...rawMembers].sort();
    // Content-addressed by the sorted member set — never the algorithm's
    // own raw integer index, which can shift between equivalent runs.
    const clusterId = makeContentId("community", memberNodeIds);

    const dominantEntityTypes: Record<string, number> = {};
    for (const nodeId of memberNodeIds) {
      const kind = String(graph.getNodeAttributes(nodeId).kind);
      dominantEntityTypes[kind] = (dominantEntityTypes[kind] ?? 0) + 1;
    }

    const memberSet = new Set(memberNodeIds);
    const internalEdgeIds: string[] = [];
    const dominantRelationshipTypes: Record<string, number> = {};
    for (const edge of graph.edges()) {
      const [a, b] = graph.extremities(edge);
      if (!memberSet.has(a) || !memberSet.has(b)) continue;
      internalEdgeIds.push(edge);
      const type = String(graph.getEdgeAttributes(edge).relationshipType);
      dominantRelationshipTypes[type] = (dominantRelationshipTypes[type] ?? 0) + 1;
    }
    internalEdgeIds.sort();

    const representativeNodeIds = [...memberNodeIds]
      .sort((a, b) => {
        const scoreDiff = (betweennessByNode.get(b) ?? 0) - (betweennessByNode.get(a) ?? 0);
        return scoreDiff !== 0 ? scoreDiff : a < b ? -1 : a > b ? 1 : 0;
      })
      .slice(0, 3);

    candidates.push({
      clusterId,
      memberNodeIds,
      dominantEntityTypes,
      dominantRelationshipTypes,
      representativeNodeIds,
      internalEdgeIds,
    });
  }

  return candidates.sort((a, b) => (a.clusterId < b.clusterId ? -1 : a.clusterId > b.clusterId ? 1 : 0));
}

// --- investigative ranking ---------------------------------------------

export interface RankingCandidate {
  nodeId: string;
  rank: number;
  score: number;
  componentMetrics: {
    degreeCentrality: number;
    betweennessCentrality: number;
    bridgeScore: number;
    degree: number;
    communitySize: number;
  };
}

const RANK_WEIGHTS = { betweenness: 0.35, degree: 0.35, bridge: 0.3 } as const;

export function computeRanking(
  graph: Graph,
  centrality: CentralityCandidate[],
  bridges: BridgeCandidate[],
  communities: CommunityCandidate[],
): RankingCandidate[] {
  const bridgeByNode = new Map(bridges.map((b) => [b.nodeId, b.bridgeScore]));
  const maxBridgeScore = Math.max(1, ...bridges.map((b) => b.bridgeScore));
  const communitySizeByNode = new Map<string, number>();
  for (const c of communities) for (const m of c.memberNodeIds) communitySizeByNode.set(m, c.memberNodeIds.length);

  const scored = centrality.map((c) => {
    const rawBridge = bridgeByNode.get(c.nodeId) ?? 0;
    const normalizedBridge = rawBridge / maxBridgeScore;
    const score = round(
      RANK_WEIGHTS.betweenness * c.betweennessCentrality +
        RANK_WEIGHTS.degree * c.degreeCentrality +
        RANK_WEIGHTS.bridge * normalizedBridge,
    );
    return {
      nodeId: c.nodeId,
      score,
      componentMetrics: {
        degreeCentrality: c.degreeCentrality,
        betweennessCentrality: c.betweennessCentrality,
        bridgeScore: rawBridge,
        degree: graph.degree(c.nodeId),
        communitySize: communitySizeByNode.get(c.nodeId) ?? 1,
      },
    };
  });

  scored.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.nodeId < b.nodeId ? -1 : 1));
  return scored.map((s, i) => ({ ...s, rank: i + 1 }));
}

// --- assembling AnalyticalSignal candidates ------------------------------

export interface AnalyticalSignalCandidate {
  id: string;
  investigationId: string;
  graphVersion: string;
  targetEntityId?: string;
  signalType: AnalyticalSignalType;
  value: Record<string, unknown>;
  method: string;
  explanation: string;
  classification: EvidenceClassification;
  provenance: Provenance;
}

function baseProvenance(source: string, method: string, graphVersion: string, analyzedAt: string): Provenance {
  return {
    source,
    location: `graph_version:${graphVersion}`,
    method,
    confidence: 1,
    processingHistory: [`graph:synthesized:${graphVersion}`, method],
    timestamp: analyzedAt,
  };
}

export interface AnalyticsBuildOutput {
  signals: AnalyticalSignalCandidate[];
  warnings: string[];
}

export function synthesizeAnalytics(
  entities: Entity[],
  locations: Location[],
  relationships: Relationship[],
  investigationId: string,
  graphVersion: string,
  analyzedAt: string,
): AnalyticsBuildOutput {
  const warnings: string[] = [];
  const { graph } = buildAnalysisGraph(entities, locations, relationships);

  const centrality = computeCentrality(graph);
  const bridges = computeBridges(graph);
  const communities = computeCommunities(graph, centrality);
  const ranking = computeRanking(graph, centrality, bridges, communities);

  const signals: AnalyticalSignalCandidate[] = [];

  for (const c of centrality) {
    const supportingEdgeIds = [...graph.edges(c.nodeId)].sort();
    signals.push({
      id: makeContentId("analytical_signal", ["centrality", "degree_centrality", c.nodeId, graphVersion]),
      investigationId,
      graphVersion,
      targetEntityId: c.nodeId,
      signalType: "centrality",
      value: { score: c.degreeCentrality, supportingEdgeIds },
      method: "analytics:degree_centrality",
      explanation: `Degree centrality (normalized) computed over ${graph.order} nodes / ${graph.size} edges.`,
      classification: "algorithmic_signal",
      provenance: baseProvenance(c.nodeId, "analytics:degree_centrality", graphVersion, analyzedAt),
    });
    signals.push({
      id: makeContentId("analytical_signal", ["centrality", "betweenness_centrality", c.nodeId, graphVersion]),
      investigationId,
      graphVersion,
      targetEntityId: c.nodeId,
      signalType: "centrality",
      value: { score: c.betweennessCentrality, supportingEdgeIds },
      method: "analytics:betweenness_centrality",
      explanation: `Betweenness centrality (normalized) computed over ${graph.order} nodes / ${graph.size} edges — how often this entity lies on shortest paths between other entities.`,
      classification: "algorithmic_signal",
      provenance: baseProvenance(c.nodeId, "analytics:betweenness_centrality", graphVersion, analyzedAt),
    });
  }

  for (const b of bridges) {
    signals.push({
      id: makeContentId("analytical_signal", ["bridge", b.nodeId, graphVersion]),
      investigationId,
      graphVersion,
      targetEntityId: b.nodeId,
      signalType: "bridge",
      value: {
        bridgeScore: b.bridgeScore,
        componentsBefore: b.componentsBefore,
        componentsAfter: b.componentsAfter,
        affectedComponentSizes: b.affectedComponentSizes,
        supportingEdgeIds: b.supportingEdgeIds,
      },
      method: "analytics:articulation_point",
      explanation: `Removing this entity would split the network from ${b.componentsBefore} into ${b.componentsAfter} connected component(s) — a structural bridge, not a claim of wrongdoing.`,
      classification: "algorithmic_signal",
      provenance: baseProvenance(b.nodeId, "analytics:articulation_point", graphVersion, analyzedAt),
    });
  }

  for (const c of communities) {
    signals.push({
      id: makeContentId("analytical_signal", ["community", c.clusterId, graphVersion]),
      investigationId,
      graphVersion,
      signalType: "community",
      value: {
        clusterId: c.clusterId,
        size: c.memberNodeIds.length,
        memberEntityIds: c.memberNodeIds,
        dominantEntityTypes: c.dominantEntityTypes,
        dominantRelationshipTypes: c.dominantRelationshipTypes,
        representativeEntityIds: c.representativeNodeIds,
        internalEdgeIds: c.internalEdgeIds,
      },
      method: "analytics:louvain_community",
      explanation: `A connected group of ${c.memberNodeIds.length} entities detected via modularity-based community detection (Louvain) — a structural grouping, not a claim of a criminal organization.`,
      classification: "algorithmic_signal",
      provenance: baseProvenance(c.clusterId, "analytics:louvain_community", graphVersion, analyzedAt),
    });
  }

  for (const r of ranking) {
    const supportingEdgeIds = [...graph.edges(r.nodeId)].sort();
    signals.push({
      id: makeContentId("analytical_signal", ["ranking", r.nodeId, graphVersion]),
      investigationId,
      graphVersion,
      targetEntityId: r.nodeId,
      signalType: "ranking",
      value: { rank: r.rank, score: r.score, componentMetrics: r.componentMetrics, supportingEdgeIds },
      method: "analytics:investigative_ranking",
      explanation: `Structural prominence rank ${r.rank} of ${ranking.length}, combining betweenness (${(RANK_WEIGHTS.betweenness * 100).toFixed(0)}%), degree centrality (${(RANK_WEIGHTS.degree * 100).toFixed(0)}%), and normalized bridge score (${(RANK_WEIGHTS.bridge * 100).toFixed(0)}%) — an algorithmic signal about network position, never a claim of involvement.`,
      classification: "algorithmic_signal",
      provenance: baseProvenance(r.nodeId, "analytics:investigative_ranking", graphVersion, analyzedAt),
    });
  }

  return { signals, warnings };
}
