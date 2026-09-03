"use client";

import { ChevronLeft, FileText } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

import type { EvidenceReferenceData } from "./types";

/**
 * The Inspector's evidence-reference mode (M10.1 audit §1 #5). It shows
 * what the citing surface already knows about an evidence id — its type,
 * the owning evidence item, where in that item it was found, and any
 * resolved label. The full source-record view (the record's own text and
 * six-field provenance) is the Evidence surface's job — M10.6 — so this
 * carries no fetch and states that plainly rather than implying more than
 * it has.
 */
export function EvidenceReference({
  reference,
  onBack,
}: {
  reference: EvidenceReferenceData;
  onBack: () => void;
}) {
  const rows: [string, string][] = [];
  if (reference.recordType) rows.push(["type", reference.recordType]);
  if (reference.evidenceItemId) rows.push(["evidence item", reference.evidenceItemId]);
  if (reference.location) rows.push(["location", reference.location]);
  if (reference.label) rows.push(["label", reference.label]);

  return (
    <Card className="gap-3 text-xs" data-testid="evidence-reference" data-slot="evidence-reference">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onBack}
          data-testid="evidence-reference-back"
          aria-label="Back"
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </button>
        <FileText className="size-3.5 text-muted-foreground" aria-hidden />
        <span className="font-medium text-foreground">Evidence reference</span>
      </div>

      <div className="flex flex-col gap-1">
        <span className="break-all font-mono text-[11px] text-foreground" data-testid="evidence-reference-id">
          {reference.id}
        </span>
        {rows.length > 0 && (
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <span>{k}</span>
                <span className="break-all font-mono">{v}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-start gap-1.5 border-t border-border pt-2 text-[10px] text-muted-foreground">
        <Badge variant="outline" className="shrink-0">
          source view: M10.6
        </Badge>
        <span>
          The record&apos;s own text and full six-field provenance open with the Evidence surface. This reference is
          exactly what the citing view carried — nothing is inferred.
        </span>
      </div>
    </Card>
  );
}
