import { CheckCircle2, ShieldQuestion } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { ResolutionSummary } from "@/lib/resolution/types";

const KIND_LABELS: Record<string, string> = {
  person: "Person entities",
  phone: "Phone entities",
  imei: "IMEI entities",
  vehicle: "Vehicle entities",
  bank_account: "Bank account entities",
};

/**
 * The "resolution complete" confirmation: deterministic canonical-entity
 * counts by kind. Every resolution decision is classified AI Inference
 * (docs/requirements.md §7) — a merge conclusion, never an Observed
 * Fact — and ambiguous mentions are called out explicitly rather than
 * hidden.
 */
export function ResolutionSummaryPanel({
  summary,
  note,
}: {
  summary: ResolutionSummary;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-2.5">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold" data-testid="resolution-complete">
              Entities resolved
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCount(summary.totalEntities)} canonical entities and{" "}
              {formatCount(summary.totalAliases)} aliases from{" "}
              {formatCount(summary.totalDecisions)} resolution decisions
              {summary.resolvedAt ? ` · resolved ${formatUtc(summary.resolvedAt)}` : ""}. Every
              decision is classified{" "}
              <span className="font-medium text-foreground">AI Inference</span> — a merge
              conclusion derived from evidence, never an observed fact.
            </span>
          </div>
        </div>
        {summary.ambiguousDecisions > 0 && (
          <div
            className="flex items-start gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            data-testid="resolution-ambiguous-note"
          >
            <ShieldQuestion className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <span>
              {formatCount(summary.ambiguousDecisions)} mention
              {summary.ambiguousDecisions === 1 ? "" : "s"} matched more than one
              identifier-anchored entity and were deliberately left unmerged — see the
              ambiguous entries below.
            </span>
          </div>
        )}
        {note && (
          <p
            className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            data-testid="resolution-note"
          >
            {note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {Object.entries(summary.entitiesByKind)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([kind, n]) => (
            <Card key={kind} className="gap-1 p-3">
              <span
                className="text-2xl font-semibold tabular-nums"
                data-testid={`resolution-count-${kind}`}
              >
                {formatCount(n)}
              </span>
              <span className="text-xs text-muted-foreground">
                {KIND_LABELS[kind] ?? kind}
              </span>
            </Card>
          ))}
      </div>
    </div>
  );
}
