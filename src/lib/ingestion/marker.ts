import { getAppMeta, setAppMeta } from "@/lib/db/repository";

import type { EvidenceCounts } from "./types";

/**
 * The ingestion completion marker.
 *
 * After a corpus is fully persisted, ingestion writes one `app_meta` row
 * keyed by corpus name + version. Its presence is the fast, authoritative
 * "this corpus is already ingested" signal that makes repeated ingestion
 * idempotent without re-reading every table. Row-level idempotency
 * (deterministic content-addressed IDs) is still enforced independently
 * in src/lib/ingestion/persist.ts, so a marker that is somehow missing
 * after a partial run does not cause duplicate rows on retry.
 *
 * `ingestedAt` is the wall-clock time the ingest action ran — operational
 * metadata, not corpus data. Every actual evidence row's timestamps are
 * deterministic (fixed corpus instant).
 */

export interface IngestionMarker {
  corpusName: string;
  corpusVersion: string;
  fingerprint: string;
  ingestedAt: string;
  counts: EvidenceCounts;
}

export function ingestionMarkerKey(name: string, version: string): string {
  return `ingest:${name}@${version}`;
}

export async function getIngestionMarker(
  key: string,
): Promise<IngestionMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "counts" in parsed &&
      "ingestedAt" in parsed
    ) {
      return parsed as IngestionMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setIngestionMarker(
  key: string,
  marker: IngestionMarker,
): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
