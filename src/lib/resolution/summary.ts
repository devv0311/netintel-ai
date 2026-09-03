import {
  listAliases,
  listEntities,
  listInvestigations,
  listResolutionDecisions,
} from "@/lib/db/repository";

import { getResolutionMarker, resolutionMarkerKey } from "./marker";
import type {
  EntityDetail,
  ResolvedEntitiesPage,
  ResolvedEntityView,
  ResolutionState,
  ResolutionSummary,
} from "./types";

/**
 * The server-derived resolution state the page renders from, mirroring
 * src/lib/extraction/summary.ts. Reads only domain resolution tables +
 * the resolution marker — never evidence/ground-truth/.
 */
export async function getResolutionState(): Promise<ResolutionState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return { status: "not_available" };

  const marker = await getResolutionMarker(resolutionMarkerKey(investigation.id));
  const entities = await listEntities();
  if (!marker || entities.length === 0) return { status: "pending" };

  const [aliases, decisions] = await Promise.all([listAliases(), listResolutionDecisions()]);

  const entitiesByKind: Record<string, number> = {};
  for (const e of entities) entitiesByKind[e.kind] = (entitiesByKind[e.kind] ?? 0) + 1;
  const decisionsByType: Record<string, number> = {};
  for (const d of decisions) decisionsByType[d.resolutionType] = (decisionsByType[d.resolutionType] ?? 0) + 1;
  const decisionsByStatus: Record<string, number> = {};
  for (const d of decisions) decisionsByStatus[d.status] = (decisionsByStatus[d.status] ?? 0) + 1;

  const summary: ResolutionSummary = {
    investigationId: investigation.id,
    resolvedAt: marker.resolvedAt,
    totalEntities: entities.length,
    entitiesByKind,
    totalAliases: aliases.length,
    totalDecisions: decisions.length,
    decisionsByType,
    decisionsByStatus,
    ambiguousDecisions: decisions.filter((d) => d.status === "ambiguous").length,
    unresolvedDecisions: decisions.filter((d) => d.status === "unresolved").length,
  };
  return { status: "resolved", summary };
}

const DEFAULT_ENTITIES_LIMIT = 25;
const MAX_ENTITIES_LIMIT = 100;

/**
 * A representative, paginated slice of resolved entities for the
 * resolution-results view — never the full entity set in one response.
 * Person entities are surfaced first (the interesting resolution
 * outcomes: merges, singles, ambiguous cases), sorted by id for a
 * stable page order across repeated calls.
 */
export async function getResolvedEntitiesPage(
  offset = 0,
  limit = DEFAULT_ENTITIES_LIMIT,
): Promise<ResolvedEntitiesPage> {
  const boundedOffset = Math.max(0, offset);
  const boundedLimit = Math.min(Math.max(1, limit), MAX_ENTITIES_LIMIT);

  const [entities, aliases, decisions] = await Promise.all([
    listEntities(),
    listAliases(),
    listResolutionDecisions(),
  ]);

  const aliasesByEntity = new Map<string, string[]>();
  for (const a of aliases) {
    const list = aliasesByEntity.get(a.entityId) ?? [];
    list.push(a.aliasValue);
    aliasesByEntity.set(a.entityId, list);
  }
  const decisionsByEntity = new Map<string, typeof decisions>();
  for (const d of decisions) {
    const list = decisionsByEntity.get(d.canonicalEntityId) ?? [];
    list.push(d);
    decisionsByEntity.set(d.canonicalEntityId, list);
  }

  const sorted = [...entities].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "person" ? -1 : b.kind === "person" ? 1 : (a.kind < b.kind ? -1 : 1);
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const page = sorted.slice(boundedOffset, boundedOffset + boundedLimit);

  const views: ResolvedEntityView[] = page.map((e) => {
    const entityDecisions = decisionsByEntity.get(e.id) ?? [];
    return {
      id: e.id,
      kind: e.kind,
      canonicalLabel: e.canonicalLabel,
      aliases: (aliasesByEntity.get(e.id) ?? []).sort(),
      decisionCount: entityDecisions.length,
      hasAmbiguousDecision: entityDecisions.some((d) => d.status === "ambiguous"),
      isUnresolved:
        entityDecisions.length > 0 && entityDecisions.every((d) => d.status === "unresolved"),
      confidence: e.provenance.confidence,
      provenance: {
        source: e.provenance.source,
        location: e.provenance.location,
        method: e.provenance.method,
        processingHistory: e.provenance.processingHistory,
        timestamp: e.provenance.timestamp,
      },
    };
  });

  return { entities: views, total: entities.length, offset: boundedOffset, limit: boundedLimit };
}

/** Full detail for one canonical entity: every contributing decision. */
export async function getEntityDetail(entityId: string): Promise<EntityDetail | null> {
  const [entities, aliases, decisions] = await Promise.all([
    listEntities(),
    listAliases(),
    listResolutionDecisions(),
  ]);
  const entity = entities.find((e) => e.id === entityId);
  if (!entity) return null;

  return {
    id: entity.id,
    kind: entity.kind,
    canonicalLabel: entity.canonicalLabel,
    aliases: aliases.filter((a) => a.entityId === entityId).map((a) => a.aliasValue).sort(),
    decisions: decisions
      .filter((d) => d.canonicalEntityId === entityId)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((d) => ({
        id: d.id,
        extractedRecordIds: d.extractedRecordIds,
        resolutionType: d.resolutionType,
        status: d.status,
        candidateEntityIds: d.candidateEntityIds,
        conflicts: d.conflicts,
        reason: d.reason,
        classification: d.classification,
        confidence: d.provenance.confidence,
        provenance: {
          source: d.provenance.source,
          location: d.provenance.location,
          method: d.provenance.method,
          processingHistory: d.provenance.processingHistory,
          timestamp: d.provenance.timestamp,
        },
      })),
  };
}
