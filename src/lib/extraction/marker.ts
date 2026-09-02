import { getAppMeta, setAppMeta } from "@/lib/db/repository";

import type { ExtractionCounts } from "./types";

/**
 * The extraction completion marker, mirroring
 * src/lib/ingestion/marker.ts. Keyed by investigation id (rather than a
 * corpus version) because extraction's input is "whatever evidence is
 * currently persisted for this investigation", not a specific evidence
 * file. Informational only — idempotency itself does not depend on this
 * marker; it comes from row-level deterministic-id skipping in
 * ./persist.ts, so a marker that is somehow missing after a partial run
 * does not cause duplicate rows on retry.
 */

export interface ExtractionMarker {
  investigationId: string;
  /** Wall-clock time the extraction run completed — operational metadata. */
  extractedAt: string;
  counts: ExtractionCounts;
}

export function extractionMarkerKey(investigationId: string): string {
  return `extract:${investigationId}`;
}

export async function getExtractionMarker(key: string): Promise<ExtractionMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "counts" in parsed &&
      "extractedAt" in parsed
    ) {
      return parsed as ExtractionMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setExtractionMarker(key: string, marker: ExtractionMarker): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
