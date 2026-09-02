import {
  listAliases,
  listEntities,
  listExtractedRecords,
  listInvestigations,
  listLocations,
  listRelationships,
} from "@/lib/db/repository";

import { getGraphMarker, graphMarkerKey } from "./marker";
import { buildGraphFromRows, getNeighborhood } from "./runtime";
import type {
  EdgeDetail,
  EdgeDetailEvidenceRef,
  EdgeView,
  GraphSnapshot,
  GraphState,
  GraphSummary,
  NodeDetail,
  NodeDetailEdgeView,
  NodeView,
} from "./types";

/**
 * The server-derived graph state/query surface the Graph screen and API
 * routes render from, mirroring src/lib/resolution/summary.ts. Reads
 * only domain graph tables (entities, locations, relationships) plus
 * the graph marker — never evidence/ground-truth/.
 */

const DEFAULT_SNAPSHOT_LIMIT = 200;
const MAX_SNAPSHOT_LIMIT = 400;

export async function getGraphState(): Promise<GraphState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return { status: "not_available" };

  const marker = await getGraphMarker(graphMarkerKey(investigation.id));
  const relationships = await listRelationships();
  if (!marker || relationships.length === 0) return { status: "pending" };

  const [entities, locations] = await Promise.all([listEntities(), listLocations()]);
  const nodesByKind: Record<string, number> = {};
  for (const e of entities) nodesByKind[e.kind] = (nodesByKind[e.kind] ?? 0) + 1;
  if (locations.length > 0) nodesByKind.location = locations.length;
  const edgesByType: Record<string, number> = {};
  const edgesByClassification: Record<string, number> = {};
  for (const r of relationships) {
    edgesByType[r.relationshipType] = (edgesByType[r.relationshipType] ?? 0) + 1;
    edgesByClassification[r.classification] = (edgesByClassification[r.classification] ?? 0) + 1;
  }

  const summary: GraphSummary = {
    investigationId: investigation.id,
    synthesizedAt: marker.synthesizedAt,
    totalNodes: entities.length + locations.length,
    nodesByKind,
    totalEdges: relationships.length,
    edgesByType,
    edgesByClassification,
  };
  return { status: "synthesized", summary };
}

export async function getGraphSnapshot(opts?: { limit?: number; focus?: string }): Promise<GraphSnapshot> {
  const [entities, locations, relationships] = await Promise.all([listEntities(), listLocations(), listRelationships()]);
  const graph = buildGraphFromRows(entities, locations, relationships);
  const labelById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.canonicalLabel]),
    ...locations.map((l): [string, string] => [l.id, l.label]),
  ]);
  const kindById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.kind]),
    ...locations.map((l): [string, string] => [l.id, "location"]),
  ]);

  const limit = Math.min(Math.max(1, opts?.limit ?? DEFAULT_SNAPSHOT_LIMIT), MAX_SNAPSHOT_LIMIT);

  let nodeIds: string[];
  let edgeIds: string[];
  if (opts?.focus && graph.hasNode(opts.focus)) {
    const neighborhood = getNeighborhood(graph, opts.focus);
    nodeIds = neighborhood.nodeIds;
    edgeIds = neighborhood.edgeIds;
  } else {
    const byDegree = [...graph.nodes()].sort((a, b) => graph.degree(b) - graph.degree(a));
    nodeIds = byDegree.slice(0, limit);
    const nodeSet = new Set(nodeIds);
    edgeIds = [...graph.edges()].filter((e) => nodeSet.has(graph.source(e)) && nodeSet.has(graph.target(e)));
  }

  const nodes: NodeView[] = nodeIds.map((id) => ({
    id,
    kind: kindById.get(id) ?? "other",
    label: labelById.get(id) ?? id,
    degree: graph.degree(id),
  }));
  const edges: EdgeView[] = edgeIds.map((id) => {
    const attrs = graph.getEdgeAttributes(id);
    return {
      id,
      source: graph.source(id),
      target: graph.target(id),
      relationshipType: attrs.relationshipType as string,
      directed: attrs.directed as boolean,
      classification: attrs.classification as string,
      confidence: attrs.confidence as number,
    };
  });

  return {
    nodes,
    edges,
    truncated: !opts?.focus && graph.order > nodes.length,
    totalNodes: graph.order,
    totalEdges: graph.size,
  };
}

export async function getNodeDetail(id: string): Promise<NodeDetail | null> {
  const [entities, locations, aliases, relationships] = await Promise.all([
    listEntities(),
    listLocations(),
    listAliases(),
    listRelationships(),
  ]);
  const entity = entities.find((e) => e.id === id);
  const location = locations.find((l) => l.id === id);
  if (!entity && !location) return null;

  const labelById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.canonicalLabel]),
    ...locations.map((l): [string, string] => [l.id, l.label]),
  ]);
  const kindById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.kind]),
    ...locations.map((l): [string, string] => [l.id, "location"]),
  ]);

  const edges: NodeDetailEdgeView[] = relationships
    .filter((r) => r.sourceEntityId === id || r.targetEntityId === id)
    .map((r) => {
      const outgoing = r.sourceEntityId === id;
      const otherId = outgoing ? r.targetEntityId : r.sourceEntityId;
      return {
        id: r.id,
        relationshipType: r.relationshipType,
        direction: outgoing ? "outgoing" : "incoming",
        otherNodeId: otherId,
        otherNodeLabel: labelById.get(otherId) ?? otherId,
        otherNodeKind: kindById.get(otherId) ?? "other",
        classification: r.classification,
        confidence: r.provenance.confidence,
      };
    });

  if (entity) {
    return {
      id: entity.id,
      kind: entity.kind,
      label: entity.canonicalLabel,
      aliases: aliases.filter((a) => a.entityId === entity.id).map((a) => a.aliasValue).sort(),
      attributes: entity.attributes,
      provenance: {
        source: entity.provenance.source,
        location: entity.provenance.location,
        method: entity.provenance.method,
        processingHistory: entity.provenance.processingHistory,
        timestamp: entity.provenance.timestamp,
      },
      edges,
    };
  }
  return {
    id: location!.id,
    kind: "location",
    label: location!.label,
    aliases: [],
    attributes: { locationType: location!.locationType, latitude: location!.latitude, longitude: location!.longitude },
    provenance: {
      source: location!.provenance.source,
      location: location!.provenance.location,
      method: location!.provenance.method,
      processingHistory: location!.provenance.processingHistory,
      timestamp: location!.provenance.timestamp,
    },
    edges,
  };
}

export async function getEdgeDetail(id: string): Promise<EdgeDetail | null> {
  const [entities, locations, relationships, extractedRecords] = await Promise.all([
    listEntities(),
    listLocations(),
    listRelationships(),
    listExtractedRecords(),
  ]);
  const relationship = relationships.find((r) => r.id === id);
  if (!relationship) return null;

  const labelById = new Map<string, string>([
    ...entities.map((e): [string, string] => [e.id, e.canonicalLabel]),
    ...locations.map((l): [string, string] => [l.id, l.label]),
  ]);
  const recordById = new Map(extractedRecords.map((r) => [r.id, r]));

  const extractedRecordsOut: EdgeDetailEvidenceRef[] = relationship.extractedRecordIds
    .map((recId) => recordById.get(recId))
    .filter((r): r is NonNullable<typeof r> => Boolean(r))
    .map((r) => ({ extractedRecordId: r.id, evidenceItemId: r.evidenceItemId, recordType: r.recordType, location: r.provenance.location }));

  return {
    id: relationship.id,
    sourceEntityId: relationship.sourceEntityId,
    sourceLabel: labelById.get(relationship.sourceEntityId) ?? relationship.sourceEntityId,
    targetEntityId: relationship.targetEntityId,
    targetLabel: labelById.get(relationship.targetEntityId) ?? relationship.targetEntityId,
    relationshipType: relationship.relationshipType,
    directed: relationship.directed,
    classification: relationship.classification,
    confidence: relationship.provenance.confidence,
    attributes: relationship.attributes,
    conflicts: relationship.conflicts,
    evidenceItemIds: relationship.evidenceItemIds,
    extractedRecords: extractedRecordsOut,
    provenance: {
      source: relationship.provenance.source,
      location: relationship.provenance.location,
      method: relationship.provenance.method,
      processingHistory: relationship.provenance.processingHistory,
      timestamp: relationship.provenance.timestamp,
    },
  };
}
