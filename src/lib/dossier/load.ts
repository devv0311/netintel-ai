import { analyticsMarkerKey, getAnalyticsMarker } from "@/lib/analytics/marker";
import { corroborationMarkerKey, getCorroborationMarker } from "@/lib/corroboration/marker";
import {
  listAliases,
  listAnalyticalSignals,
  listCommunicationEvents,
  listCorroborationFindings,
  listEntities,
  listEvidenceItems,
  listEvidenceSources,
  listExtractedRecords,
  listInvestigations,
  listLocations,
  listRelationships,
  listResolutionDecisions,
} from "@/lib/db/repository";
import type { Alias, Entity } from "@/lib/domain/entity";
import type { AnalyticalSignal } from "@/lib/domain/derived";
import type { CommunicationEvent } from "@/lib/domain/events";
import type { CorroborationFinding } from "@/lib/domain/corroboration";
import type { Location } from "@/lib/domain/location";
import type { EvidenceItem, EvidenceSource } from "@/lib/domain/evidence";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Relationship } from "@/lib/domain/relationship";
import type { ResolutionDecision } from "@/lib/domain/resolution";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

/**
 * Loads everything the dossier is allowed to report on, in one place.
 *
 * Only already-persisted state, only through the validated repository
 * layer: no file read, no upload, no network, and never
 * `evidence/ground-truth/` — the held-out answer key stays out of the
 * reporting path exactly as it stays out of the inference path
 * (docs/data/ground-truth-spec.md §2). A report that could see ground
 * truth would be scoring itself.
 *
 * Stale derived intelligence is never reported: only analytical signals
 * and corroboration findings stamped with the CURRENT graph version are
 * loaded, matching how src/lib/corroboration/summary.ts and
 * src/lib/copilot/load.ts already filter.
 */

export interface DossierSnapshot {
  investigationId: string;
  investigationName: string;
  investigationStatus: string;
  graphVersion: string;
  evidenceSources: EvidenceSource[];
  evidenceItems: EvidenceItem[];
  extractedRecords: ExtractedRecord[];
  entities: Entity[];
  aliases: Alias[];
  /** Locations are graph nodes too — analytics and corroboration both reference them. */
  locations: Location[];
  resolutionDecisions: ResolutionDecision[];
  /** Cited by corroboration findings as supporting rows, alongside extracted records. */
  communicationEvents: CommunicationEvent[];
  relationships: Relationship[];
  analyticalSignals: AnalyticalSignal[];
  corroborationFindings: CorroborationFinding[];
}

export type DossierReadiness =
  | { ready: true; snapshot: DossierSnapshot }
  | { ready: false; code: "NO_INVESTIGATION" | "NO_GRAPH" | "NO_DERIVED_INTELLIGENCE"; reason: string };

export async function loadDossierSnapshot(): Promise<DossierReadiness> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) {
    return {
      ready: false,
      code: "NO_INVESTIGATION",
      reason: "No investigation is loaded. Ingest the evidence corpus to begin.",
    };
  }

  const graphMarker = await getGraphMarker(graphMarkerKey(investigation.id));
  if (!graphMarker) {
    return {
      ready: false,
      code: "NO_GRAPH",
      reason: "The case graph has not been synthesized yet. Run extraction, resolution, and graph synthesis first.",
    };
  }
  const graphVersion = graphMarker.synthesizedAt;

  // The dossier reports on analytics and corroboration, so it needs both
  // to have run against THIS graph version — a report that silently
  // omitted them would understate the case rather than describe it.
  const [analyticsMarker, corroborationMarker] = await Promise.all([
    getAnalyticsMarker(analyticsMarkerKey(investigation.id, graphVersion)),
    getCorroborationMarker(corroborationMarkerKey(investigation.id, graphVersion)),
  ]);
  if (!analyticsMarker) {
    return {
      ready: false,
      code: "NO_DERIVED_INTELLIGENCE",
      reason: "Topology analytics has not been run against the current graph version yet.",
    };
  }
  if (!corroborationMarker) {
    return {
      ready: false,
      code: "NO_DERIVED_INTELLIGENCE",
      reason: "Spatial/temporal corroboration has not been run against the current graph version yet.",
    };
  }

  const [
    evidenceSources,
    evidenceItems,
    extractedRecords,
    entities,
    aliases,
    locations,
    resolutionDecisions,
    communicationEvents,
    relationships,
    analyticalSignals,
    corroborationFindings,
  ] = await Promise.all([
    listEvidenceSources(),
    listEvidenceItems(),
    listExtractedRecords(),
    listEntities(),
    listAliases(),
    listLocations(),
    listResolutionDecisions(),
    listCommunicationEvents(),
    listRelationships(),
    listAnalyticalSignals(),
    listCorroborationFindings(),
  ]);

  return {
    ready: true,
    snapshot: {
      investigationId: investigation.id,
      investigationName: investigation.name,
      investigationStatus: investigation.status,
      graphVersion,
      evidenceSources,
      evidenceItems,
      extractedRecords,
      entities,
      aliases,
      locations,
      resolutionDecisions,
      communicationEvents,
      relationships,
      analyticalSignals: analyticalSignals.filter((s) => s.graphVersion === graphVersion),
      corroborationFindings: corroborationFindings.filter((f) => f.graphVersion === graphVersion),
    },
  };
}
