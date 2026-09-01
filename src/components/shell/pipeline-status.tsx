import { cn } from "@/lib/utils";

/**
 * The intended demonstration flow, per README.md / docs/requirements.md §4.
 * Purely a status display — no stage is implemented yet, so every stage
 * renders as "not started".
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

export function PipelineStatus() {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3"
      aria-label="Investigation pipeline status"
    >
      {JOURNEY_STAGES.map((stage, i) => (
        <div key={stage} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                "size-1.5 rounded-full bg-muted-foreground/40",
              )}
              aria-hidden
            />
            <span className="text-xs text-muted-foreground">{stage}</span>
          </div>
          {i < JOURNEY_STAGES.length - 1 && (
            <span className="text-muted-foreground/30" aria-hidden>
              →
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
