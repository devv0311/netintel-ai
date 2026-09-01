import { cn } from "@/lib/utils";

/**
 * The intended demonstration flow, per README.md / docs/requirements.md §4.
 * A status display only: a stage lights up as complete when it is
 * genuinely done (passed in via `completed`). As of P5.2 that is
 * "Upload Evidence" and "Ingestion" once a corpus is loaded — every
 * later stage is a later milestone and stays inert.
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

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
      aria-label="Investigation pipeline status"
    >
      {JOURNEY_STAGES.map((stage, i) => {
        const isDone = done.has(stage);
        return (
          <div key={stage} className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  isDone ? "bg-accent" : "bg-muted-foreground/40",
                )}
                aria-hidden
              />
              <span
                className={cn(
                  "text-xs",
                  isDone
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {stage}
              </span>
            </div>
            {i < JOURNEY_STAGES.length - 1 && (
              <span className="text-muted-foreground/30" aria-hidden>
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
