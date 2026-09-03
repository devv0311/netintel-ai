import { cn } from "@/lib/utils";

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

export function PipelineStatus({
  completed = [],
}: {
  completed?: readonly string[];
}) {
  const done = new Set(completed);
  const doneCount = JOURNEY_STAGES.filter((s) => done.has(s)).length;

  return (
    <div
      className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px]"
      aria-label="Investigation pipeline status"
    >
      <span className="mr-1 font-mono text-[10px] uppercase tracking-wide text-fg-faint">
        pipeline {doneCount}/{JOURNEY_STAGES.length}
      </span>
      {JOURNEY_STAGES.map((stage, i) => {
        const isDone = done.has(stage);
        return (
          <div key={stage} className="flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isDone ? "bg-accent" : "bg-fg-faint/40",
                )}
                aria-hidden
              />
              <span className={cn(isDone ? "font-medium text-fg" : "text-fg-faint")}>
                {stage}
              </span>
            </span>
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
