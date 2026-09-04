"use client";

import { cn } from "@/lib/utils";
import type { NavView } from "./sidebar";

/**
 * The intended demonstration flow, per README.md / docs/requirements.md §4.
 * A status display only: a stage lights up as complete when it is
 * genuinely done (passed in via `completed`) — never a timed animation
 * and never fabricated progress.
 *
 * As of M10.2 this is the pipeline meter that lives in the command bar
 * (shell/header.tsx): a compact horizontal strip carrying every stage
 * label as text plus a lit/unlit dot, and a `done / total` count. It
 * keeps the `Investigation pipeline status` accessible name the e2e
 * suite locates it by.
 *
 * P6.23: a COMPLETED stage is also a navigation target, because the strip
 * already showed the investigator where they were in the workflow and
 * then made them find the matching rail entry themselves. An incomplete
 * stage stays inert — it would have nowhere to go.
 */
const JOURNEY_STAGES = [
  "Upload Evidence",
  "Ingestion",
  "Extraction",
  "Entity Resolution",
  "Graph Synthesis",
  "Analytics",
  "Corroboration",
  "Copilot",
  "Dossier / Report",
] as const;

/** Which screen actually shows each stage's output. */
const STAGE_VIEW: Record<(typeof JOURNEY_STAGES)[number], NavView> = {
  "Upload Evidence": "evidence",
  Ingestion: "evidence",
  Extraction: "evidence",
  "Entity Resolution": "evidence",
  "Graph Synthesis": "graph",
  Analytics: "analytics",
  Corroboration: "corroboration",
  Copilot: "copilot",
  "Dossier / Report": "dossier",
};

export function PipelineStatus({
  completed = [],
  onNavigate,
}: {
  completed?: readonly string[];
  onNavigate?: (view: NavView) => void;
}) {
  const done = new Set(completed);
  const doneCount = JOURNEY_STAGES.filter((s) => done.has(s)).length;

  return (
    <div
      className="flex items-center gap-x-1.5 gap-y-1 overflow-x-auto text-[11px] [scrollbar-width:none] lg:flex-wrap lg:overflow-visible [&::-webkit-scrollbar]:hidden"
      aria-label="Investigation pipeline status"
    >
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wide text-fg-faint">
        pipeline {doneCount}/{JOURNEY_STAGES.length}
      </span>
      {JOURNEY_STAGES.map((stage, i) => {
        const isDone = done.has(stage);
        const navigable = isDone && Boolean(onNavigate);
        const Tag = navigable ? "button" : "span";
        return (
          <div key={stage} className="flex shrink-0 items-center gap-1.5">
            <Tag
              {...(navigable
                ? {
                    type: "button" as const,
                    onClick: () => onNavigate?.(STAGE_VIEW[stage]),
                    title: `Open ${stage}`,
                  }
                : {})}
              className={cn(
                "flex items-center gap-1 rounded px-1 py-0.5",
                navigable &&
                  "hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <span
                className={cn("size-1.5 rounded-full", isDone ? "bg-accent" : "bg-fg-faint/40")}
                aria-hidden
              />
              <span className={cn(isDone ? "font-medium text-fg" : "text-fg-faint")}>{stage}</span>
            </Tag>
            {i < JOURNEY_STAGES.length - 1 && (
              <span className="text-fg-faint/40" aria-hidden>
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
