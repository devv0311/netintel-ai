import Graph from "graphology";

import type { Entity } from "@/lib/domain/entity";
import type { Location } from "@/lib/domain/location";
import type { Relationship } from "@/lib/domain/relationship";

/**
 * The graph processing boundary. Per
 * docs/architecture/technology-stack.md, the case graph is an in-memory
 * graphology instance rebuilt from SQLite — never the source of truth
 * on its own.
 */
export function createEmptyGraph(): Graph {
  return new Graph({ type: "directed", multi: true, allowSelfLoops: false });
}

/**
 * Rebuilds the in-memory graphology graph from persisted rows only —
 * SQLite (via the repository layer) is the source of truth; this graph
 * is always a rebuildable projection of it, never authoritative on its
 * own (docs/architecture/stack-contract.md).
 */
export function buildGraphFromRows(entities: Entity[], locations: Location[], relationships: Relationship[]): Graph {
  const graph = createEmptyGraph();
  for (const e of entities) {
    graph.addNode(e.id, { kind: e.kind, label: e.canonicalLabel });
  }
  for (const l of locations) {
    graph.addNode(l.id, { kind: "location", label: l.label });
  }
  for (const r of relationships) {
    if (!graph.hasNode(r.sourceEntityId) || !graph.hasNode(r.targetEntityId)) continue; // defensive; verify.ts already guarantees this
    graph.addEdgeWithKey(r.id, r.sourceEntityId, r.targetEntityId, {
      relationshipType: r.relationshipType,
      directed: r.directed,
      classification: r.classification,
      confidence: r.provenance.confidence,
    });
  }
  return graph;
}

export function getNeighborhood(graph: Graph, nodeId: string): { nodeIds: string[]; edgeIds: string[] } {
  if (!graph.hasNode(nodeId)) return { nodeIds: [], edgeIds: [] };
  const nodeIds = new Set<string>([nodeId]);
  const edgeIds: string[] = [];
  graph.forEachEdge(nodeId, (edge, _attrs, source, target) => {
    edgeIds.push(edge);
    nodeIds.add(source);
    nodeIds.add(target);
  });
  return { nodeIds: [...nodeIds], edgeIds };
}
