import {
  listInvestigations,
  listEvidenceSources,
  listEvidenceItems,
  listLocations,
  listCommunicationEvents,
  listFinancialTransactions,
} from "@/lib/db/repository";
import { CORPUS_NAME, CORPUS_VERSION } from "@/lib/corpus/config";

import { getIngestionMarker, ingestionMarkerKey } from "./marker";
import type { EvidenceCounts, InvestigationState } from "./types";

/**
 * The server-derived investigation state the page renders from. Reads
 * only domain evidence tables + the ingestion marker — never anything
 * under evidence/ground-truth/ and never the ground-truth loader. The
 * returned object carries counts and identity only, no expected-answer
 * content.
 */
export async function getInvestigationState(): Promise<InvestigationState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return { status: "empty" };

  const [items, sources, comms, txns, locations] = await Promise.all([
    listEvidenceItems(),
    listEvidenceSources(),
    listCommunicationEvents(),
    listFinancialTransactions(),
    listLocations(),
  ]);

  const evidenceItemsByType: Record<string, number> = {};
  for (const item of items) {
    evidenceItemsByType[item.itemType] = (evidenceItemsByType[item.itemType] ?? 0) + 1;
  }

  const counts: EvidenceCounts = {
    evidenceSources: sources.length,
    evidenceItems: items.length,
    communications: comms.length,
    financialTransactions: txns.length,
    locations: locations.length,
    evidenceItemsByType,
  };

  const marker = await getIngestionMarker(
    ingestionMarkerKey(CORPUS_NAME, CORPUS_VERSION),
  );

  return {
    status: "loaded",
    summary: {
      investigationId: investigation.id,
      name: investigation.name,
      status: investigation.status,
      corpusName: CORPUS_NAME,
      corpusVersion: CORPUS_VERSION,
      ingestedAt: marker?.ingestedAt ?? null,
      counts,
    },
  };
}
