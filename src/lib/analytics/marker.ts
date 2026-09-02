import { getAppMeta, setAppMeta } from "@/lib/db/repository";

import type { AnalyticsCounts } from "./types";

/**
 * The analytics synthesis completion marker, mirroring
 * src/lib/graph/marker.ts. Keyed by investigation id AND graph version,
 * so re-running graph synthesis (which produces a new graph version)
 * correctly triggers fresh analytics rather than reporting a stale
 * "already analyzed" against a graph state that no longer exists.
 * Informational only — idempotency itself comes from row-level
 * deterministic-id skipping in ./persist.ts, not from this marker.
 */

export interface AnalyticsMarker {
  investigationId: string;
  graphVersion: string;
  analyzedAt: string;
  counts: AnalyticsCounts;
}

export function analyticsMarkerKey(investigationId: string, graphVersion: string): string {
  return `analytics:${investigationId}:${graphVersion}`;
}

export async function getAnalyticsMarker(key: string): Promise<AnalyticsMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "counts" in parsed && "analyzedAt" in parsed) {
      return parsed as AnalyticsMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setAnalyticsMarker(key: string, marker: AnalyticsMarker): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
