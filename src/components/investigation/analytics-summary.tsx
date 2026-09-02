import { BarChart3 } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { AnalyticsSummary } from "@/lib/analytics/types";

/**
 * The "analytics synthesized" confirmation: node/edge counts analyzed
 * plus structural-signal counts. Mirrors
 * investigation/graph-summary.tsx.
 */
export function AnalyticsSummaryPanel({ summary, note }: { summary: AnalyticsSummary; note?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-2.5">
          <BarChart3 className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold" data-testid="analytics-synthesis-complete">
              Analytics synthesized
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCount(summary.counts.entitiesAnalyzed)} entities and{" "}
              {formatCount(summary.counts.edgesAnalyzed)} edges analyzed
              {summary.analyzedAt ? ` · analyzed ${formatUtc(summary.analyzedAt)}` : ""}. Every metric below is an{" "}
              <span className="font-medium text-foreground">Algorithmic Signal</span> — a structural description of
              the graph, never a claim about the world.
            </span>
          </div>
        </div>
        {note && (
          <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground" data-testid="analytics-synthesis-note">
            {note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="analytics-count-ranked">
            {formatCount(summary.counts.rankedEntities)}
          </span>
          <span className="text-xs text-muted-foreground">Ranked entities</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="analytics-count-bridges">
            {formatCount(summary.counts.bridgeEntities)}
          </span>
          <span className="text-xs text-muted-foreground">Bridge entities</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="analytics-count-communities">
            {formatCount(summary.counts.communities)}
          </span>
          <span className="text-xs text-muted-foreground">Communities</span>
        </Card>
        <Card className="gap-1 p-3">
          <span className="text-2xl font-semibold tabular-nums" data-testid="analytics-count-edges">
            {formatCount(summary.counts.edgesAnalyzed)}
          </span>
          <span className="text-xs text-muted-foreground">Edges analyzed</span>
        </Card>
      </div>
    </div>
  );
}
