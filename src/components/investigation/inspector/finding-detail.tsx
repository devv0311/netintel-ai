"use client";

import { MapPin, Network } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClassificationChip } from "@/components/ui/classification-chip";
import { formatCount } from "@/lib/format";
import type { CorroborationFindingType, CorroborationFindingView } from "@/lib/corroboration/types";

import type { EvidenceReferenceData } from "./types";

/**
 * The Inspector's finding mode (M10.1 audit §1 #5). A corroboration
 * finding's classification, the entities and locations it links, the
 * observed window, the structured metric that produced it, its
 * explanation, the provenance chain, and the exact supporting evidence —
 * each id opens the Evidence Reference mode. Works from the finding
 * object the corroboration screen already holds; no fetch, no backend
 * change.
 */
const FINDING_TYPE_LABELS: Record<CorroborationFindingType, string> = {
  spatial_co_location: "Co-location",
  spatial_proximity: "Proximity",
  temporal_co_occurrence: "Temporal co-occurrence",
  repeated_spatiotemporal_overlap: "Repeated overlap",
  spatiotemporal_contradiction: "Contradiction",
};

const KIND_LABELS: Record<string, string> = {
  person: "person",
  phone: "phone",
  imei: "imei",
  vehicle: "vehicle",
  bank_account: "bank account",
  organisation: "organisation",
  location: "location",
};

export function FindingDetail({
  finding,
  onViewInGraph,
  onOpenEvidence,
}: {
  finding: CorroborationFindingView;
  onViewInGraph: (entityId: string) => void;
  onOpenEvidence: (reference: EvidenceReferenceData) => void;
}) {
  const f = finding;
  return (
    <Card className="gap-3 text-xs" data-testid="corroboration-detail" data-slot="finding-detail">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <ClassificationChip classification={f.classification} data-testid="corroboration-detail-classification" />
          <Badge variant="outline">{FINDING_TYPE_LABELS[f.findingType]}</Badge>
        </div>
        {f.entities.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {f.entities.map((e) => (
              <Badge key={e.id} variant="outline">
                {e.label} · {KIND_LABELS[e.kind] ?? e.kind}
              </Badge>
            ))}
          </div>
        )}
        {f.entities.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="w-fit gap-1.5"
            onClick={() => onViewInGraph(f.entities[0]!.id)}
            data-testid="corroboration-view-in-graph"
          >
            <Network className="size-3.5" aria-hidden />
            View in graph
          </Button>
        )}
      </div>

      {f.locations.length > 0 && (
        <div className="flex flex-col gap-1 border-t border-border pt-2">
          <span className="font-medium text-foreground">Location{f.locations.length > 1 ? "s" : ""}</span>
          {f.locations.map((l) => (
            <div key={l.id} className="flex items-center gap-1.5 text-muted-foreground">
              <MapPin className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{l.label}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px]">
                {l.latitude.toFixed(4)}, {l.longitude.toFixed(4)}
              </span>
            </div>
          ))}
        </div>
      )}

      {f.window && (
        <div className="flex flex-col gap-0.5 border-t border-border pt-2 text-muted-foreground">
          <span className="font-medium text-foreground">Observed window</span>
          <span className="font-mono text-[10px]">
            {f.window.start}
            {f.window.end ? ` → ${f.window.end}` : ""}
          </span>
        </div>
      )}

      <div className="flex flex-col gap-1 border-t border-border pt-2">
        <span className="font-medium text-foreground">Metric</span>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted-foreground">
          {Object.entries(f.value).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate">{k}</dt>
              <dd className="truncate text-right font-mono text-[10px]">
                {v === null ? "—" : Array.isArray(v) ? v.join(", ") : String(v)}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <p className="border-t border-border pt-2 text-muted-foreground">{f.explanation}</p>

      <div className="flex flex-col gap-1 border-t border-border pt-2" data-testid="corroboration-detail-provenance">
        <span className="font-medium text-foreground">Provenance</span>
        <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 text-muted-foreground">
          <span>method</span>
          <span className="truncate font-mono text-[10px]">{f.method}</span>
          <span>confidence</span>
          <span className="font-mono text-[10px]">{f.provenance.confidence.toFixed(2)}</span>
          <span>derived at</span>
          <span className="truncate font-mono text-[10px]">{f.provenance.timestamp}</span>
          <span>history</span>
          <span className="truncate font-mono text-[10px]">{f.provenance.processingHistory.join(" → ")}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1 border-t border-border pt-2" data-testid="corroboration-detail-evidence">
        <span className="font-medium text-foreground">
          Supporting evidence ({formatCount(f.evidenceItemIds.length)} item
          {f.evidenceItemIds.length === 1 ? "" : "s"})
        </span>
        <ul className="flex flex-wrap gap-1">
          {f.evidenceItemIds.slice(0, 12).map((id) => (
            <li key={id}>
              <button
                type="button"
                data-testid="corroboration-evidence-chip"
                onClick={() => onOpenEvidence({ id, recordType: "evidence item" })}
                className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {id}
              </button>
            </li>
          ))}
          {f.evidenceItemIds.length > 12 && (
            <li className="text-[10px] text-muted-foreground">+{f.evidenceItemIds.length - 12} more</li>
          )}
        </ul>
        <span className="text-[10px] text-muted-foreground">
          {formatCount(f.supportingRecordIds.length)} observable record
          {f.supportingRecordIds.length === 1 ? "" : "s"} compared
        </span>
      </div>
    </Card>
  );
}
