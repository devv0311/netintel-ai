"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  ExtractedFactsPage,
  ExtractionEvent,
  ExtractionResult,
  ExtractionState,
  ExtractionSummary,
  StageReport,
} from "@/lib/extraction/types";

import type { ResolutionState } from "@/lib/resolution/types";

import { ExtractionStageList } from "./extraction-stage-list";
import { ExtractionSummaryPanel } from "./extraction-summary";
import { ExtractionErrorView } from "./extraction-error";
import { ExtractionFacts } from "./extraction-facts";
import { ResolutionPanel } from "./resolution-panel";

type Phase = "idle" | "running" | "done" | "error";

/**
 * Immediately after a run completes, neither the server-rendered prop
 * nor the reconciliation fetch has caught up yet — only the streamed
 * `result` has. Build a summary straight from it (same shape the
 * ingestion workspace derives `counts` from `result?.counts`) so the
 * "done" view renders without waiting on router.refresh().
 */
function summaryFromResult(result: ExtractionResult | null): ExtractionSummary | null {
  if (!result || !result.counts || !result.investigationId) return null;
  const totalRecords = Object.values(result.counts.recordsByType).reduce((a, b) => a + b, 0);
  return {
    investigationId: result.investigationId,
    extractedAt: result.finishedAt || null,
    totalRecords,
    recordsByType: result.counts.recordsByType,
    evidenceItemsExtracted: result.counts.evidenceItemsExtracted,
    evidenceItemsTotal: result.counts.evidenceItemsConsidered,
  };
}

const NETWORK_ERROR_RESULT: ExtractionResult = {
  status: "failed",
  investigationId: null,
  counts: null,
  persisted: null,
  warnings: [],
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "select_evidence",
    message:
      "Could not reach the extraction service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

/**
 * The evidence extraction workflow — the second real investigation
 * stage after ingestion, mirroring investigation/workspace.tsx. Rendered
 * only once an investigation is loaded. Progress comes from the real
 * newline-delimited event stream of POST /api/extraction — nothing here
 * is a simulated animation.
 */
export function ExtractionPanel({
  initialState,
  initialResolutionState,
}: {
  initialState: ExtractionState;
  initialResolutionState: ResolutionState;
}) {
  const router = useRouter();
  const serverSummary = initialState.status === "extracted" ? initialState.summary : null;

  const [phase, setPhase] = useState<Phase>(serverSummary ? "done" : "idle");
  const [reconciledSummary, setReconciledSummary] = useState<ExtractionSummary | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const summary = serverSummary ?? reconciledSummary ?? summaryFromResult(result);
  const [stages, setStages] = useState<StageReport[]>([]);
  const [persistProgress, setPersistProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [factsPage, setFactsPage] = useState<ExtractedFactsPage | null>(null);
  const runningRef = useRef(false);

  const dispatch = useCallback(
    (event: ExtractionEvent) => {
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

  // Reconcile against the authoritative server state on mount — covers a
  // stale server-rendered "pending" snapshot (e.g. immediately after
  // extraction in another tab / a dev reload).
  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    void fetch("/api/extraction", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ExtractionState>) : null))
      .then((state) => {
        if (!cancelled && state && state.status === "extracted") {
          setReconciledSummary(state.summary);
          setPhase("done");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase]);

  // Fetch a representative facts page whenever extraction is (or becomes) done.
  useEffect(() => {
    if (phase !== "done") return;
    let cancelled = false;
    void fetch("/api/extraction/facts?offset=0&limit=25", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<ExtractedFactsPage>) : null))
      .then((page) => {
        if (!cancelled && page) setFactsPage(page);
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
      const res = await fetch("/api/extraction", { method: "POST" });
      if (!res.ok || !res.body) throw new Error("extraction stream unavailable");

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
          if (line) dispatch(JSON.parse(line) as ExtractionEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as ExtractionEvent);
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
        <ExtractionErrorView error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <ExtractionStageList stages={result.stages} persistProgress={null} />
          </Card>
        )}
        <div>
          <Button onClick={start} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            Retry extraction
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Extracting evidence…</span>
        </div>
        <ExtractionStageList stages={stages} persistProgress={persistProgress} />
      </Card>
    );
  }

  if (phase === "done" && summary) {
    const note =
      result?.status === "already_extracted"
        ? "Extraction already ran for this evidence — no records were changed."
        : result?.persisted
          ? `${result.persisted.created} extracted records written, ${result.persisted.skipped} already present.`
          : undefined;
    return (
      <div className="flex flex-col gap-4">
        <ExtractionSummaryPanel summary={summary} note={note} />
        {factsPage && <ExtractionFacts initialPage={factsPage} />}
        <div>
          <Button variant="outline" onClick={start} className="gap-2" data-testid="re-extract">
            <RefreshCw className="size-4" aria-hidden />
            Re-run extraction
          </Button>
        </div>
        <ResolutionPanel initialState={initialResolutionState} />
      </div>
    );
  }

  // idle — extraction available, not yet run
  return (
    <Card className="gap-3">
      <div className="flex items-start gap-2.5">
        <Sparkles className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" data-testid="extraction-available">
            Extract explicit facts from evidence
          </span>
          <p className="text-xs text-muted-foreground">
            Extraction reads every ingested evidence item and structures the facts it
            explicitly states — names, phone numbers, IMEIs, accounts, communication
            events, transactions, locations, and witness statements — each with full
            provenance. It performs no entity resolution, relationship inference, or
            investigative conclusions; every record is classified{" "}
            <span className="font-medium text-foreground">Observed Fact</span>.
          </p>
        </div>
      </div>
      <div>
        <Button onClick={start} className="gap-2" data-testid="start-extraction">
          <Play className="size-4" aria-hidden />
          Extract Evidence
        </Button>
      </div>
    </Card>
  );
}
