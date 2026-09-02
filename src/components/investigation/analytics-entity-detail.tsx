"use client";

import { useEffect, useState } from "react";
import { Loader2, Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { EntityAnalyticsDetail } from "@/lib/analytics/types";

const KIND_LABELS: Record<string, string> = {
  person: "person",
  phone: "phone",
  imei: "imei",
  vehicle: "vehicle",
  bank_account: "bank account",
  location: "location",
};

/**
 * The selected-entity analytics detail panel: degree breakdown (total,
 * weighted, in/out, by relationship type), every algorithmic signal
 * targeting this entity (with its supporting graph edges — the
 * provenance trail from signal back to evidence), and community
 * membership. "View in graph" hands off to the Graph screen, focused
 * on this entity's neighborhood, satisfying the requirement that
 * selecting an entity here lets the investigator inspect its real
 * graph neighborhood.
 */
export function AnalyticsEntityDetail({
  entityId,
  onViewInGraph,
}: {
  entityId: string;
  onViewInGraph: (entityId: string) => void;
}) {
  const [detail, setDetail] = useState<EntityAnalyticsDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/analytics/entities/${encodeURIComponent(entityId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EntityAnalyticsDetail>) : null))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityId]);

  if (loading) {
    return (
      <Card className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="analytics-entity-detail-loading">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading entity analytics…
      </Card>
    );
  }

  if (!detail) {
    return <Card className="text-xs text-muted-foreground">Entity not found.</Card>;
  }

  return (
    <Card className="gap-3 text-xs" data-testid="analytics-entity-detail">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-sm font-semibold" data-testid="analytics-entity-label">
            {detail.label}
          </span>
          <Badge variant="accent">{KIND_LABELS[detail.kind] ?? detail.kind}</Badge>
          {detail.communityId && <Badge variant="outline">community {detail.communityId.slice(0, 14)}…</Badge>}
        </div>
        <Button size="sm" variant="outline" className="w-fit gap-1.5" onClick={() => onViewInGraph(entityId)} data-testid="analytics-view-in-graph">
          <Network className="size-3.5" aria-hidden />
          View in graph
        </Button>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="font-medium text-foreground">Degree</span>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          <span>Total: {formatCount(detail.degree.total)}</span>
          <span>Weighted: {formatCount(detail.degree.weighted)}</span>
          <span>Incoming: {formatCount(detail.degree.incoming)}</span>
          <span>Outgoing: {formatCount(detail.degree.outgoing)}</span>
        </div>
        {Object.keys(detail.degree.byRelationshipType).length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(detail.degree.byRelationshipType).map(([type, n]) => (
              <Badge key={type} variant="outline">
                {type}: {n}
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="font-medium text-foreground">
          Algorithmic signals ({formatCount(detail.signals.length)})
        </span>
        <ul className="flex flex-col gap-1.5">
          {detail.signals.map((s) => (
            <li key={s.id} className="rounded bg-muted/40 p-1.5" data-testid="analytics-entity-signal">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{s.signalType}</Badge>
                <Badge variant="accent">{s.classification.replaceAll("_", " ")}</Badge>
                <span className="ml-auto text-muted-foreground">confidence {s.confidence.toFixed(2)}</span>
              </div>
              <p className="mt-0.5 text-muted-foreground">{s.explanation}</p>
              {s.supportingEdgeIds.length > 0 && (
                <span className="text-muted-foreground">
                  Supporting edges: {formatCount(s.supportingEdgeIds.length)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
