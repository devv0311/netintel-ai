"use client";

import { useEffect, useRef, useState } from "react";
import Graph from "graphology";
import Sigma from "sigma";

import type { GraphSnapshot } from "@/lib/graph/types";
import { computeLayout } from "@/lib/graph/layout";
import { EDGE_VAR, KIND_VAR, resolveToken, withAlpha } from "@/lib/graph/tokens";

const MIN_NODE_SIZE = 5;
const MAX_NODE_SIZE = 18;
const MIN_EDGE_WIDTH = 1;
const MAX_EDGE_WIDTH = 4.5;
const DIM_ALPHA = 0.12;
/** Near-zero — AI-inference edges render in the WebGL layer at this alpha (still hit-testable; picking is independent of display color) so the dashed 2D overlay is the only visible representation, since sigma's bundled WebGL edge programs have no native dash support. */
const LABEL_FONT =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const AI_INFERENCE_WEBGL_ALPHA = 0.001;

interface NodeAttrs {
  label: string;
  kind: string;
  degree: number;
  size: number;
  baseColor: string;
  x: number;
  y: number;
}

interface EdgeAttrs {
  type: string;
  relationshipType: string;
  classification: string;
  confidence: number;
  baseColor: string;
  baseWidth: number;
  isAiInference: boolean;
}

interface HoverInfo {
  x: number;
  y: number;
  label: string;
  kind: string;
  degree: number;
}

/**
 * The sigma.js graph canvas (M10.4 redesign). Consumes a bounded
 * GraphSnapshot (never the full unbounded graph) and renders it as a
 * graphology instance — the same in-memory model the server rebuilds
 * from SQLite (src/lib/graph/runtime.ts) — with a deterministic,
 * once-per-snapshot spatial layout (@/lib/graph/layout, a self-contained
 * ForceAtlas2-style simulation: no new dependency) instead of a circular
 * placement, and no per-frame animation. Colors come from the M10.2
 * `--kind-*` / `--edge-*` tokens (@/lib/graph/tokens), never a second
 * palette. Selection dims — never hides — everything outside the
 * selected node's neighborhood; AI-inference edges render dashed via a
 * 2D overlay canvas kept in sync with sigma's own camera, since sigma's
 * bundled WebGL edge programs have no native dash support.
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
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const visualStateRef = useRef({ selectedNodeId, selectedEdgeId, hiddenKinds, hiddenTypes });
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // Rebuild the graphology instance and its one-time layout whenever the
  // snapshot changes; wire interaction, hover, and the dashed-edge overlay.
  useEffect(() => {
    if (!containerRef.current) return;
    const graph = new Graph({ type: "directed", multi: true, allowSelfLoops: false });

    const maxDegree = Math.max(1, ...snapshot.nodes.map((n) => n.degree));
    const positions = computeLayout(
      snapshot.nodes.map((n) => ({ id: n.id, degree: n.degree })),
      snapshot.edges.map((e) => ({ source: e.source, target: e.target })),
    );

    snapshot.nodes.forEach((n) => {
      const p = positions.get(n.id) ?? { x: 0, y: 0 };
      const size = MIN_NODE_SIZE + (MAX_NODE_SIZE - MIN_NODE_SIZE) * Math.sqrt(n.degree / maxDegree);
      graph.addNode(n.id, {
        label: n.label,
        kind: n.kind,
        degree: n.degree,
        size,
        baseColor: resolveToken(KIND_VAR[n.kind] ?? KIND_VAR.other!),
        color: resolveToken(KIND_VAR[n.kind] ?? KIND_VAR.other!),
        x: p.x,
        y: p.y,
      });
    });

    for (const e of snapshot.edges) {
      if (!graph.hasNode(e.source) || !graph.hasNode(e.target)) continue;
      if (graph.hasEdge(e.id)) continue;
      const baseWidth =
        MIN_EDGE_WIDTH + (MAX_EDGE_WIDTH - MIN_EDGE_WIDTH) * Math.min(1, Math.max(0, e.confidence));
      const isAiInference = e.classification === "ai_inference";
      const baseColor = resolveToken(EDGE_VAR[e.relationshipType] ?? EDGE_VAR.other!);
      graph.addEdgeWithKey(e.id, e.source, e.target, {
        type: "arrow",
        relationshipType: e.relationshipType,
        classification: e.classification,
        confidence: e.confidence,
        baseColor,
        baseWidth,
        isAiInference,
        color: isAiInference ? withAlpha(baseColor, AI_INFERENCE_WEBGL_ALPHA) : baseColor,
        size: baseWidth,
      });
    }
    graphRef.current = graph;

    const accent = resolveToken("--accent");
    const labelBg = resolveToken("--surface-3");
    const labelFg = resolveToken("--fg");

    // Draws the selected/hovered node's accent ring + always-on label on
    // sigma's dedicated 2D hover canvas — the only customization point
    // sigma exposes for this without a custom WebGL node program.
    const drawSelectionRing = (
      context: CanvasRenderingContext2D,
      data: { x: number; y: number; size: number; label: string | null },
      settings: { labelSize: number; labelFont: string; labelWeight: string },
    ) => {
      context.save();
      context.beginPath();
      context.arc(data.x, data.y, data.size + 4, 0, Math.PI * 2);
      context.lineWidth = 2.5;
      context.strokeStyle = accent;
      context.stroke();
      context.restore();

      if (data.label) {
        const size = settings.labelSize;
        context.font = `${settings.labelWeight} ${size}px ${settings.labelFont}`;
        const textWidth = context.measureText(data.label).width;
        const x = data.x + data.size + 8;
        const y = data.y + size / 3;
        context.fillStyle = labelBg;
        context.fillRect(x - 4, y - size, textWidth + 8, size + 6);
        context.fillStyle = labelFg;
        context.fillText(data.label, x, y);
      }
    };

    const sigma = new Sigma(graph, containerRef.current, {
      renderEdgeLabels: false,
      labelRenderedSizeThreshold: 6,
      defaultEdgeType: "arrow",
      minCameraRatio: 0.1,
      maxCameraRatio: 10,
      defaultDrawNodeHover: drawSelectionRing,
      // Sigma's own label colour defaults to black, which was invisible on
      // the dark operational canvas — the selection/hover label above
      // already read `--fg` and the ordinary ones did not. Both now come
      // from the same token, so the canvas cannot disagree with the theme.
      labelColor: { color: labelFg },
      labelFont: LABEL_FONT,
      labelSize: 12,
      labelWeight: "500",
      // Thin the labels out. At the default grid size the dense
      // phone/IMEI cluster printed a dozen overlapping strings on top of
      // each other, which is worse than printing none of them.
      labelGridCellSize: 130,
      labelDensity: 0.6,
    });
    sigmaRef.current = sigma;

    sigma.on("clickNode", ({ node }) => onSelectNode(node));
    sigma.on("clickEdge", ({ edge }) => onSelectEdge(edge));
    sigma.on("clickStage", () => {
      onSelectNode(null);
      onSelectEdge(null);
    });
    sigma.on("enterNode", ({ node, event }) => {
      const attrs = graph.getNodeAttributes(node) as NodeAttrs;
      setHover({ x: event.x, y: event.y, label: attrs.label, kind: attrs.kind, degree: attrs.degree });
    });
    sigma.on("leaveNode", () => setHover(null));

    // The dashed AI-inference overlay: redrawn only on sigma's own
    // render pass (afterRender fires after pan/zoom/selection changes,
    // never on a timer or rAF loop), reading live selection/filter state
    // off `visualStateRef` so it doesn't need re-registering.
    const overlay = overlayRef.current;
    const resizeOverlay = () => {
      if (!overlay || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      overlay.width = Math.max(1, Math.round(rect.width * dpr));
      overlay.height = Math.max(1, Math.round(rect.height * dpr));
      overlay.style.width = `${rect.width}px`;
      overlay.style.height = `${rect.height}px`;
    };
    const drawOverlay = () => {
      if (!overlay) return;
      const ctx = overlay.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);

      const { selectedNodeId: selNode, selectedEdgeId: selEdge, hiddenTypes: hiddenT } = visualStateRef.current;
      graph.forEachEdge((edgeKey, attrs, source, target) => {
        const edgeAttrs = attrs as EdgeAttrs;
        if (!edgeAttrs.isAiInference) return;
        if (hiddenT.has(edgeAttrs.relationshipType)) return;
        const sourceData = sigma.getNodeDisplayData(source);
        const targetData = sigma.getNodeDisplayData(target);
        if (!sourceData || !targetData || sourceData.hidden || targetData.hidden) return;

        const touchesSelection = selNode === null || source === selNode || target === selNode;
        const dim = selNode !== null && !touchesSelection;
        const selected = edgeKey === selEdge;
        const alpha = dim ? DIM_ALPHA : 1;
        const width = selected ? Math.max(3.5, edgeAttrs.baseWidth * 1.8) : edgeAttrs.baseWidth;
        const strokeColor = selected ? withAlpha(accent, 1) : withAlpha(edgeAttrs.baseColor, alpha);

        const p1 = sigma.framedGraphToViewport(sourceData);
        const p2 = sigma.framedGraphToViewport(targetData);
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ux = dx / dist;
        const uy = dy / dist;
        const rSource = sigma.scaleSize(sourceData.size);
        const rTarget = sigma.scaleSize(targetData.size);
        const startX = p1.x + ux * (rSource + 2);
        const startY = p1.y + uy * (rSource + 2);
        const endX = p2.x - ux * (rTarget + 8);
        const endY = p2.y - uy * (rTarget + 8);

        ctx.save();
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = Math.max(1, width);
        ctx.setLineDash([Math.max(4, width * 3), Math.max(3, width * 2)]);
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.restore();
      });
    };

    resizeOverlay();
    sigma.on("afterRender", drawOverlay);
    sigma.on("resize", () => {
      resizeOverlay();
      drawOverlay();
    });

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        resizeOverlay();
        sigma.refresh();
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      resizeObserver?.disconnect();
      sigma.kill();
      sigmaRef.current = null;
      graphRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  // Apply filtering/selection reducers without rebuilding the graph, and
  // keep the overlay's visual-state ref current — it reads this on its
  // own render-driven redraw rather than being re-registered per change.
  useEffect(() => {
    visualStateRef.current = { selectedNodeId, selectedEdgeId, hiddenKinds, hiddenTypes };
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    const accent = resolveToken("--accent");

    sigma.setSetting("nodeReducer", (node, data) => {
      const attrs = data as unknown as NodeAttrs;
      const kindHidden = hiddenKinds.has(attrs.kind);
      const isNeighbor = selectedNodeId === null || node === selectedNodeId || graph.areNeighbors(node, selectedNodeId);
      const dim = selectedNodeId !== null && !isNeighbor;
      return {
        ...data,
        hidden: kindHidden,
        color: dim ? withAlpha(attrs.baseColor, DIM_ALPHA) : attrs.baseColor,
        highlighted: node === selectedNodeId,
        zIndex: node === selectedNodeId ? 1 : 0,
      };
    });
    sigma.setSetting("edgeReducer", (edge, data) => {
      const attrs = data as unknown as EdgeAttrs;
      const typeHidden = hiddenTypes.has(attrs.relationshipType);
      const touchesSelection = selectedNodeId === null || graph.extremities(edge).includes(selectedNodeId);
      const dim = selectedNodeId !== null && !touchesSelection;
      const selected = edge === selectedEdgeId;
      const alpha = dim ? DIM_ALPHA : 1;
      // AI-inference edges stay near-invisible in the WebGL layer even
      // when selected — the dashed overlay (which does react to
      // selection) is their only visible representation.
      const webglAlpha = attrs.isAiInference ? AI_INFERENCE_WEBGL_ALPHA : selected ? 1 : alpha;
      const displayColor = selected ? accent : attrs.baseColor;
      return {
        ...data,
        hidden: typeHidden,
        color: withAlpha(displayColor, webglAlpha),
        size: selected ? Math.max(3.5, attrs.baseWidth * 1.8) : attrs.baseWidth,
        zIndex: selected ? 1 : 0,
      };
    });
    sigma.refresh();
  }, [hiddenKinds, hiddenTypes, selectedNodeId, selectedEdgeId, snapshot]);

  return (
    <div className="relative h-full w-full" data-testid="graph-canvas-wrapper">
      <div
        ref={containerRef}
        className="absolute inset-0 rounded-md border border-border bg-card"
        data-testid="graph-canvas"
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0" aria-hidden />
      {hover && (
        <div
          className="pointer-events-none absolute z-10 max-w-[220px] rounded-md border border-border-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 10 }}
          data-testid="graph-hover-tooltip"
        >
          <div className="truncate font-medium">{hover.label}</div>
          <div className="text-fg-muted">
            {hover.kind} · degree {hover.degree}
          </div>
        </div>
      )}
    </div>
  );
}
