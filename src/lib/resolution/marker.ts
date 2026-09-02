import { getAppMeta, setAppMeta } from "@/lib/db/repository";

import type { ResolutionCounts } from "./types";

/**
 * The resolution completion marker, mirroring
 * src/lib/extraction/marker.ts. Keyed by investigation id. Informational
 * only — idempotency itself comes from row-level deterministic-id
 * skipping in ./persist.ts, not from this marker.
 */

export interface ResolutionMarker {
  investigationId: string;
  resolvedAt: string;
  counts: ResolutionCounts;
}

export function resolutionMarkerKey(investigationId: string): string {
  return `resolve:${investigationId}`;
}

export async function getResolutionMarker(key: string): Promise<ResolutionMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "counts" in parsed && "resolvedAt" in parsed) {
      return parsed as ResolutionMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setResolutionMarker(key: string, marker: ResolutionMarker): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
