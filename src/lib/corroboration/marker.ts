import { getAppMeta, setAppMeta } from "@/lib/db/repository";

import type { CorroborationCounts } from "./types";

/**
 * The corroboration synthesis completion marker, mirroring
 * src/lib/analytics/marker.ts. Keyed by investigation id AND graph
 * version, so re-running graph synthesis (which produces a new graph
 * version) correctly triggers fresh corroboration rather than reporting
 * a stale "already analyzed" against a graph state that no longer
 * exists. Informational only — idempotency itself comes from row-level
 * deterministic-id skipping in ./persist.ts, not from this marker.
 */

export interface CorroborationMarker {
  investigationId: string;
  graphVersion: string;
  analyzedAt: string;
  counts: CorroborationCounts;
}

export function corroborationMarkerKey(investigationId: string, graphVersion: string): string {
  return `corroboration:${investigationId}:${graphVersion}`;
}

export async function getCorroborationMarker(key: string): Promise<CorroborationMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "counts" in parsed && "analyzedAt" in parsed) {
      return parsed as CorroborationMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setCorroborationMarker(key: string, marker: CorroborationMarker): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
