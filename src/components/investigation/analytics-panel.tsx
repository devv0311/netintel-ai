"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Play, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  AnalyticsEvent,
  AnalyticsResult,
  AnalyticsState,
  AnalyticsSummary,
  StageReport,
} from "@/lib/analytics/types";

import type { CorroborationState } from "@/lib/corroboration/types";

import { AnalyticsStageList } from "./analytics-stage-list";
import { AnalyticsSummaryPanel } from "./analytics-summary";
import { AnalyticsErrorView } from "./analytics-error";
import { CorroborationPanel } from "./corroboration-panel";

type Phase = "idle" | "running" | "done" | "error";

const NETWORK_ERROR_RESULT: AnalyticsResult = {
  status: "failed",
  investigationId: null,
  graphVersion: null,
  counts: null,
  persisted: null,
  warnings: [],
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "load_graph_state",
    message: "Could not reach the analytics service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

/** Builds a summary straight from the streamed result, before the server reconciliation catches up. */
function summaryFromResult(result: AnalyticsResult | null): AnalyticsSummary | null {
  if (!result || !result.counts || !result.investigationId || !result.graphVersion) return null;
  return {
    investigationId: result.investigationId,
    graphVersion: result.graphVersion,
    analyzedAt: result.finishedAt || null,
    counts: result.counts,
  };
}

/**
 * The topology analytics workflow — the fifth real investigation stage
 * after graph synthesis, mirroring investigation/graph-panel.tsx.
 * Rendered only once the graph is synthesized. Progress comes from the
 * real newline-delimited event stream of POST /api/analytics. On
 * success, calls `onAnalyticsStateChange` so the sidebar's Analytics
 * nav entry enables immediately.
 */
export function AnalyticsPanel({
  initialState,
  initialCorroborationState,
  onAnalyticsStateChange,
  onCorroborationStateChange,
}: {
  initialState: AnalyticsState;
  initialCorroborationState: CorroborationState;
  onAnalyticsStateChange?: (state: AnalyticsState) => void;
  onCorroborationStateChange?: (state: CorroborationState) => void;
}) {
  const router = useRouter();
  const serverSummary = initialState.status === "synthesized" ? initialState.summary : null;

  const [phase, setPhase] = useState<Phase>(serverSummary ? "done" : "idle");
  const [reconciledSummary, setReconciledSummary] = useState<AnalyticsSummary | null>(null);
  const [stages, setStages] = useState<StageReport[]>([]);
  const [persistProgress, setPersistProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<AnalyticsResult | null>(null);
  const summary = serverSummary ?? reconciledSummary ?? summaryFromResult(result);
  const runningRef = useRef(false);

  const dispatch = useCallback(
    (event: AnalyticsEvent) => {
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
          if (derived) onAnalyticsStateChange?.({ status: "synthesized", summary: derived });
        }
      }
    },
    [router, onAnalyticsStateChange],
  );

  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    void fetch("/api/analytics", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<AnalyticsState>) : null))
      .then((state) => {
        if (!cancelled && state && state.status === "synthesized") {
          setReconciledSummary(state.summary);
          setPhase("done");
          onAnalyticsStateChange?.(state);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, onAnalyticsStateChange]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setStages([]);
    setPersistProgress(null);
    setResult(null);
    try {
      const res = await fetch("/api/analytics", { method: "POST" });
      if (!res.ok || !res.body) throw new Error("analytics stream unavailable");

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
          if (line) dispatch(JSON.parse(line) as AnalyticsEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as AnalyticsEvent);
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
        <AnalyticsErrorView error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <AnalyticsStageList stages={result.stages} persistProgress={null} />
          </Card>
        )}
        <div>
          <Button onClick={start} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            Retry analytics
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Computing topology analytics…</span>
        </div>
        <AnalyticsStageList stages={stages} persistProgress={persistProgress} />
      </Card>
    );
  }

  if (phase === "done" && summary) {
    const note =
      result?.status === "already_synthesized"
        ? "Analytics already ran for this graph — no signals were changed."
        : result?.persisted
          ? `${result.persisted.signalsCreated} signals written, ${result.persisted.signalsSkipped} already present.`
          : undefined;
    return (
      <div className="flex flex-col gap-4">
        <AnalyticsSummaryPanel summary={summary} note={note} />
        <div>
          <Button variant="outline" onClick={start} className="gap-2" data-testid="re-synthesize-analytics">
            <RefreshCw className="size-4" aria-hidden />
            Re-run analytics
          </Button>
        </div>
        <CorroborationPanel
          initialState={initialCorroborationState}
          onCorroborationStateChange={onCorroborationStateChange}
        />
      </div>
    );
  }

  // idle — analytics available, not yet run
  return (
    <Card className="gap-3">
      <div className="flex items-start gap-2.5">
        <BarChart3 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" data-testid="analytics-available">
            Compute topology analytics
          </span>
          <p className="text-xs text-muted-foreground">
            Analytics computes deterministic structural signals over the synthesized graph — degree and
            betweenness centrality, bridge/intermediary detection, community clustering, and a combined
            investigative-prominence ranking. Every result is an{" "}
            <span className="font-medium text-foreground">Algorithmic Signal</span>: a description of network
            structure, never a claim of involvement.
          </p>
        </div>
      </div>
      <div>
        <Button onClick={start} className="gap-2" data-testid="start-analytics-synthesis">
          <Play className="size-4" aria-hidden />
          Run Analytics
        </Button>
      </div>
    </Card>
  );
}
