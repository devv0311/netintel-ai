"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FileText, Play, RefreshCw, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { DossierDetail, DossierEvent, DossierResult, DossierState, StageReport } from "@/lib/dossier/types";

import { DossierErrorView } from "./dossier-error";
import { DossierReport } from "./dossier-report";
import { DossierStageList } from "./dossier-stage-list";

/**
 * The Dossier screen (P5.9) — the investigator-facing report surface.
 *
 * Every state the brief requires has a distinct surface: unavailable
 * (upstream stages incomplete), ready-to-generate, generating (the real
 * eleven-stage stream), generated, stale (the graph moved on), and a
 * structured failure. Progress comes from the real newline-delimited
 * event stream of POST /api/dossier — nothing here is a simulated
 * animation.
 *
 * Reload preserves the report because the report is persisted, not held
 * in component state: the screen re-reads it from GET
 * /api/dossier/report on mount. Regeneration is idempotent, and the
 * screen says so explicitly rather than silently appearing to do
 * nothing.
 */

type Phase = "idle" | "running" | "done" | "error";

const NETWORK_ERROR_RESULT: DossierResult = {
  status: "failed",
  dossierId: null,
  reportVersion: null,
  investigationId: null,
  graphVersion: null,
  counts: null,
  persisted: null,
  warnings: [],
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "load_case_state",
    message: "Could not reach the dossier service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

export function DossierScreen({
  initialState,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
  onViewEvidence,
}: {
  initialState: DossierState;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
  onViewEvidence: () => void;
}) {
  const [state, setState] = useState<DossierState>(initialState);
  const [detail, setDetail] = useState<DossierDetail | null>(null);
  const [phase, setPhase] = useState<Phase>(
    initialState.status === "generated" || initialState.status === "stale" ? "done" : "idle",
  );
  const [stages, setStages] = useState<StageReport[]>([]);
  const [result, setResult] = useState<DossierResult | null>(null);
  const runningRef = useRef(false);

  /** Loads the persisted report — this is what makes a reload preserve it. */
  const loadDetail = useCallback(async () => {
    try {
      const res = await fetch("/api/dossier/report", { cache: "no-store" });
      if (!res.ok) return;
      setDetail((await res.json()) as DossierDetail);
    } catch {
      // Leave the previous detail in place; the state banner still renders.
    }
  }, []);

  // Reconcile against the authoritative server state on mount, so a
  // stale server snapshot (e.g. corroboration finished in another tab)
  // does not leave the Dossier looking unavailable — and so a reload
  // brings the persisted report straight back.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/dossier", { cache: "no-store" });
        if (!res.ok) return;
        const next = (await res.json()) as DossierState;
        if (cancelled) return;
        setState(next);
        if (next.status === "generated" || next.status === "stale") {
          setPhase("done");
          await loadDetail();
        }
      } catch {
        // Keep the server-rendered state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDetail]);

  const dispatch = useCallback((event: DossierEvent) => {
    if (event.type === "stage") {
      setStages((prev) => {
        const idx = prev.findIndex((s) => s.stage === event.report.stage);
        if (idx === -1) return [...prev, event.report];
        const next = [...prev];
        next[idx] = event.report;
        return next;
      });
    } else {
      setResult(event.result);
      setPhase(event.result.status === "failed" ? "error" : "done");
    }
  }, []);

  const generate = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setPhase("running");
    setStages([]);
    setResult(null);
    try {
      const res = await fetch("/api/dossier", { method: "POST" });
      if (!res.ok || !res.body) throw new Error("dossier stream unavailable");

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
          if (line) dispatch(JSON.parse(line) as DossierEvent);
          newline = buffer.indexOf("\n");
        }
      }
      const tail = buffer.trim();
      if (tail) dispatch(JSON.parse(tail) as DossierEvent);

      // Refresh both the state banner and the report itself from the
      // server, so what is shown is what was actually persisted.
      const stateRes = await fetch("/api/dossier", { cache: "no-store" });
      if (stateRes.ok) setState((await stateRes.json()) as DossierState);
      await loadDetail();
    } catch {
      setResult(NETWORK_ERROR_RESULT);
      setPhase("error");
    } finally {
      runningRef.current = false;
    }
  }, [dispatch, loadDetail]);

  // --- render ---------------------------------------------------------

  if (state.status === "not_available" && phase !== "running") {
    return (
      <Card
        className="mx-auto mt-8 max-w-md text-center text-sm text-muted-foreground"
        data-testid="dossier-unavailable"
      >
        {state.reason}
      </Card>
    );
  }

  if (phase === "error" && result?.error) {
    return (
      <div className="flex flex-col gap-4">
        <DossierErrorView error={result.error} />
        {result.stages.length > 0 && (
          <Card>
            <DossierStageList stages={result.stages} />
          </Card>
        )}
        <div>
          <Button onClick={generate} className="gap-2" data-testid="dossier-retry">
            <RefreshCw className="size-4" aria-hidden />
            Retry generation
          </Button>
        </div>
      </div>
    );
  }

  if (phase === "running") {
    return (
      <Card data-testid="dossier-running">
        <span className="text-sm font-semibold">Generating the case dossier…</span>
        <DossierStageList stages={stages} />
      </Card>
    );
  }

  if (phase === "done" && detail) {
    const note =
      result?.status === "already_generated"
        ? "An identical report for this case state already existed — it was reused and nothing was written. Generation is idempotent."
        : result?.persisted?.created === 1
          ? "Report written."
          : undefined;

    return (
      <div className="flex flex-col gap-4" data-testid="dossier-screen">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={generate} className="gap-2" data-testid="regenerate-dossier">
            <RefreshCw className="size-4" aria-hidden />
            Regenerate dossier
          </Button>
          {note && (
            <span className="text-xs text-muted-foreground" data-testid="dossier-generation-note">
              {note}
            </span>
          )}
        </div>

        {result && result.warnings.length > 0 && (
          <Card className="gap-1 text-xs text-muted-foreground" data-testid="dossier-warnings">
            <span className="font-medium text-foreground">Generation notes</span>
            <ul className="flex list-disc flex-col gap-0.5 pl-4">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </Card>
        )}

        <DossierReport
          detail={detail}
          onViewInGraph={onViewInGraph}
          onViewInAnalytics={onViewInAnalytics}
          onViewInCorroboration={onViewInCorroboration}
          onViewEvidence={onViewEvidence}
        />

        {result && result.stages.length > 0 && (
          <Card data-testid="dossier-completed-stages">
            <DossierStageList stages={result.stages} />
          </Card>
        )}
      </div>
    );
  }

  // idle — everything upstream is ready, no report generated yet
  const pendingCounts =
    state.status === "pending"
      ? `${state.investigationName} · graph version ${state.graphVersion}`
      : null;

  return (
    <Card className="mx-auto mt-8 max-w-xl gap-5" data-testid="dossier-idle">
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <FileText className="size-6" aria-hidden />
        </div>
        <span className="text-base font-semibold" data-testid="dossier-available">
          Generate the case dossier
        </span>
        <p className="text-sm text-muted-foreground">
          The dossier assembles what the pipeline has already established — the evidence inventory, the resolved
          entities, the graph relationships, the analytical signals, the spatial and temporal corroboration, the
          contradictions, and the items awaiting human verification — into one report. Every finding keeps the
          classification and confidence of the record it came from, and resolves to the persisted ids behind it.
        </p>
        {pendingCounts && (
          <span className="font-mono text-[10px] text-muted-foreground" data-testid="dossier-pending-context">
            {pendingCounts}
          </span>
        )}
      </div>
      <div className="flex items-start gap-2 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Synthetic data only. Generation is deterministic and idempotent, and never requires a live AI request — with
          no provider key the report is unchanged except that Copilot excerpts use deterministic wording, which the
          report states explicitly.
        </span>
      </div>
      <div className="flex justify-center">
        <Button onClick={generate} className="gap-2" data-testid="start-dossier-generation">
          <Play className="size-4" aria-hidden />
          Generate dossier
        </Button>
      </div>
      {state.status === "stale" && (
        <p className="text-center text-xs text-muted-foreground" data-testid="dossier-stale-hint">
          A report exists for graph version {state.summary.graphVersion}, which has been superseded by{" "}
          {state.currentGraphVersion}. It carries {formatCount(state.summary.counts.findings)} findings and is kept for
          audit; regenerate to describe the current graph.
        </p>
      )}
    </Card>
  );
}
