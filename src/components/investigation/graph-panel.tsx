"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Network, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  GraphEvent,
  GraphResult,
  GraphState,
  GraphSummary,
  StageReport,
} from "@/lib/graph/types";

import { GraphStageList } from "./graph-stage-list";
import { GraphSummaryPanel } from "./graph-summary";
import { GraphErrorView } from "./graph-error";

type Phase = "idle" | "running" | "done" | "error";

const NETWORK_ERROR_RESULT: GraphResult = {
  status: "failed",
  investigationId: null,
  counts: null,
  persisted: null,
  warnings: [],
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "load_resolved_entities",
    message: "Could not reach the graph synthesis service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

/** Builds a summary straight from the streamed result, before the server reconciliation catches up. */
function summaryFromResult(result: GraphResult | null): GraphSummary | null {
  if (!result || !result.counts || !result.investigationId) return null;
  const totalEdges = Object.values(result.counts.edgesByType).reduce((a, b) => a + b, 0);
  const totalNodes = Object.values(result.counts.nodesByKind).reduce((a, b) => a + b, 0);
  return {
    investigationId: result.investigationId,
    synthesizedAt: result.finishedAt || null,
    totalNodes,
    nodesByKind: result.counts.nodesByKind,
    totalEdges,
    edgesByType: result.counts.edgesByType,
    edgesByClassification: {},
  };
}

/**
 * The graph synthesis workflow — the fourth real investigation stage
 * after ingestion, extraction, and entity resolution, mirroring
 * investigation/resolution-panel.tsx. Rendered only once resolution is
 * done. Progress comes from the real newline-delimited event stream of
 * POST /api/graph. On success, calls `onGraphStateChange` so the
 * sidebar's Graph nav entry enables immediately.
 */
export function GraphPanel({
  initialState,
  onGraphStateChange,
}: {
  initialState: GraphState;
  onGraphStateChange?: (state: GraphState) => void;
}) {
  const router = useRouter();
  const serverSummary = initialState.status === "synthesized" ? initialState.summary : null;

  const [phase, setPhase] = useState<Phase>(serverSummary ? "done" : "idle");
  const [reconciledSummary, setReconciledSummary] = useState<GraphSummary | null>(null);
  const [stages, setStages] = useState<StageReport[]>([]);
  const [persistProgress, setPersistProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<GraphResult | null>(null);
  const summary = serverSummary ?? reconciledSummary ?? summaryFromResult(result);
  const runningRef = useRef(false);

  const dispatch = useCallback(
    (event: GraphEvent) => {
      if (event.type === "stage") {
        setStages((prev) => {
          const idx = prev.findIndex((s) => s.stage === event.report.stage);
          if (idx === -1) return [...prev, event.report];
          const next = [...prev];
          next[idx] = event.report;
          return next;
        });
      } else if (event.type === "persist_progress") {
        setPersistProgress({ label: event.label, done: event.done, total: event.total });
      } else if (event.type === "result") {
        setResult(event.result);
        if (event.result.status === "failed") {
          setPhase("error");
        } else {
          setPhase("done");
          router.refresh();
          const derived = summaryFromResult(event.result);
          if (derived) onGraphStateChange?.({ status: "synthesized", summary: derived });
        }
      }
    },
    [router, onGraphStateChange],
  );

  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    void fetch("/api/graph", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<GraphState>) : null))
      .then((state) => {
        if (!cancelled && state && state.status === "synthesized") {
          setReconciledSummary(state.summary);
          setPhase("done");
          onGraphStateChange?.(state);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, onGraphStateChange]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setStages([]);
    setPersistProgress(null);
    setResult(null);
    try {
      const res = await fetch("/api/graph", { method: "POST" });
      if (!res.ok || !res.body) throw new Error("graph synthesis stream unavailable");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline = buffer.indexOf("\n");
        while (newline >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) dispatch(JSON.parse(line) as GraphEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as GraphEvent);
    } catch {
      setResult(NETWORK_ERROR_RESULT);
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }, [dispatch]);

  // --- render ---------------------------------------------------------

  if (phase === "error" && result?.error) {
    return (
      <div className="flex flex-col gap-4">
        <GraphErrorView error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <GraphStageList stages={result.stages} persistProgress={null} />
          </Card>
        )}
        <div>
          <Button onClick={start} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            Retry graph synthesis
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Synthesizing graph…</span>
        </div>
        <GraphStageList stages={stages} persistProgress={persistProgress} />
      </Card>
    );
  }

  if (phase === "done" && summary) {
    const note =
      result?.status === "already_synthesized"
        ? "Graph synthesis already ran for this evidence — no rows were changed."
        : result?.persisted
          ? `${result.persisted.relationshipsCreated} relationships written, ${result.persisted.relationshipsSkipped} already present.`
          : undefined;
    return (
      <div className="flex flex-col gap-4">
        <GraphSummaryPanel summary={summary} note={note} />
        <div>
          <Button variant="outline" onClick={start} className="gap-2" data-testid="re-synthesize-graph">
            <RefreshCw className="size-4" aria-hidden />
            Re-run graph synthesis
          </Button>
        </div>
      </div>
    );
  }

  // idle — graph synthesis available, not yet run
  return (
    <Card className="gap-3">
      <div className="flex items-start gap-2.5">
        <Network className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" data-testid="graph-synthesis-available">
            Synthesize the investigative graph
          </span>
          <p className="text-xs text-muted-foreground">
            Graph synthesis maps every resolved entity and extracted fact into ownership,
            communication, financial, and co-location edges — never inventing a relationship
            unsupported by evidence, and never asserting a direct link where the evidence only
            supports an indirect one. Every edge carries full provenance back to its source.
          </p>
        </div>
      </div>
      <div>
        <Button onClick={start} className="gap-2" data-testid="start-graph-synthesis">
          <Play className="size-4" aria-hidden />
          Synthesize Graph
        </Button>
      </div>
    </Card>
  );
}
