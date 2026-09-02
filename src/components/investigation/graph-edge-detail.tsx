"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatCount } from "@/lib/format";
import type { EdgeDetail } from "@/lib/graph/types";

/**
 * The selected-edge detail panel: relationship type, direction,
 * classification, confidence, attributes, conflicts, and the resolved
 * extracted-record evidence trail — this is the answer to "why does
 * this edge exist," satisfying the requirement to trace a relationship
 * back to its source evidence directly from the graph screen.
 */
export function GraphEdgeDetail({ edgeId }: { edgeId: string }) {
  const [detail, setDetail] = useState<EdgeDetail | null>(null);
  const [loading, setLoading] = useState(true);

  // Keyed by edgeId at the call site (see graph-screen.tsx), so a fresh
  // mount already starts from loading=true/detail=null — this effect
  // only ever needs to set state from inside the fetch's own callbacks.
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph/edges/${encodeURIComponent(edgeId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EdgeDetail>) : null))
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [edgeId]);

  if (loading) {
    return (
      <Card className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="graph-edge-detail-loading">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading edge detail…
      </Card>
    );
  }

  if (!detail) {
    return <Card className="text-xs text-muted-foreground">Edge not found.</Card>;
  }

  return (
    <Card className="gap-3 text-xs" data-testid="graph-edge-detail">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium text-foreground" data-testid="graph-edge-source">
            {detail.sourceLabel}
          </span>
          <span aria-hidden>{detail.directed ? "→" : "↔"}</span>
          <span className="truncate font-medium text-foreground" data-testid="graph-edge-target">
            {detail.targetLabel}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="accent" data-testid="graph-edge-type">
            {detail.relationshipType}
          </Badge>
          <Badge variant="outline" data-testid="graph-edge-classification">
            {detail.classification.replaceAll("_", " ")}
          </Badge>
          <span className="text-muted-foreground">confidence {detail.confidence.toFixed(2)}</span>
        </div>
        {detail.conflicts.length > 0 && (
          <div className="flex items-start gap-1.5 rounded bg-muted px-2 py-1 text-foreground">
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            <ul className="list-disc pl-3">
              {detail.conflicts.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}
        {Object.keys(detail.attributes).length > 0 && (
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground" data-testid="graph-edge-attributes">
            {Object.entries(detail.attributes).map(([key, value]) => (
              <span key={key}>
                {key}: {String(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border pt-2">
        <span className="font-medium text-foreground">
          Source evidence ({formatCount(detail.extractedRecords.length)} records)
        </span>
        <ul className="flex flex-col gap-1" data-testid="graph-edge-evidence-list">
          {detail.extractedRecords.map((ref) => (
            <li key={ref.extractedRecordId} className="rounded bg-muted/40 p-1.5" data-testid="graph-edge-evidence-item">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="outline">{ref.recordType.replaceAll("_", " ")}</Badge>
                <span className="font-mono text-[10px] text-muted-foreground">{ref.evidenceItemId}</span>
              </div>
              <span className="text-muted-foreground">{ref.location}</span>
            </li>
          ))}
        </ul>
        <span className="text-muted-foreground">
          Provenance: {detail.provenance.location} · {detail.provenance.method}
        </span>
      </div>
    </Card>
  );
}
