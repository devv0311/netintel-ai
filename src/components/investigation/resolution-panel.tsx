"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ResolutionEvent,
  ResolutionResult,
  ResolutionState,
  ResolutionSummary,
  ResolvedEntitiesPage,
  StageReport,
} from "@/lib/resolution/types";
import type { GraphState } from "@/lib/graph/types";
import type { AnalyticsState } from "@/lib/analytics/types";

import { ResolutionStageList } from "./resolution-stage-list";
import { ResolutionSummaryPanel } from "./resolution-summary";
import { ResolutionErrorView } from "./resolution-error";
import { ResolutionEntities } from "./resolution-entities";
import { GraphPanel } from "./graph-panel";

type Phase = "idle" | "running" | "done" | "error";

const NETWORK_ERROR_RESULT: ResolutionResult = {
  status: "failed",
  investigationId: null,
  counts: null,
  persisted: null,
  warnings: [],
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "select_records",
    message:
      "Could not reach the resolution service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

/** Builds a summary straight from the streamed result, before the server reconciliation catches up. */
function summaryFromResult(result: ResolutionResult | null): ResolutionSummary | null {
  if (!result || !result.counts || !result.investigationId) return null;
  return {
    investigationId: result.investigationId,
    resolvedAt: result.finishedAt || null,
    totalEntities: Object.values(result.counts.entitiesByKind).reduce((a, b) => a + b, 0),
    entitiesByKind: result.counts.entitiesByKind,
    totalAliases: result.counts.aliasesCreated,
    totalDecisions: Object.values(result.counts.decisionsByType).reduce((a, b) => a + b, 0),
    decisionsByType: result.counts.decisionsByType,
    ambiguousDecisions: result.counts.ambiguousDecisions,
  };
}

/**
 * The entity resolution workflow — the third real investigation stage
 * after ingestion and extraction, mirroring investigation/extraction-panel.tsx.
 * Rendered only once extraction is done. Progress comes from the real
 * newline-delimited event stream of POST /api/resolution.
 */
export function ResolutionPanel({
  initialState,
  initialGraphState,
  initialAnalyticsState,
  onGraphStateChange,
  onAnalyticsStateChange,
}: {
  initialState: ResolutionState;
  initialGraphState: GraphState;
  initialAnalyticsState: AnalyticsState;
  onGraphStateChange?: (state: GraphState) => void;
  onAnalyticsStateChange?: (state: AnalyticsState) => void;
}) {
  const router = useRouter();
  const serverSummary = initialState.status === "resolved" ? initialState.summary : null;

  const [phase, setPhase] = useState<Phase>(serverSummary ? "done" : "idle");
  const [reconciledSummary, setReconciledSummary] = useState<ResolutionSummary | null>(null);
  const [stages, setStages] = useState<StageReport[]>([]);
  const [persistProgress, setPersistProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<ResolutionResult | null>(null);
  const summary = serverSummary ?? reconciledSummary ?? summaryFromResult(result);
  const [entitiesPage, setEntitiesPage] = useState<ResolvedEntitiesPage | null>(null);
  const runningRef = useRef(false);

  const dispatch = useCallback(
    (event: ResolutionEvent) => {
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
        }
      }
    },
    [router],
  );

  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    void fetch("/api/resolution", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ResolutionState>) : null))
      .then((state) => {
        if (!cancelled && state && state.status === "resolved") {
          setReconciledSummary(state.summary);
          setPhase("done");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase]);

  useEffect(() => {
    if (phase !== "done") return;
    let cancelled = false;
    void fetch("/api/resolution/entities?offset=0&limit=25", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ResolvedEntitiesPage>) : null))
      .then((page) => {
        if (!cancelled && page) setEntitiesPage(page);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, result]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setStages([]);
    setPersistProgress(null);
    setResult(null);
    try {
      const res = await fetch("/api/resolution", { method: "POST" });
      if (!res.ok || !res.body) throw new Error("resolution stream unavailable");

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
          if (line) dispatch(JSON.parse(line) as ResolutionEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as ResolutionEvent);
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
        <ResolutionErrorView error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <ResolutionStageList stages={result.stages} persistProgress={null} />
          </Card>
        )}
        <div>
          <Button onClick={start} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            Retry resolution
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Resolving entities…</span>
        </div>
        <ResolutionStageList stages={stages} persistProgress={persistProgress} />
      </Card>
    );
  }

  if (phase === "done" && summary) {
    const note =
      result?.status === "already_resolved"
        ? "Resolution already ran for this evidence — no records were changed."
        : result?.persisted
          ? `${result.persisted.entitiesCreated} entities, ${result.persisted.aliasesCreated} aliases, ${result.persisted.decisionsCreated} decisions written.`
          : undefined;
    return (
      <div className="flex flex-col gap-4">
        <ResolutionSummaryPanel summary={summary} note={note} />
        {entitiesPage && <ResolutionEntities initialPage={entitiesPage} />}
        <div>
          <Button variant="outline" onClick={start} className="gap-2" data-testid="re-resolve">
            <RefreshCw className="size-4" aria-hidden />
            Re-run resolution
          </Button>
        </div>
        <GraphPanel
          initialState={initialGraphState}
          initialAnalyticsState={initialAnalyticsState}
          onGraphStateChange={onGraphStateChange}
          onAnalyticsStateChange={onAnalyticsStateChange}
        />
      </div>
    );
  }

  // idle — resolution available, not yet run
  return (
    <Card className="gap-3">
      <div className="flex items-start gap-2.5">
        <Users className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" data-testid="resolution-available">
            Resolve entity identities
          </span>
          <p className="text-xs text-muted-foreground">
            Resolution reads every extracted fact and clusters mentions that share explicit
            identifier evidence (a name linked to the same phone/account/vehicle) or an
            unambiguous exact name match into canonical entities — recording every decision,
            confidence, and conflict. Names that match more than one identifier-anchored
            entity are deliberately left unmerged, never force-resolved.
          </p>
        </div>
      </div>
      <div>
        <Button onClick={start} className="gap-2" data-testid="start-resolution">
          <Play className="size-4" aria-hidden />
          Resolve Entities
        </Button>
      </div>
    </Card>
  );
}
