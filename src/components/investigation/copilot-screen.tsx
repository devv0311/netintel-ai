"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CornerDownLeft, RotateCcw, ShieldAlert, Terminal } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { CopilotEvent, CopilotResult, CopilotState, StageReport } from "@/lib/copilot/types";

import { CopilotAnswer } from "./copilot-answer";
import { CopilotErrorView } from "./copilot-error";
import { CopilotStageList } from "./copilot-stage-list";

/**
 * The Investigation Copilot screen (P5.8) — an investigation command
 * interface, not a chat window. The investigator states a question
 * against the case; the case answers with cited, classified claims.
 *
 * Every state the brief requires has a distinct surface here: initial,
 * suggested questions, loading (the real nine-stage stream), a grounded
 * answer, provenance expansion, navigation into graph / analytics /
 * corroboration, insufficient evidence, ambiguity, contradiction, and a
 * model/API error notice. Progress comes from the real
 * newline-delimited event stream of POST /api/copilot — nothing here is
 * a simulated animation.
 */

type Phase = "idle" | "running" | "answered" | "error";

const NETWORK_ERROR_RESULT: CopilotResult = {
  status: "failed",
  question: "",
  response: null,
  modelError: null,
  warnings: [],
  stages: [],
  error: {
    code: "INTERNAL_ERROR",
    stage: "parse_question",
    message: "Could not reach the Copilot service. Check that the app is running and try again.",
  },
  startedAt: "",
  finishedAt: "",
};

export function CopilotScreen({
  initialState,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
}: {
  initialState: CopilotState;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
}) {
  const [state, setState] = useState<CopilotState>(initialState);
  const [question, setQuestion] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [stages, setStages] = useState<StageReport[]>([]);
  const [result, setResult] = useState<CopilotResult | null>(null);
  const runningRef = useRef(false);

  // Reconcile against the authoritative server state on mount, so a
  // stale server snapshot (e.g. corroboration finished in another tab)
  // does not leave the Copilot looking unavailable.
  useEffect(() => {
    if (initialState.status === "ready") return;
    let cancelled = false;
    void fetch("/api/copilot", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<CopilotState>) : null))
      .then((next) => {
        if (!cancelled && next) setState(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [initialState]);

  const dispatch = useCallback((event: CopilotEvent) => {
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
      setPhase(event.result.status === "failed" ? "error" : "answered");
    }
  }, []);

  const ask = useCallback(
    async (asked: string) => {
      const text = asked.trim();
      if (!text || runningRef.current) return;
      runningRef.current = true;
      setQuestion(text);
      setPhase("running");
      setStages([]);
      setResult(null);
      try {
        const res = await fetch("/api/copilot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: text }),
        });
        if (!res.ok || !res.body) throw new Error("copilot stream unavailable");

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
            if (line) dispatch(JSON.parse(line) as CopilotEvent);
            newline = buffer.indexOf("\n");
          }
        }
        const tail = buffer.trim();
        if (tail) dispatch(JSON.parse(tail) as CopilotEvent);
      } catch {
        setResult({ ...NETWORK_ERROR_RESULT, question: text });
        setPhase("error");
      } finally {
        runningRef.current = false;
      }
    },
    [dispatch],
  );

  if (state.status !== "ready") {
    return (
      <Card className="mx-auto mt-8 max-w-md text-center text-sm text-muted-foreground" data-testid="copilot-unavailable">
        {state.status === "not_available"
          ? state.reason
          : "The Investigation Copilot is not available for the current investigation."}
      </Card>
    );
  }

  const { summary } = state;

  return (
    <div className="flex flex-col gap-4" data-testid="copilot-screen">
      <div className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Synthetic data only. The Copilot answers <strong>only</strong> from this case&apos;s persisted evidence and
          derived intelligence, and every claim it makes carries its own evidence classification and citations. It
          reports insufficient evidence rather than guessing, exposes conflicts rather than resolving them, and never
          treats a shared location or time window as contact between people.
        </span>
      </div>

      {/* The command bar. */}
      <Card className="gap-3">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Terminal className="size-3.5 shrink-0" aria-hidden />
          <span className="font-medium uppercase tracking-wide">Ask the case</span>
          <span className="ml-auto font-mono text-[10px]">
            {formatCount(summary.counts.evidenceItems)} evidence · {formatCount(summary.counts.entities)} entities ·{" "}
            {formatCount(summary.counts.relationships)} edges · {formatCount(summary.counts.analyticalSignals)} signals ·{" "}
            {formatCount(summary.counts.corroborationFindings)} findings
          </span>
        </div>
        <form
          className="flex items-stretch gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void ask(question);
          }}
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Who are the primary suspects, and what aliases do they use?"
            aria-label="Investigative question"
            data-testid="copilot-input"
            maxLength={500}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" className="gap-2 self-stretch" disabled={phase === "running"} data-testid="copilot-ask">
            <CornerDownLeft className="size-4" aria-hidden />
            Ask
          </Button>
        </form>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
          <Badge variant="outline">{summary.model}</Badge>
          <Badge variant="outline">{summary.promptVersion}</Badge>
          <Badge variant="outline">{summary.schemaVersion}</Badge>
          <span data-testid="copilot-model-configured">
            {summary.modelConfigured
              ? "AI narration enabled — wording is cached and guardrail-checked."
              : "No AI provider key configured — answers use the deterministic narration of the same grounded evidence."}
          </span>
        </div>
      </Card>

      {/* Suggested questions — the case's own canonical question set. */}
      <Card className="gap-2" data-testid="copilot-suggestions">
        <span className="text-xs font-medium">Suggested lines of enquiry</span>
        <div className="flex flex-col gap-1">
          {summary.suggestions.map((s) => (
            <button
              key={s.id}
              type="button"
              data-testid="copilot-suggestion"
              data-suggestion-id={s.id}
              disabled={phase === "running"}
              onClick={() => void ask(s.question)}
              className="flex flex-col rounded border border-border px-2 py-1.5 text-left hover:bg-muted disabled:opacity-60"
            >
              <span className="text-xs text-foreground">{s.question}</span>
              <span className="text-[10px] text-muted-foreground">{s.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      {phase === "idle" && (
        <Card className="text-xs text-muted-foreground" data-testid="copilot-idle">
          Ask a question above, or pick one of the suggested lines of enquiry. Every answer arrives with its evidence
          classification, its confidence, the exact records it rests on, and a route into the graph, analytics, and
          corroboration views.
        </Card>
      )}

      {phase === "running" && (
        <Card data-testid="copilot-running">
          <span className="text-sm font-semibold">Answering “{question}”…</span>
          <CopilotStageList stages={stages} />
        </Card>
      )}

      {phase === "error" && result?.error && (
        <div className="flex flex-col gap-3">
          <CopilotErrorView error={result.error} />
          {result.stages.length > 0 && (
            <Card>
              <CopilotStageList stages={result.stages} />
            </Card>
          )}
          <div>
            <Button variant="outline" className="gap-2" onClick={() => void ask(result.question || question)} data-testid="copilot-retry">
              <RotateCcw className="size-4" aria-hidden />
              Ask again
            </Button>
          </div>
        </div>
      )}

      {phase === "answered" && result?.response && (
        <>
          <CopilotAnswer
            response={result.response}
            modelError={result.modelError}
            onViewInGraph={onViewInGraph}
            onViewInAnalytics={onViewInAnalytics}
            onViewInCorroboration={onViewInCorroboration}
          />
          {result.warnings.length > 0 && (
            <Card className="gap-1 text-xs text-muted-foreground" data-testid="copilot-warnings">
              <span className="font-medium text-foreground">Retrieval notes</span>
              <ul className="flex list-disc flex-col gap-0.5 pl-4">
                {result.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </Card>
          )}
          <Card data-testid="copilot-completed-stages">
            <CopilotStageList stages={result.stages} />
          </Card>
        </>
      )}
    </div>
  );
}
