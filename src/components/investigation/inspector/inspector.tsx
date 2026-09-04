"use client";

import { useState } from "react";
import { Compass, X } from "lucide-react";

import { EmptyState } from "@/components/ui/states";

import { EntityProfile } from "./entity-profile";
import { RelationshipDetail } from "./relationship-detail";
import { FindingDetail } from "./finding-detail";
import { EvidenceReference } from "./evidence-reference";
import type { EvidenceReferenceData, InspectorContext, InspectorNav, InspectorTarget } from "./types";

/**
 * The one right-hand Inspector shared by Graph, Analytics and
 * Corroboration (M10.1 audit §2). It renders exactly one of: Entity
 * Profile, Relationship detail, Finding detail, Evidence Reference — or an
 * empty state. Drilling into an evidence id from a relationship or finding
 * swaps to the Evidence Reference and remembers the way back.
 *
 * `context` only selects the historical `data-testid` each hosting
 * screen's e2e coverage already asserts; the behaviour is identical
 * everywhere.
 */
const MODE_LABEL: Record<InspectorTarget["kind"], string> = {
  entity: "Entity profile",
  relationship: "Relationship",
  finding: "Finding",
  evidence: "Evidence reference",
};

export function Inspector({
  target,
  context,
  nav,
  onClear,
  onSelectEntity,
  onSelectRelationship,
}: {
  target: InspectorTarget | null;
  context: InspectorContext;
  nav: InspectorNav;
  onClear: () => void;
  onSelectEntity: (id: string) => void;
  onSelectRelationship: (id: string) => void;
}) {
  // An evidence id drilled into from the relationship / finding modes;
  // reset whenever the Inspector's target changes (render-phase
  // reconciliation, not an effect).
  const [evidenceDrill, setEvidenceDrill] = useState<EvidenceReferenceData | null>(null);
  const [syncedTarget, setSyncedTarget] = useState(target);
  if (target !== syncedTarget) {
    setSyncedTarget(target);
    setEvidenceDrill(null);
  }

  const label = evidenceDrill ? "Evidence reference" : target ? MODE_LABEL[target.kind] : "Inspector";

  return (
    <aside className="w-full shrink-0 lg:w-80" data-testid="inspector" data-inspector-context={context} aria-label="Inspector">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">{label}</span>
        {(target || evidenceDrill) && (
          <button
            type="button"
            onClick={() => {
              setEvidenceDrill(null);
              onClear();
            }}
            data-testid="inspector-clear"
            aria-label="Clear inspector"
            className="rounded p-0.5 text-fg-muted hover:text-fg"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        )}
      </div>

      {evidenceDrill ? (
        <EvidenceReference reference={evidenceDrill} onBack={() => setEvidenceDrill(null)} />
      ) : !target ? (
        <EmptyState
          icon={Compass}
          title="Nothing selected"
          detail="Select an entity, a relationship or a finding to inspect its detail and provenance."
          className="p-5"
          data-testid="inspector-empty"
        />
      ) : target.kind === "entity" ? (
        <EntityProfile
          entityId={target.id}
          context={context}
          onSelectEntity={onSelectEntity}
          onSelectRelationship={onSelectRelationship}
          onViewInGraph={nav.viewInGraph}
          onViewInAnalytics={nav.viewInAnalytics}
          onViewInCorroboration={nav.viewInCorroboration}
        />
      ) : target.kind === "relationship" ? (
        <RelationshipDetail edgeId={target.id} onOpenEvidence={setEvidenceDrill} />
      ) : target.kind === "finding" ? (
        <FindingDetail finding={target.finding} onViewInGraph={nav.viewInGraph} onOpenEvidence={setEvidenceDrill} />
      ) : (
        <EvidenceReference reference={target.reference} onBack={onClear} />
      )}
    </aside>
  );
}
