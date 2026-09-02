import { listAnalyticalSignals, listEntities, listInvestigations, listLocations, listRelationships } from "@/lib/db/repository";
import type { RelationshipType } from "@/lib/domain/relationship";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

import { buildAnalysisGraph, computeDegreeBreakdown } from "./build";
import { analyticsMarkerKey, getAnalyticsMarker } from "./marker";
import { computeShortestPath } from "./paths";
import type {
  AnalyticsState,
  AnalyticsSummary,
  BridgeEntityView,
  CommunityView,
  EntityAnalyticsDetail,
  EntityMetricSignalView,
  PathResult,
  RankedEntitiesPage,
  RankedEntityView,
} from "./types";

/**
 * The server-derived analytics state/query surface the Analytics screen
 * and API routes render from, mirroring src/lib/graph/summary.ts. Reads
 * only domain tables (entities, locations, relationships,
 * analytical_signals) plus the graph and analytics markers — never
 * evidence/ground-truth/.
 */

const DEFAULT_ENTITIES_LIMIT = 25;
const MAX_ENTITIES_LIMIT = 100;

async function loadCurrentGraphVersion(investigationId: string): Promise<string | null> {
  const marker = await getGraphMarker(graphMarkerKey(investigationId));
  return marker?.synthesizedAt ?? null;
}

export async function getAnalyticsState(): Promise<AnalyticsState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return { status: "not_available" };

  const graphVersion = await loadCurrentGraphVersion(investigation.id);
  if (!graphVersion) return { status: "not_available" };

  const marker = await getAnalyticsMarker(analyticsMarkerKey(investigation.id, graphVersion));
  if (!marker) return { status: "pending" };

  const summary: AnalyticsSummary = {
    investigationId: investigation.id,
    graphVersion,
    analyzedAt: marker.analyzedAt,
    counts: marker.counts,
  };
  return { status: "synthesized", summary };
}

async function loadContext() {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return null;
  const graphVersion = await loadCurrentGraphVersion(investigation.id);
  if (!graphVersion) return null;
  const [entities, locations, relationships, signals] = await Promise.all([
    listEntities(),
    listLocations(),
    listRelationships(),
    listAnalyticalSignals(),
  ]);
  // Only signals stamped with the CURRENT graph version are live —
  // a stale signal from a prior graph version is never surfaced as
  // current, even though it stays in the store for audit purposes.
  const currentSignals = signals.filter((s) => s.graphVersion === graphVersion);
  return { investigation, graphVersion, entities, locations, relationships, signals: currentSignals };
}

function labelIndex(entities: { id: string; canonicalLabel: string; kind: string }[], locations: { id: string; label: string }[]) {
  const labelById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.canonicalLabel]),
    ...locations.map((l): [string, string] => [l.id, l.label]),
  ]);
  const kindById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.kind]),
    ...locations.map((l): [string, string] => [l.id, "location"]),
  ]);
  return { labelById, kindById };
}

export async function getRankedEntities(opts?: { offset?: number; limit?: number }): Promise<RankedEntitiesPage | null> {
  const ctx = await loadContext();
  if (!ctx) return null;
  const { entities, locations, signals, graphVersion } = ctx;
  const { labelById, kindById } = labelIndex(entities, locations);

  const rankingSignals = signals.filter((s) => s.signalType === "ranking" && s.targetEntityId).sort((a, b) => {
    const rankA = Number(a.value.rank ?? 0);
    const rankB = Number(b.value.rank ?? 0);
    return rankA - rankB;
  });
  const centralityByEntity = new Map<string, { degree: number; betweenness: number }>();
  for (const s of signals) {
    if (s.signalType !== "centrality" || !s.targetEntityId) continue;
    const entry = centralityByEntity.get(s.targetEntityId) ?? { degree: 0, betweenness: 0 };
    if (s.method === "analytics:degree_centrality") entry.degree = Number(s.value.score ?? 0);
    if (s.method === "analytics:betweenness_centrality") entry.betweenness = Number(s.value.score ?? 0);
    centralityByEntity.set(s.targetEntityId, entry);
  }
  const bridgeByEntity = new Map(
    signals.filter((s) => s.signalType === "bridge" && s.targetEntityId).map((s) => [s.targetEntityId!, Number(s.value.bridgeScore ?? 0)]),
  );

  const offset = Math.max(0, opts?.offset ?? 0);
  const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_ENTITIES_LIMIT), MAX_ENTITIES_LIMIT);
  const page = rankingSignals.slice(offset, offset + limit);

  const views: RankedEntityView[] = page.map((s) => {
    const id = s.targetEntityId!;
    const centrality = centralityByEntity.get(id) ?? { degree: 0, betweenness: 0 };
    return {
      id,
      kind: kindById.get(id) ?? "other",
      label: labelById.get(id) ?? id,
      rank: Number(s.value.rank ?? 0),
      score: Number(s.value.score ?? 0),
      degreeCentrality: centrality.degree,
      betweennessCentrality: centrality.betweenness,
      bridgeScore: bridgeByEntity.get(id) ?? 0,
    };
  });

  return { entities: views, total: rankingSignals.length, offset, limit, graphVersion };
}

export async function getBridgeEntities(): Promise<BridgeEntityView[] | null> {
  const ctx = await loadContext();
  if (!ctx) return null;
  const { entities, locations, signals } = ctx;
  const { labelById, kindById } = labelIndex(entities, locations);
  return signals
    .filter((s) => s.signalType === "bridge" && s.targetEntityId)
    .map((s) => ({
      id: s.targetEntityId!,
      kind: kindById.get(s.targetEntityId!) ?? "other",
      label: labelById.get(s.targetEntityId!) ?? s.targetEntityId!,
      bridgeScore: Number(s.value.bridgeScore ?? 0),
      componentsBefore: Number(s.value.componentsBefore ?? 0),
      componentsAfter: Number(s.value.componentsAfter ?? 0),
      affectedComponentSizes: Array.isArray(s.value.affectedComponentSizes) ? (s.value.affectedComponentSizes as number[]) : [],
      supportingEdgeIds: Array.isArray(s.value.supportingEdgeIds) ? (s.value.supportingEdgeIds as string[]) : [],
    }))
    .sort((a, b) => (b.bridgeScore !== a.bridgeScore ? b.bridgeScore - a.bridgeScore : a.id < b.id ? -1 : 1));
}

export async function getCommunities(): Promise<CommunityView[] | null> {
  const ctx = await loadContext();
  if (!ctx) return null;
  return ctx.signals
    .filter((s) => s.signalType === "community")
    .map((s) => ({
      id: String(s.value.clusterId ?? s.id),
      size: Number(s.value.size ?? 0),
      memberEntityIds: Array.isArray(s.value.memberEntityIds) ? (s.value.memberEntityIds as string[]) : [],
      dominantEntityTypes: (s.value.dominantEntityTypes as Record<string, number>) ?? {},
      dominantRelationshipTypes: (s.value.dominantRelationshipTypes as Record<string, number>) ?? {},
      representativeEntityIds: Array.isArray(s.value.representativeEntityIds) ? (s.value.representativeEntityIds as string[]) : [],
    }))
    .sort((a, b) => (b.size !== a.size ? b.size - a.size : a.id < b.id ? -1 : 1));
}

export async function getEntityAnalyticsDetail(entityId: string): Promise<EntityAnalyticsDetail | null> {
  const ctx = await loadContext();
  if (!ctx) return null;
  const { entities, locations, relationships, signals } = ctx;
  const entity = entities.find((e) => e.id === entityId);
  const location = locations.find((l) => l.id === entityId);
  if (!entity && !location) return null;

  const { graph } = buildAnalysisGraph(entities, locations, relationships);
  const degree = computeDegreeBreakdown(graph, entityId);

  const entitySignals = signals.filter((s) => s.targetEntityId === entityId);
  const signalViews: EntityMetricSignalView[] = entitySignals.map((s) => ({
    id: s.id,
    signalType: s.signalType,
    method: s.method,
    value: s.value,
    explanation: s.explanation,
    classification: s.classification,
    confidence: s.provenance.confidence,
    supportingEdgeIds: Array.isArray(s.value.supportingEdgeIds) ? (s.value.supportingEdgeIds as string[]) : [],
  }));

  const community = signals.find(
    (s) => s.signalType === "community" && Array.isArray(s.value.memberEntityIds) && (s.value.memberEntityIds as string[]).includes(entityId),
  );

  return {
    id: entityId,
    kind: entity ? entity.kind : "location",
    label: entity ? entity.canonicalLabel : location!.label,
    degree,
    signals: signalViews,
    communityId: community ? String(community.value.clusterId ?? community.id) : null,
  };
}

export async function getPath(
  sourceEntityId: string,
  targetEntityId: string,
  relationshipTypes?: RelationshipType[],
): Promise<PathResult | null> {
  const ctx = await loadContext();
  if (!ctx) return null;
  return computeShortestPath(ctx.entities, ctx.locations, ctx.relationships, sourceEntityId, targetEntityId, relationshipTypes);
}
