import { listEvidenceItems, listExtractedRecords, listInvestigations } from "@/lib/db/repository";

import { extractionMarkerKey, getExtractionMarker } from "./marker";
import type { ExtractedFactsPage, ExtractedFactView, ExtractionState, ExtractionSummary } from "./types";

/**
 * The server-derived extraction state the page renders from, mirroring
 * src/lib/ingestion/summary.ts. Reads only domain evidence/extraction
 * tables + the extraction marker — never anything under
 * evidence/ground-truth/. Exposes counts and identity only.
 */
export async function getExtractionState(): Promise<ExtractionState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return { status: "not_available" };

  const marker = await getExtractionMarker(extractionMarkerKey(investigation.id));
  const records = await listExtractedRecords();
  if (!marker || records.length === 0) return { status: "pending" };

  const recordsByType: Record<string, number> = {};
  for (const r of records) recordsByType[r.recordType] = (recordsByType[r.recordType] ?? 0) + 1;

  const items = await listEvidenceItems();
  const extractedItemIds = new Set(records.map((r) => r.evidenceItemId));

  const summary: ExtractionSummary = {
    investigationId: investigation.id,
    extractedAt: marker.extractedAt,
    totalRecords: records.length,
    recordsByType,
    evidenceItemsExtracted: extractedItemIds.size,
    evidenceItemsTotal: items.filter((i) => i.validationStatus === "accepted").length,
  };
  return { status: "extracted", summary };
}

const DEFAULT_FACTS_LIMIT = 25;
const MAX_FACTS_LIMIT = 100;

/**
 * A representative, paginated slice of extracted facts for the
 * extraction-results view (this milestone's requirement #20) — never the
 * full multi-thousand-row corpus in one response. Sorted by id for a
 * stable, deterministic page order across repeated calls.
 */
export async function getExtractedFactsPage(
  offset = 0,
  limit = DEFAULT_FACTS_LIMIT,
): Promise<ExtractedFactsPage> {
  const boundedOffset = Math.max(0, offset);
  const boundedLimit = Math.min(Math.max(1, limit), MAX_FACTS_LIMIT);

  const [records, items] = await Promise.all([listExtractedRecords(), listEvidenceItems()]);
  const itemTypeById = new Map(items.map((i) => [i.id, i.itemType]));
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const page = sorted.slice(boundedOffset, boundedOffset + boundedLimit);

  const facts: ExtractedFactView[] = page.map((r) => ({
    id: r.id,
    recordType: r.recordType,
    factType: typeof r.data.factType === "string" ? r.data.factType : r.recordType,
    observedValue: r.data.observedValue ?? null,
    evidenceItemId: r.evidenceItemId,
    evidenceItemType: itemTypeById.get(r.evidenceItemId) ?? "unknown",
    classification: r.classification,
    confidence: r.provenance.confidence,
    provenance: {
      source: r.provenance.source,
      location: r.provenance.location,
      method: r.provenance.method,
      processingHistory: r.provenance.processingHistory,
      timestamp: r.provenance.timestamp,
    },
  }));

  return { facts, total: records.length, offset: boundedOffset, limit: boundedLimit };
}
