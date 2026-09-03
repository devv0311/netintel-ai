"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { GraphSnapshot, GraphState } from "@/lib/graph/types";

import { Inspector } from "./inspector/inspector";
import type { InspectorTarget } from "./inspector/types";
import { GraphLegend } from "./graph-legend";

/**
 * sigma.js touches browser-only globals (e.g. WebGL2RenderingContext) at
 * module-evaluation time, which throws during Next.js's server render of
 * this "use client" tree — load it client-only, never during SSR.
 */
const GraphView = dynamic(() => import("./graph-view").then((m) => m.GraphView), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground">
      Loading graph canvas…
    </div>
  ),
});

const NODE_KINDS = ["person", "phone", "imei", "vehicle", "bank_account", "location"];
const EDGE_TYPES = ["ownership", "communication", "financial", "co_location", "family", "associate", "other"];

/**
 * The investigative graph screen (P5.5): a bounded sigma.js
 * visualization backed by GET /api/graph/snapshot, with node/edge
 * selection, kind/type filtering, and a focus-on-selection neighborhood
 * view. Selecting anything opens the shared Inspector (M10.3); the
 * selected entity is the shell's persistent focused entity, so it
 * survives navigation to Analytics and Corroboration.
 *
 * Every rendered node/edge is real, persisted graph data — never
 * decorative or fabricated.
 */
export function GraphScreen({
  initialState,
  focusEntityId,
  onFocusEntity,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
}: {
  initialState: GraphState;
  /** The shell's persistent focused entity — pre-selects and focuses it on mount and whenever it changes. */
  focusEntityId: string | null;
  onFocusEntity: (entityId: string | null) => void;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<GraphSnapshot | null>(null);
  const [target, setTarget] = useState<InspectorTarget | null>(
    focusEntityId ? { kind: "entity", id: focusEntityId } : null,
  );
  const [focusMode, setFocusMode] = useState(Boolean(focusEntityId));

  // Sync the Inspector to the shell's focused entity when it changes from
  // another surface (render-phase prop reconciliation, not an effect).
  const [syncedFocus, setSyncedFocus] = useState(focusEntityId);
  if (focusEntityId !== syncedFocus) {
    setSyncedFocus(focusEntityId);
    if (focusEntityId) setTarget({ kind: "entity", id: focusEntityId });
  }
  const [hiddenKinds, setHiddenKinds] = useState<Set<string>>(new Set());
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());

  const selectedNodeId = target?.kind === "entity" ? target.id : null;
  const selectedEdgeId = target?.kind === "relationship" ? target.id : null;

  const load = useCallback(async (focus?: string) => {
    const url = focus ? `/api/graph/snapshot?focus=${encodeURIComponent(focus)}` : "/api/graph/snapshot";
    const res = await fetch(url, { cache: "no-store" });
    if (res.ok) setSnapshot((await res.json()) as GraphSnapshot);
  }, []);

  useEffect(() => {
    if (initialState.status !== "synthesized") return;
    let cancelled = false;
    const url = focusEntityId
      ? `/api/graph/snapshot?focus=${encodeURIComponent(focusEntityId)}`
      : "/api/graph/snapshot";
    fetch(url, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<GraphSnapshot>) : null))
      .then((data) => {
        if (!cancelled && data) setSnapshot(data);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialState]);

  // When the focused entity changes and the graph is in focus mode, pull
  // the snapshot centred on it (state is set only in the fetch callback).
  useEffect(() => {
    if (!focusEntityId || !focusMode) return;
    let cancelled = false;
    fetch(`/api/graph/snapshot?focus=${encodeURIComponent(focusEntityId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<GraphSnapshot>) : null))
      .then((data) => {
        if (!cancelled && data) setSnapshot(data);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusEntityId]);

  const selectEntity = useCallback(
    (id: string | null) => {
      setTarget(id ? { kind: "entity", id } : null);
      onFocusEntity(id);
      if (focusMode && id) void load(id);
    },
    [focusMode, load, onFocusEntity],
  );

  const selectRelationship = useCallback((id: string) => {
    setTarget({ kind: "relationship", id });
  }, []);

  // Canvas selection: a real id selects; a background click drops only the
  // local selection and leaves the shell's persistent focus alone.
  const onCanvasSelectNode = useCallback(
    (id: string | null) => {
      if (id) selectEntity(id);
      else setTarget(null);
    },
    [selectEntity],
  );

  const onCanvasSelectEdge = useCallback((id: string | null) => {
    setTarget(id ? { kind: "relationship", id } : null);
  }, []);

  const clearInspector = useCallback(() => {
    setTarget(null);
    onFocusEntity(null);
  }, [onFocusEntity]);

  const toggleFocusMode = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev;
      void load(next ? (selectedNodeId ?? undefined) : undefined);
      return next;
    });
  }, [load, selectedNodeId]);

  const toggleHiddenKind = useCallback((kind: string) => {
    setHiddenKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }, []);

  const toggleHiddenType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  if (initialState.status !== "synthesized") {
    return (
      <Card className="mx-auto mt-8 max-w-md text-center text-sm text-muted-foreground" data-testid="graph-unavailable">
        Graph synthesis has not been run yet. Return to Evidence and synthesize the graph once
        entity resolution is complete.
      </Card>
    );
  }

  if (!snapshot) {
    return <Card data-testid="graph-loading">Loading graph…</Card>;
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-testid="graph-screen">
      <div className="flex shrink-0 items-start gap-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>Synthetic data only. Every node and edge below is derived from the fabricated Operation DarkNet Delhi corpus.</span>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs" data-testid="graph-filters">
        <span className="font-medium">Node kinds:</span>
        {NODE_KINDS.map((k) => (
          <Badge
            key={k}
            variant={hiddenKinds.has(k) ? "outline" : "accent"}
            className="cursor-pointer"
            onClick={() => toggleHiddenKind(k)}
            data-testid={`graph-filter-kind-${k}`}
          >
            {k}
          </Badge>
        ))}
        <span className="ml-4 font-medium">Edge types:</span>
        {EDGE_TYPES.map((t) => (
          <Badge
            key={t}
            variant={hiddenTypes.has(t) ? "outline" : "accent"}
            className="cursor-pointer"
            onClick={() => toggleHiddenType(t)}
            data-testid={`graph-filter-type-${t}`}
          >
            {t}
          </Badge>
        ))}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={toggleFocusMode}
          data-testid="toggle-focus-mode"
        >
          {focusMode ? "Show full graph" : "Focus on selection"}
        </Button>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs">
        <label htmlFor="graph-node-picker" className="font-medium">
          Jump to entity:
        </label>
        <select
          id="graph-node-picker"
          data-testid="graph-node-picker"
          className="rounded-md border border-border bg-card px-2 py-1"
          value={selectedNodeId ?? ""}
          onChange={(e) => {
            if (e.target.value) selectEntity(e.target.value);
          }}
        >
          <option value="">Select a node…</option>
          {[...snapshot.nodes]
            .sort((a, b) => a.label.localeCompare(b.label))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} ({n.kind})
              </option>
            ))}
        </select>
      </div>

      <div className="shrink-0">
        <GraphLegend />
      </div>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1">
            <GraphView
              snapshot={snapshot}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              hiddenKinds={hiddenKinds}
              hiddenTypes={hiddenTypes}
              onSelectNode={onCanvasSelectNode}
              onSelectEdge={onCanvasSelectEdge}
            />
          </div>
          <p className="mt-2 shrink-0 text-xs text-muted-foreground" data-testid="graph-counts">
            Showing {snapshot.nodes.length} of {snapshot.totalNodes} nodes, {snapshot.edges.length} of{" "}
            {snapshot.totalEdges} edges
            {snapshot.truncated ? " (truncated — focus a node or filter to narrow the view)" : ""}.
          </p>
        </div>
        <Inspector
          target={target}
          context="graph"
          nav={{
            viewInGraph: onViewInGraph,
            viewInAnalytics: onViewInAnalytics,
            viewInCorroboration: onViewInCorroboration,
          }}
          onClear={clearInspector}
          onSelectEntity={selectEntity}
          onSelectRelationship={selectRelationship}
        />
      </div>
    </div>
  );
}
