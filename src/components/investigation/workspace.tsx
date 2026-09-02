"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Database, Play, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { Card } from "@/components/ui/card";
import {
  type EvidenceCounts,
  type IngestionEvent,
  type IngestionResult,
  type InvestigationState,
  type InvestigationSummary,
  type StageReport,
} from "@/lib/ingestion/types";
import type { ExtractionState } from "@/lib/extraction/types";

import { StageList } from "./stage-list";
import { SummaryPanel } from "./summary-panel";
import { IngestError } from "./ingest-error";
import { ExtractionPanel } from "./extraction-panel";

type Phase = "idle" | "running" | "done" | "error";

const NETWORK_ERROR_RESULT: IngestionResult = {
  status: "failed",
  corpus: null,
  investigationId: null,
  counts: null,
  persisted: null,
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "input",
    message:
      "Could not reach the ingestion service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

/**
 * The evidence ingestion workspace. Server state (`initialState`) is
 * either `empty` or `loaded`; the transient run phase (`idle` →
 * `running` → `done`/`error`) is local. Progress comes from the real
 * newline-delimited event stream of POST /api/ingestion — nothing here
 * is a simulated animation.
 */
export function InvestigationWorkspace({
  initialState,
  initialExtractionState,
}: {
  initialState: InvestigationState;
  initialExtractionState: ExtractionState;
}) {
  const router = useRouter();
  const serverSummary =
    initialState.status === "loaded" ? initialState.summary : null;

  const [phase, setPhase] = useState<Phase>(
    initialState.status === "loaded" ? "done" : "idle",
  );
  const [reconciledSummary, setReconciledSummary] =
    useState<InvestigationSummary | null>(null);
  const loadedSummary = serverSummary ?? reconciledSummary;
  const [stages, setStages] = useState<StageReport[]>([]);
  const [persistProgress, setPersistProgress] = useState<{
    label: string;
    done: number;
    total: number;
  } | null>(null);
  const [result, setResult] = useState<IngestionResult | null>(null);
  const runningRef = useRef(false);

  const dispatch = useCallback(
    (event: IngestionEvent) => {
      if (event.type === "stage") {
        setStages((prev) => {
          const idx = prev.findIndex((s) => s.stage === event.report.stage);
          if (idx === -1) return [...prev, event.report];
          const next = [...prev];
          next[idx] = event.report;
          return next;
        });
      } else if (event.type === "persist_progress") {
        setPersistProgress({
          label: event.label,
          done: event.done,
          total: event.total,
        });
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

  // Reconcile against the authoritative server state on mount. Covers the
  // case where the server component rendered a stale "empty" snapshot
  // (e.g. immediately after an ingestion in another tab / a dev reload).
  useEffect(() => {
    if (phase !== "idle") return;
    let cancelled = false;
    void fetch("/api/ingestion", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<InvestigationState>) : null))
      .then((state) => {
        if (!cancelled && state && state.status === "loaded") {
          setReconciledSummary(state.summary);
          setPhase("done");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [phase]);

  const start = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setStages([]);
    setPersistProgress(null);
    setResult(null);
    try {
      const res = await fetch("/api/ingestion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: { kind: "builtin-corpus" } }),
      });
      if (!res.ok || !res.body) throw new Error("ingestion stream unavailable");

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
          if (line) dispatch(JSON.parse(line) as IngestionEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as IngestionEvent);
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
        <IngestError error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <StageList stages={result.stages} persistProgress={null} />
          </Card>
        )}
        <div>
          <Button onClick={start} className="gap-2">
            <RefreshCw className="size-4" aria-hidden />
            Retry ingestion
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card>
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">
            Ingesting Operation DarkNet Delhi…
          </span>
        </div>
        <StageList stages={stages} persistProgress={persistProgress} />
      </Card>
    );
  }

  if (phase === "done") {
    const counts: EvidenceCounts | null =
      loadedSummary?.counts ?? result?.counts ?? null;
    if (counts) {
      const note =
        result?.status === "already_ingested"
          ? "This corpus was already ingested — no records were changed."
          : result?.persisted
            ? `${formatCount(result.persisted.created)} records written, ${formatCount(result.persisted.skipped)} already present.`
            : undefined;
      return (
        <div className="flex flex-col gap-4">
          <SummaryPanel
            investigationName={
              loadedSummary?.name ?? "Operation DarkNet Delhi (synthetic)"
            }
            corpusName={loadedSummary?.corpusName ?? result?.corpus?.name ?? "operation-darknet-delhi"}
            corpusVersion={
              loadedSummary?.corpusVersion ?? result?.corpus?.version ?? "1.0.0"
            }
            ingestedAt={loadedSummary?.ingestedAt ?? null}
            counts={counts}
            note={note}
          />
          <div>
            <Button
              variant="outline"
              onClick={start}
              className="gap-2"
              data-testid="reingest"
            >
              <RefreshCw className="size-4" aria-hidden />
              Re-run ingestion
            </Button>
          </div>
          <ExtractionPanel initialState={initialExtractionState} />
        </div>
      );
    }
  }

  // idle
  return (
    <Card className="mx-auto mt-8 max-w-lg gap-5">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Database className="size-6" aria-hidden />
        </div>
        <span className="text-base font-semibold" data-testid="no-investigation">
          No investigation loaded
        </span>
        <p className="text-sm text-muted-foreground">
          Load the <span className="font-medium text-foreground">Operation DarkNet
          Delhi</span> synthetic evidence corpus (v1.0.0) — 1,820 evidence items
          across 6 sources — to begin an investigation. Ingestion validates,
          normalizes, and persists the corpus with full provenance; it is
          deterministic and idempotent.
        </p>
      </div>
      <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Synthetic data only. This corpus is entirely fabricated — no real
          person, phone number, account, device, address, or case is
          represented.
        </span>
      </div>
      <div className="flex justify-center">
        <Button onClick={start} className="gap-2" data-testid="start-ingestion">
          <Play className="size-4" aria-hidden />
          Start ingestion
        </Button>
      </div>
    </Card>
  );
}
