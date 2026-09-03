import { Check, CircleDashed, Loader2, Minus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { COPILOT_STAGES, COPILOT_STAGE_LABELS, type StageReport } from "@/lib/copilot/types";

/**
 * Renders the nine Copilot stages and their real, server-reported
 * status. There is no timed animation — a stage only advances when the
 * stream says it did. Mirrors investigation/corroboration-stage-list.tsx.
 */
export function CopilotStageList({ stages }: { stages: StageReport[] }) {
  const byStage = new Map(stages.map((s) => [s.stage, s]));

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Copilot stages">
      {COPILOT_STAGES.map((stage) => {
        const report = byStage.get(stage);
        const status = report?.status ?? "pending";
        return (
          <li
            key={stage}
            data-testid={`copilot-stage-${stage}`}
            data-status={status}
            className="flex items-start gap-2.5 rounded-md px-2 py-1.5"
          >
            <StatusIcon status={status} />
            <div className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "text-sm",
                  status === "pending" && "text-muted-foreground",
                  status === "failed" && "font-medium text-foreground",
                )}
              >
                {COPILOT_STAGE_LABELS[stage]}
              </span>
              {report?.detail && status !== "pending" && (
                <span className="text-xs text-muted-foreground">{report.detail}</span>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function StatusIcon({ status }: { status: StageReport["status"] | "pending" }) {
  const base = "size-4 shrink-0 mt-0.5";
  switch (status) {
    case "ok":
      return <Check className={cn(base, "text-accent")} aria-label="done" />;
    case "running":
      return <Loader2 className={cn(base, "animate-spin text-accent")} aria-label="running" />;
    case "failed":
      return <X className={cn(base, "text-foreground")} aria-label="failed" />;
    case "skipped":
      return <Minus className={cn(base, "text-muted-foreground")} aria-label="skipped" />;
    default:
      return <CircleDashed className={cn(base, "text-muted-foreground/50")} aria-label="pending" />;
  }
}
