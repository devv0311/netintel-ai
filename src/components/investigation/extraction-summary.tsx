import { CheckCircle2 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { ExtractionSummary } from "@/lib/extraction/types";

const RECORD_TYPE_LABELS: Record<string, string> = {
  entity_mention: "Entity mentions",
  event_mention: "Event mentions",
  relationship_mention: "Relationship mentions",
  attribute_mention: "Attribute mentions",
};

/**
 * The "extraction complete" confirmation: deterministic record counts by
 * type. Every displayed record is classified Observed Fact — extraction
 * performs no entity resolution or investigative inference.
 */
export function ExtractionSummaryPanel({
  summary,
  note,
}: {
  summary: ExtractionSummary;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold" data-testid="extraction-complete">
              Evidence extracted
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCount(summary.totalRecords)} explicit facts extracted from{" "}
              {formatCount(summary.evidenceItemsExtracted)} of{" "}
              {formatCount(summary.evidenceItemsTotal)} evidence items
              {summary.extractedAt ? ` · extracted ${formatUtc(summary.extractedAt)}` : ""}. Every
              record is classified <span className="font-medium text-foreground">Observed Fact</span> —
              directly stated in a single source, with no entity resolution or inference applied.
            </span>
          </div>
        </div>
        {note && (
          <p
            className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            data-testid="extraction-note"
          >
            {note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(summary.recordsByType)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([type, n]) => (
            <Card key={type} className="gap-1 p-3">
              <span
                className="text-2xl font-semibold tabular-nums"
                data-testid={`extraction-count-${type}`}
              >
                {formatCount(n)}
              </span>
              <span className="text-xs text-muted-foreground">
                {RECORD_TYPE_LABELS[type] ?? type}
              </span>
            </Card>
          ))}
      </div>
    </div>
  );
}
