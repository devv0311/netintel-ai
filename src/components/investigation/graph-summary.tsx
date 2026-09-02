import { Network } from "lucide-react";

import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { GraphSummary } from "@/lib/graph/types";

const KIND_LABELS: Record<string, string> = {
  person: "Person nodes",
  phone: "Phone nodes",
  imei: "IMEI nodes",
  vehicle: "Vehicle nodes",
  bank_account: "Bank account nodes",
  location: "Location nodes",
};

const TYPE_LABELS: Record<string, string> = {
  ownership: "Ownership edges",
  communication: "Communication edges",
  financial: "Financial edges",
  co_location: "Co-location edges",
  family: "Family edges",
  associate: "Associate edges",
  other: "Other edges",
};

/**
 * The "graph synthesized" confirmation: deterministic node/edge counts
 * by kind and type. Mirrors investigation/resolution-summary.tsx.
 */
export function GraphSummaryPanel({ summary, note }: { summary: GraphSummary; note?: string }) {
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <div className="flex items-start gap-2.5">
          <Network className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-semibold" data-testid="graph-synthesis-complete">
              Graph synthesized
            </span>
            <span className="text-xs text-muted-foreground">
              {formatCount(summary.totalNodes)} nodes and {formatCount(summary.totalEdges)} edges
              {summary.synthesizedAt ? ` · synthesized ${formatUtc(summary.synthesizedAt)}` : ""}. Every
              edge is traceable to the resolved entities and extracted evidence that justify it.
            </span>
          </div>
        </div>
        {note && (
          <p className="rounded-md bg-muted px-2.5 py-1.5 text-xs text-muted-foreground" data-testid="graph-synthesis-note">
            {note}
          </p>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {Object.entries(summary.nodesByKind)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([kind, n]) => (
            <Card key={kind} className="gap-1 p-3">
              <span className="text-2xl font-semibold tabular-nums" data-testid={`graph-count-${kind}`}>
                {formatCount(n)}
              </span>
              <span className="text-xs text-muted-foreground">{KIND_LABELS[kind] ?? kind}</span>
            </Card>
          ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(summary.edgesByType)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([type, n]) => (
            <Card key={type} className="gap-1 p-3">
              <span className="text-2xl font-semibold tabular-nums" data-testid={`graph-edge-count-${type}`}>
                {formatCount(n)}
              </span>
              <span className="text-xs text-muted-foreground">{TYPE_LABELS[type] ?? type}</span>
            </Card>
          ))}
      </div>
    </div>
  );
}
