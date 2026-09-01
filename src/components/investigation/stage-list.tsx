import { Check, CircleDashed, Loader2, Minus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { formatCount } from "@/lib/format";
import {
  INGESTION_STAGES,
  INGESTION_STAGE_LABELS,
  type StageReport,
} from "@/lib/ingestion/types";

/**
 * Renders the eight ingestion stages and their real, server-reported
 * status. There is no timed animation — a stage only advances when the
 * stream says it did.
 */
export function StageList({
  stages,
  persistProgress,
}: {
  stages: StageReport[];
  persistProgress: { label: string; done: number; total: number } | null;
}) {
  const byStage = new Map(stages.map((s) => [s.stage, s]));

  return (
    <ol className="flex flex-col gap-1.5" aria-label="Ingestion stages">
      {INGESTION_STAGES.map((stage) => {
        const report = byStage.get(stage);
        const status = report?.status ?? "pending";
        const isPersistence = stage === "persistence";
        return (
          <li
            key={stage}
            data-testid={`stage-${stage}`}
            data-status={status}
            className="flex items-start gap-2.5 rounded-md px-2 py-1.5"
          >
            <StatusIcon status={status} />
            <div className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "text-sm",
                  status === "pending" && "text-muted-foreground",
                  status === "failed" && "text-foreground font-medium",
                )}
              >
                {INGESTION_STAGE_LABELS[stage]}
              </span>
              {report?.detail && status !== "pending" && (
                <span className="text-xs text-muted-foreground">{report.detail}</span>
              )}
              {isPersistence && status === "running" && persistProgress && (
                <span className="text-xs text-muted-foreground">
                  {persistProgress.label}: {formatCount(persistProgress.done)} /{" "}
                  {formatCount(persistProgress.total)} records
                </span>
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
      return (
        <Loader2 className={cn(base, "animate-spin text-accent")} aria-label="running" />
      );
    case "failed":
      return <X className={cn(base, "text-foreground")} aria-label="failed" />;
    case "skipped":
      return <Minus className={cn(base, "text-muted-foreground")} aria-label="skipped" />;
    default:
      return (
        <CircleDashed
          className={cn(base, "text-muted-foreground/50")}
          aria-label="pending"
        />
      );
  }
}
