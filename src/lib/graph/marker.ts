import { getAppMeta, setAppMeta } from "@/lib/db/repository";

import type { GraphCounts } from "./types";

/**
 * The graph synthesis completion marker, mirroring
 * src/lib/resolution/marker.ts. Keyed by investigation id. Informational
 * only — idempotency itself comes from row-level deterministic-id
 * skipping in ./persist.ts, not from this marker.
 */

export interface GraphMarker {
  investigationId: string;
  synthesizedAt: string;
  counts: GraphCounts;
}

export function graphMarkerKey(investigationId: string): string {
  return `graph:${investigationId}`;
}

export async function getGraphMarker(key: string): Promise<GraphMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "counts" in parsed && "synthesizedAt" in parsed) {
      return parsed as GraphMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setGraphMarker(key: string, marker: GraphMarker): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
