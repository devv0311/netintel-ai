import Graph from "graphology";
import { bidirectional } from "graphology-shortest-path/unweighted";
import { edgePathFromNodePath } from "graphology-shortest-path/utils";

import type { Entity } from "@/lib/domain/entity";
import type { Location } from "@/lib/domain/location";
import type { Relationship, RelationshipType } from "@/lib/domain/relationship";

import type { PathResult } from "./types";

/**
 * Shortest-path analysis — always computed live from the persisted
 * graph, never persisted itself (a path is a query-parameterized
 * result driven by an investigator picking two entities, not a
 * corpus-wide signal — see docs/data/analytics.md). The algorithm only
 * ever traverses real, already-persisted relationship edges; it can
 * never manufacture one.
 *
 * Reachability is computed over an UNDIRECTED projection, deliberately
 * distinct from src/lib/analytics/build.ts's directed analysis graph
 * (used for in/out degree and directed betweenness, where direction is
 * meaningful). `ownership` edges only ever point person → identifier
 * (never the reverse), so a strictly directed search could report "no
 * path" between two people who are structurally connected only through
 * an identifier they each own in the "wrong" direction for a directed
 * walk — undirected reachability is what "is there a connection between
 * these two entities" investigatively means. Each edge in the result
 * still reports its own true stored direction (`directed`/
 * `relationshipType`), so the investigator sees the real flow, e.g. a
 * financial chain's actual from-account -> to-account direction.
 *
 * Deterministic: the graph is built in sorted (id-order) insertion
 * order, so `bidirectional`'s neighbor traversal — and therefore which
 * one of several equally-short paths it returns — is the same every
 * time for the same inputs (see tests/unit/analytics.test.ts).
 */
function buildUndirectedPathGraph(entities: Entity[], locations: Location[], relationships: Relationship[]): Graph {
  const graph = new Graph({ type: "undirected", multi: true, allowSelfLoops: false });
  const sortedEntities = [...entities].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedLocations = [...locations].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const sortedRelationships = [...relationships].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  for (const e of sortedEntities) graph.addNode(e.id, { kind: e.kind, label: e.canonicalLabel });
  for (const l of sortedLocations) graph.addNode(l.id, { kind: "location", label: l.label });
  for (const r of sortedRelationships) {
    if (!graph.hasNode(r.sourceEntityId) || !graph.hasNode(r.targetEntityId)) continue;
    if (graph.hasEdge(r.id)) continue;
    graph.addEdgeWithKey(r.id, r.sourceEntityId, r.targetEntityId, {
      relationshipType: r.relationshipType,
      directed: r.directed,
      classification: r.classification,
    });
  }
  return graph;
}

export function computeShortestPath(
  entities: Entity[],
  locations: Location[],
  relationships: Relationship[],
  sourceEntityId: string,
  targetEntityId: string,
  allowedRelationshipTypes?: RelationshipType[],
): PathResult {
  const filtered =
    allowedRelationshipTypes && allowedRelationshipTypes.length > 0
      ? relationships.filter((r) => allowedRelationshipTypes.includes(r.relationshipType))
      : relationships;

  const graph = buildUndirectedPathGraph(entities, locations, filtered);

  if (!graph.hasNode(sourceEntityId)) {
    return { found: false, sourceEntityId, targetEntityId, reason: "Source entity not found in the graph." };
  }
  if (!graph.hasNode(targetEntityId)) {
    return { found: false, sourceEntityId, targetEntityId, reason: "Target entity not found in the graph." };
  }
  if (sourceEntityId === targetEntityId) {
    return { found: false, sourceEntityId, targetEntityId, reason: "Source and target are the same entity." };
  }

  const nodePath = bidirectional(graph, sourceEntityId, targetEntityId);
  if (!nodePath) {
    return {
      found: false,
      sourceEntityId,
      targetEntityId,
      reason:
        allowedRelationshipTypes && allowedRelationshipTypes.length > 0
          ? `No path exists between these entities using only the selected relationship type(s) (${allowedRelationshipTypes.join(", ")}).`
          : "No path exists between these entities in the current graph.",
    };
  }

  const edgeIds = edgePathFromNodePath(graph, nodePath);
  const edges = edgeIds.map((edgeId) => {
    const attrs = graph.getEdgeAttributes(edgeId);
    const [source, target] = graph.extremities(edgeId);
    return {
      id: edgeId,
      source,
      target,
      relationshipType: String(attrs.relationshipType),
      directed: Boolean(attrs.directed),
      classification: String(attrs.classification),
    };
  });

  return {
    found: true,
    sourceEntityId,
    targetEntityId,
    nodeIds: nodePath,
    edges,
    hopCount: edgeIds.length,
  };
}
