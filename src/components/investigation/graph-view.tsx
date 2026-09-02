"use client";

import { useEffect, useRef } from "react";
import Graph from "graphology";
import Sigma from "sigma";

import type { GraphSnapshot } from "@/lib/graph/types";

const KIND_COLORS: Record<string, string> = {
  person: "#2563eb",
  phone: "#16a34a",
  imei: "#0891b2",
  vehicle: "#a16207",
  bank_account: "#dc2626",
  location: "#7c3aed",
  other: "#64748b",
};
const EDGE_COLORS: Record<string, string> = {
  ownership: "#94a3b8",
  communication: "#16a34a",
  financial: "#dc2626",
  co_location: "#7c3aed",
  family: "#a16207",
  associate: "#64748b",
  other: "#94a3b8",
};

/**
 * The sigma.js graph canvas. Consumes a bounded GraphSnapshot (never the
 * full unbounded graph) and renders it as a graphology instance — the
 * same in-memory model the server rebuilds from SQLite
 * (src/lib/graph/runtime.ts), so there is no separate client data
 * shape to keep in sync, per docs/architecture/stack-contract.md's
 * rationale for choosing sigma.js. Prioritizes investigative
 * readability: distinct colors per node kind and edge type, no
 * animation beyond sigma's own hover/selection rendering, and clear
 * dimming of anything outside a selected node's neighborhood.
 */
export function GraphView({
  snapshot,
  selectedNodeId,
  selectedEdgeId,
  hiddenKinds,
  hiddenTypes,
  onSelectNode,
  onSelectEdge,
}: {
  snapshot: GraphSnapshot;
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
  hiddenKinds: Set<string>;
  hiddenTypes: Set<string>;
  onSelectNode: (id: string | null) => void;
  onSelectEdge: (id: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);

  // Rebuild the graphology instance whenever the snapshot changes.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({ type: "directed", multi: true, allowSelfLoops: false });
    const angleStep = snapshot.nodes.length > 0 ? (2 * Math.PI) / snapshot.nodes.length : 0;
    snapshot.nodes.forEach((n, i) => {
      const radius = 1 + (i % 5) * 0.6;
      graph.addNode(n.id, {
        label: n.label,
        kind: n.kind,
        size: 4 + Math.min(10, n.degree),
        color: KIND_COLORS[n.kind] ?? KIND_COLORS.other,
        x: radius * Math.cos(i * angleStep),
        y: radius * Math.sin(i * angleStep),
      });
    });
    for (const e of snapshot.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      if (graph.hasEdge(e.id)) continue;
      graph.addEdgeWithKey(e.id, e.source, e.target, {
        type: "arrow",
        relationshipType: e.relationshipType,
        color: EDGE_COLORS[e.relationshipType] ?? EDGE_COLORS.other,
        size: 1.2,
      });
    }
    graphRef.current = graph;

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 6,
      defaultEdgeType: "arrow",
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
    });
    sigmaRef.current = sigma;

    sigma.on("clickNode", ({ node }) => onSelectNode(node));
    sigma.on("clickEdge", ({ edge }) => onSelectEdge(edge));
    sigma.on("clickStage", () => {
      onSelectNode(null);
      onSelectEdge(null);
    });

    return () => {
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // Apply filtering/selection reducers without rebuilding the graph.
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    sigma.setSetting("nodeReducer", (node, data) => {
      const kindHidden = hiddenKinds.has(data.kind as string);
      const outsideNeighborhood =
        selectedNodeId !== null && node !== selectedNodeId && !graph.areNeighbors(node, selectedNodeId);
      return {
        ...data,
        hidden: kindHidden || outsideNeighborhood,
        highlighted: node === selectedNodeId,
        zIndex: node === selectedNodeId ? 1 : 0,
      };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const typeHidden = hiddenTypes.has(data.relationshipType as string);
      const outsideNeighborhood = selectedNodeId !== null && !graph.extremities(edge).includes(selectedNodeId);
      return {
        ...data,
        hidden: typeHidden || outsideNeighborhood,
        size: edge === selectedEdgeId ? 3 : 1.2,
      };
    });
    sigma.refresh();
  }, [hiddenKinds, hiddenTypes, selectedNodeId, selectedEdgeId]);

  return (
    <div
      ref={containerRef}
      className="h-[520px] w-full rounded-md border border-border bg-card"
      data-testid="graph-canvas"
    />
  );
}
