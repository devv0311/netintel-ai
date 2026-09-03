import { getAnalyticsMarker, analyticsMarkerKey } from "@/lib/analytics/marker";
import { corroborationMarkerKey, getCorroborationMarker } from "@/lib/corroboration/marker";
import {
  listAliases,
  listAnalyticalSignals,
  listCommunicationEvents,
  listCorroborationFindings,
  listEntities,
  listEvidenceItems,
  listExtractedRecords,
  listFinancialTransactions,
  listInvestigations,
  listLocations,
  listRelationships,
  listResolutionDecisions,
} from "@/lib/db/repository";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

import type { CorpusSnapshot } from "./retrieval";

/**
 * Loads everything the Copilot is allowed to ground on, in one place.
 *
 * Only already-persisted state, only through the validated repository
 * layer: no file read, no upload, no network, and never
 * `evidence/ground-truth/` — the held-out answer key stays out of the
 * inference path (docs/data/ground-truth-spec.md §2).
 */

export type CopilotReadiness =
  | { ready: true; snapshot: CorpusSnapshot }
  | { ready: false; reason: string };

/**
 * Stale derived intelligence is never served: only findings and signals
 * stamped with the CURRENT graph version are loaded, matching how
 * src/lib/corroboration/summary.ts already filters.
 */
export async function loadCopilotSnapshot(): Promise<CopilotReadiness> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) {
    return { ready: false, reason: "No investigation is loaded. Ingest the evidence corpus to begin." };
  }

  const graphMarker = await getGraphMarker(graphMarkerKey(investigation.id));
  if (!graphMarker) {
    return {
      ready: false,
      reason: "The case graph has not been synthesized yet. Run extraction, resolution, and graph synthesis first.",
    };
  }
  const graphVersion = graphMarker.synthesizedAt;

  const [analyticsMarker, corroborationMarker] = await Promise.all([
    getAnalyticsMarker(analyticsMarkerKey(investigation.id, graphVersion)),
    getCorroborationMarker(corroborationMarkerKey(investigation.id, graphVersion)),
  ]);
  if (!analyticsMarker) {
    return { ready: false, reason: "Topology analytics has not been run against the current graph version yet." };
  }
  if (!corroborationMarker) {
    return {
      ready: false,
      reason: "Spatial/temporal corroboration has not been run against the current graph version yet.",
    };
  }

  const [
    evidenceItems,
    extractedRecords,
    entities,
    aliases,
    locations,
    relationships,
    communicationEvents,
    financialTransactions,
    analyticalSignals,
    corroborationFindings,
    resolutionDecisions,
  ] = await Promise.all([
    listEvidenceItems(),
    listExtractedRecords(),
    listEntities(),
    listAliases(),
    listLocations(),
    listRelationships(),
    listCommunicationEvents(),
    listFinancialTransactions(),
    listAnalyticalSignals(),
    listCorroborationFindings(),
    listResolutionDecisions(),
  ]);

  return {
    ready: true,
    snapshot: {
      investigationId: investigation.id,
      investigationName: investigation.name,
      graphVersion,
      evidenceItems,
      extractedRecords,
      entities,
      aliases,
      locations,
      relationships,
      communicationEvents,
      financialTransactions,
      analyticalSignals: analyticalSignals.filter((s) => s.graphVersion === graphVersion),
      corroborationFindings: corroborationFindings.filter((f) => f.graphVersion === graphVersion),
      resolutionDecisions,
    },
  };
}
