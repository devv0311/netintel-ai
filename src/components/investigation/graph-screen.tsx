"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { ChevronDown, ChevronUp, ShieldAlert } from "lucide-react";

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  EDGE_LABELS,
  EDGE_VAR,
  KIND_LABELS,
  KIND_VAR,
} from "@/lib/graph/tokens";
import { themeStore } from "@/lib/theme";
import { cn } from "@/lib/utils";
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

const NODE_KINDS = ["person", "organisation", "phone", "imei", "vehicle", "bank_account", "location"];
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
  const [legendOpen, setLegendOpen] = useState(false);
  // The canvas resolves its colors from CSS custom properties once and
  // caches them, so a theme change has to remount it to repaint.
  const theme = useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );
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
      <div className="flex shrink-0 items-center gap-2 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[11px] text-fg-muted">
        <ShieldAlert className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">
          Synthetic data only. Every node and edge below is derived from the fabricated Operation
          DarkNet Delhi corpus.
        </span>
      </div>

      {/* One toolbar row: pick a subject, choose the scope, reveal the key.
          These were three stacked bands that between them ate roughly a
          third of the screen before the canvas began. */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <label htmlFor="graph-node-picker" className="shrink-0 text-[11px] text-fg-muted">
            Jump to
          </label>
          <select
            id="graph-node-picker"
            data-testid="graph-node-picker"
            className="min-w-0 max-w-56 truncate rounded-md border border-border bg-surface-1 px-2 py-1 text-xs text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

        <Button size="sm" variant="outline" onClick={toggleFocusMode} data-testid="toggle-focus-mode">
          {focusMode ? "Show full graph" : "Focus on selection"}
        </Button>

        <button
          type="button"
          onClick={() => setLegendOpen((v) => !v)}
          aria-expanded={legendOpen}
          data-testid="graph-legend-toggle"
          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-fg-muted hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {legendOpen ? <ChevronUp className="size-3" aria-hidden /> : <ChevronDown className="size-3" aria-hidden />}
          Legend
        </button>

        <span className="ml-auto text-[11px] tabular-nums text-fg-faint" data-testid="graph-counts">
          {snapshot.nodes.length}/{snapshot.totalNodes} nodes · {snapshot.edges.length}/
          {snapshot.totalEdges} edges
          {snapshot.truncated ? " · truncated — focus a node or filter to narrow the view" : ""}
        </span>
      </div>

      {/* Filters read as toggles, not as nine identical primary buttons.
          A hidden facet is dimmed, dashed and struck through, so "what am I
          currently NOT seeing" is answerable at a glance. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5" data-testid="graph-filters">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">Kinds</span>
        {NODE_KINDS.map((k) => (
          <FilterChip
            key={k}
            label={KIND_LABELS[k] ?? k}
            swatch={`var(${KIND_VAR[k] ?? KIND_VAR.other})`}
            shape="dot"
            hidden={hiddenKinds.has(k)}
            onToggle={() => toggleHiddenKind(k)}
            testId={`graph-filter-kind-${k}`}
          />
        ))}
        <span className="ml-3 text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
          Relationships
        </span>
        {EDGE_TYPES.map((t) => (
          <FilterChip
            key={t}
            label={EDGE_LABELS[t] ?? t}
            swatch={`var(${EDGE_VAR[t] ?? EDGE_VAR.other})`}
            shape="line"
            hidden={hiddenTypes.has(t)}
            onToggle={() => toggleHiddenType(t)}
            testId={`graph-filter-type-${t}`}
          />
        ))}
      </div>

      {legendOpen && (
        <div className="shrink-0">
          <GraphLegend />
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-4">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="min-h-[22rem] flex-1">
            <GraphView
              key={theme}
              snapshot={snapshot}
              selectedNodeId={selectedNodeId}
              selectedEdgeId={selectedEdgeId}
              hiddenKinds={hiddenKinds}
              hiddenTypes={hiddenTypes}
              onSelectNode={onCanvasSelectNode}
              onSelectEdge={onCanvasSelectEdge}
            />
          </div>
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

/**
 * One node-kind / relationship-type toggle. Carries the same `--kind-*` /
 * `--edge-*` swatch the canvas paints with, so the control and the
 * picture cannot drift apart, and states the toggle's effect through
 * `aria-pressed` rather than through colour alone.
 */
function FilterChip({
  label,
  swatch,
  shape,
  hidden,
  onToggle,
  testId,
}: {
  label: string;
  swatch: string;
  shape: "dot" | "line";
  hidden: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!hidden}
      data-testid={testId}
      title={hidden ? `Show ${label}` : `Hide ${label}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        hidden
          ? "border-dashed border-border text-fg-faint line-through"
          : "border-border-strong bg-surface-2 text-fg hover:bg-surface-3",
      )}
    >
      <span
        className={cn("shrink-0", shape === "dot" ? "size-2 rounded-full" : "h-0.5 w-3.5")}
        style={{ background: hidden ? "var(--fg-faint)" : swatch, opacity: hidden ? 0.5 : 1 }}
        aria-hidden
      />
      {label}
    </button>
  );
}
