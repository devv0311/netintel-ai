import type { CorroborationFindingView } from "@/lib/corroboration/types";

/**
 * The shared right-hand Inspector (M10.1 audit §2) renders exactly one of
 * these at a time. Graph, Analytics and Corroboration all host the same
 * `<Inspector>`; the `context` only maps the historical `data-testid`
 * vocabulary each screen's e2e coverage already asserts.
 */
export type InspectorTarget =
  | { kind: "entity"; id: string }
  | { kind: "relationship"; id: string }
  | { kind: "finding"; id: string; finding: CorroborationFindingView }
  | { kind: "evidence"; reference: EvidenceReferenceData };

/**
 * What is known about an evidence id purely from the surface that cited it
 * — the full source record is the Evidence surface's job (M10.6), so this
 * carries no fetch.
 */
export interface EvidenceReferenceData {
  id: string;
  /** e.g. "evidence item", "extracted record" — from the citing surface. */
  recordType?: string;
  evidenceItemId?: string;
  location?: string;
  label?: string;
}

export type InspectorContext = "graph" | "analytics" | "corroboration";

export interface InspectorNav {
  viewInGraph: (entityId: string) => void;
  viewInAnalytics: (entityId: string) => void;
  viewInCorroboration: (entityId: string) => void;
}
