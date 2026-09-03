import { ShieldCheck } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { CorroborationSummary } from "@/lib/corroboration/types";

/**
 * The "corroboration synthesized" confirmation: how much observable
 * activity was compared plus the finding counts, split by the
 * distinction this milestone is built around — corroborated facts
 * (independent multi-source agreement) vs algorithmic signals
 * (proximity, single-source timing, flagged contradictions). Mirrors
 * investigation/analytics-summary.tsx.
 */
export function CorroborationSummaryPanel({ summary, note }: { summary: CorroborationSummary; note?: string }) {
  const c = summary.counts;
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-2.5">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold" data-testid="corroboration-synthesis-complete">
              Corroboration synthesized
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCount(c.activityEvents)} observable activity events compared across{" "}
              {formatCount(c.entitiesConsidered)} entities and {formatCount(c.locationsConsidered)} located sites
              {summary.analyzedAt ? ` · analyzed ${formatUtc(summary.analyzedAt)}` : ""}. Each finding is either a{" "}
              <span className="font-medium text-foreground">Corroborated Fact</span> (independent evidence agrees) or an{" "}
              <span className="font-medium text-foreground">Algorithmic Signal</span> (derived) — never an observed fact.
            </span>
          </div>
        </div>
        {note && (
          <p
            className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground"
            data-testid="corroboration-synthesis-note"
          >
            {note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-count-spatial">
            {formatCount(c.spatialFindings)}
          </span>
          <span className="text-xs text-muted-foreground">Spatial findings</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-count-temporal">
            {formatCount(c.temporalFindings)}
          </span>
          <span className="text-xs text-muted-foreground">Temporal findings</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-count-overlaps">
            {formatCount(c.spatiotemporalFindings)}
          </span>
          <span className="text-xs text-muted-foreground">Repeated overlaps</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-count-contradictions">
            {formatCount(c.contradictions)}
          </span>
          <span className="text-xs text-muted-foreground">Contradictions</span>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-count-corroborated">
            {formatCount(c.corroboratedFacts)}
          </span>
          <span className="text-xs text-muted-foreground">Corroborated facts</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="corroboration-count-algorithmic">
            {formatCount(c.algorithmicSignals)}
          </span>
          <span className="text-xs text-muted-foreground">Algorithmic signals</span>
        </Card>
      </div>
    </div>
  );
}
