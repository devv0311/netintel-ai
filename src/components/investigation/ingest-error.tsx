import { AlertTriangle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  INGESTION_STAGE_LABELS,
  type IngestionError,
} from "@/lib/ingestion/types";

/**
 * Structured, user-safe rendering of an ingestion failure: a stable
 * error code, a plain-language message, the stage it failed at, and
 * sanitized issue lines (schema paths only). No stack traces, no
 * filesystem paths, no secrets.
 */
export function IngestError({ error }: { error: IngestionError }) {
  return (
    <Card
      className="border-foreground/20 bg-muted/40"
      role="alert"
      data-testid="ingest-error"
      data-error-code={error.code}
    >
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">Ingestion failed</span>
            <Badge variant="outline" className="font-mono text-[11px]">
              {error.code}
            </Badge>
            <span className="text-xs text-muted-foreground">
              at “{INGESTION_STAGE_LABELS[error.stage]}”
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{error.message}</p>
          {error.issues && error.issues.length > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer select-none">
                {error.issues.length} detail
                {error.issues.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-1 flex flex-col gap-0.5 pl-4">
                {error.issues.map((issue, i) => (
                  <li key={i} className="list-disc font-mono">
                    {issue}
                  </li>
                ))}
              </ul>
            </details>
          )}
          <p className="text-xs text-muted-foreground">
            No records were persisted for this run.
          </p>
        </div>
      </div>
    </Card>
  );
}
