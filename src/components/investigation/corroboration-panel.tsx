"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Play, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type {
  CorroborationEvent,
  CorroborationResult,
  CorroborationState,
  CorroborationSummary,
  StageReport,
} from "@/lib/corroboration/types";

import { CorroborationStageList } from "./corroboration-stage-list";
import { CorroborationSummaryPanel } from "./corroboration-summary";
import { CorroborationErrorView } from "./corroboration-error";

type Phase = "idle" | "running" | "done" | "error";

const NETWORK_ERROR_RESULT: CorroborationResult = {
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
    message: "Could not reach the corroboration service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

/** Builds a summary straight from the streamed result, before the server reconciliation catches up. */
function summaryFromResult(result: CorroborationResult | null): CorroborationSummary | null {
  if (!result || !result.counts || !result.investigationId || !result.graphVersion) return null;
  return {
    investigationId: result.investigationId,
    graphVersion: result.graphVersion,
    analyzedAt: result.finishedAt || null,
    counts: result.counts,
  };
}

/**
 * The spatial/temporal corroboration workflow — the sixth real
 * investigation stage after topology analytics, mirroring
 * investigation/analytics-panel.tsx. Rendered only once analytics is
 * synthesized. Progress comes from the real newline-delimited event
 * stream of POST /api/corroboration. On success, calls
 * `onCorroborationStateChange` so the sidebar's Corroboration nav entry
 * enables immediately.
 */
export function CorroborationPanel({
  initialState,
  onCorroborationStateChange,
}: {
  initialState: CorroborationState;
  onCorroborationStateChange?: (state: CorroborationState) => void;
}) {
  const router = useRouter();
  const serverSummary = initialState.status === "synthesized" ? initialState.summary : null;

  const [phase, setPhase] = useState<Phase>(serverSummary ? "done" : "idle");
  const [reconciledSummary, setReconciledSummary] = useState<CorroborationSummary | null>(null);
  const [stages, setStages] = useState<StageReport[]>([]);
  const [persistProgress, setPersistProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<CorroborationResult | null>(null);
  const summary = serverSummary ?? reconciledSummary ?? summaryFromResult(result);
  const runningRef = useRef(false);

  const dispatch = useCallback(
    (event: CorroborationEvent) => {
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
          if (derived) onCorroborationStateChange?.({ status: "synthesized", summary: derived });
        }
      }
    },
    [router, onCorroborationStateChange],
  );

  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    void fetch("/api/corroboration", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CorroborationState>) : null))
      .then((state) => {
        if (!cancelled && state && state.status === "synthesized") {
          setReconciledSummary(state.summary);
          setPhase("done");
          onCorroborationStateChange?.(state);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase, onCorroborationStateChange]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setStages([]);
    setPersistProgress(null);
    setResult(null);
    try {
      const res = await fetch("/api/corroboration", { method: "POST" });
      if (!res.ok || !res.body) throw new Error("corroboration stream unavailable");

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
          if (line) dispatch(JSON.parse(line) as CorroborationEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as CorroborationEvent);
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
        <CorroborationErrorView error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <CorroborationStageList stages={result.stages} persistProgress={null} />
          </Card>
        )}
        <div>
          <Button onClick={start} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            Retry corroboration
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">Computing spatial/temporal corroboration…</span>
        </div>
        <CorroborationStageList stages={stages} persistProgress={persistProgress} />
      </Card>
    );
  }

  if (phase === "done" && summary) {
    const note =
      result?.status === "already_synthesized"
        ? "Corroboration already ran for this graph — no findings were changed."
        : result?.persisted
          ? `${result.persisted.findingsCreated} findings written, ${result.persisted.findingsSkipped} already present.`
          : undefined;
    return (
      <div className="flex flex-col gap-4">
        <CorroborationSummaryPanel summary={summary} note={note} />
        <div>
          <Button variant="outline" onClick={start} className="gap-2" data-testid="re-synthesize-corroboration">
            <RefreshCw className="size-4" aria-hidden />
            Re-run corroboration
          </Button>
        </div>
      </div>
    );
  }

  // idle — corroboration available, not yet run
  return (
    <Card className="gap-3">
      <div className="flex items-start gap-2.5">
        <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold" data-testid="corroboration-available">
            Corroborate spatially & temporally
          </span>
          <p className="text-xs text-muted-foreground">
            Corroboration compares persisted communication events and dated transactions to find where relevant
            entities were active, which activity shared a location or a{" "}
            <span className="font-medium text-foreground">30-minute</span> window, which entity pairs repeatedly
            overlapped, and which placements are physically impossible. Every result is a{" "}
            <span className="font-medium text-foreground">Corroborated Fact</span> or an{" "}
            <span className="font-medium text-foreground">Algorithmic Signal</span> — never an observed fact, never a
            claim of contact or causation.
          </p>
        </div>
      </div>
      <div>
        <Button onClick={start} className="gap-2" data-testid="start-corroboration-synthesis">
          <Play className="size-4" aria-hidden />
          Run Corroboration
        </Button>
      </div>
    </Card>
  );
}
