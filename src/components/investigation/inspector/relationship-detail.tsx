"use client";

import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ClassificationChip } from "@/components/ui/classification-chip";
import { ProvenanceBlock } from "@/components/ui/provenance-block";
import { formatCount } from "@/lib/format";
import type { EvidenceClassification } from "@/lib/domain/provenance";
import type { EdgeDetail } from "@/lib/graph/types";

import type { EvidenceReferenceData } from "./types";

/**
 * The Inspector's relationship mode (M10.1 audit §1 #5). Relationship
 * type, direction, classification, confidence, attributes, conflicts and
 * the resolved extracted-record evidence trail — the answer to "why does
 * this edge exist". Each source-evidence row opens the Evidence Reference
 * mode. Fetches `/api/graph/edges/{id}`; no backend change.
 */
export function RelationshipDetail({
  edgeId,
  onOpenEvidence,
}: {
  edgeId: string;
  onOpenEvidence: (reference: EvidenceReferenceData) => void;
}) {
  // The loaded detail carries the edge id it belongs to, so a stale
  // response never shows and no synchronous reset is needed on change.
  const [data, setData] = useState<{ id: string; detail: EdgeDetail | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/graph/edges/${encodeURIComponent(edgeId)}`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EdgeDetail>) : null))
      .catch(() => null)
      .then((d) => {
        if (!cancelled) setData({ id: edgeId, detail: d ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [edgeId]);

  const ready = data?.id === edgeId;
  const detail = ready ? data.detail : null;

  if (!ready) {
    return (
      <Card className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="graph-edge-detail-loading">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Loading relationship detail…
      </Card>
    );
  }

  if (!detail) {
    return <Card className="text-xs text-muted-foreground">Relationship not found.</Card>;
  }

  return (
    <Card className="gap-3 text-xs" data-testid="graph-edge-detail" data-slot="relationship-detail">
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
          <ClassificationChip
            classification={detail.classification as EvidenceClassification}
            data-testid="graph-edge-classification"
          />
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
            <li key={ref.extractedRecordId}>
              <button
                type="button"
                data-testid="graph-edge-evidence-item"
                onClick={() =>
                  onOpenEvidence({
                    id: ref.extractedRecordId,
                    recordType: ref.recordType.replaceAll("_", " "),
                    evidenceItemId: ref.evidenceItemId,
                    location: ref.location,
                  })
                }
                className="flex w-full flex-col gap-0.5 rounded bg-muted/40 p-1.5 text-left hover:bg-muted"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{ref.recordType.replaceAll("_", " ")}</Badge>
                  <span className="font-mono text-[10px] text-muted-foreground">{ref.evidenceItemId}</span>
                </span>
                <span className="text-muted-foreground">{ref.location}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ProvenanceBlock
        provenance={detail.provenance}
        className="border-t border-border pt-2"
        data-testid="graph-edge-provenance"
      />
    </Card>
  );
}
