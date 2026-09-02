import { insertAnalyticalSignal, listAnalyticalSignals } from "@/lib/db/repository";
import type { AnalyticalSignal } from "@/lib/domain/derived";

import { AnalyticsServiceError } from "./errors";
import type { AnalyticsPersisted } from "./types";

/**
 * Idempotent persistence through the validated repository layer ONLY,
 * mirroring src/lib/graph/persist.ts. Every signal id is content-
 * addressed (including the graph version it was computed against), so:
 *
 *   - first analysis of a given graph version -> every signal created
 *   - repeat run against the SAME graph version -> every id already
 *     exists -> all skipped
 *   - partial-failure retry -> only the missing rows are inserted
 *   - a NEW graph version (re-synthesizing the graph) naturally
 *     produces different signal ids, so stale analytics never silently
 *     shadow a changed graph
 */

export interface PersistProgress {
  label: string;
  done: number;
  total: number;
}

export async function idempotentPersistAnalytics(
  signals: AnalyticalSignal[],
  onProgress?: (p: PersistProgress) => void,
): Promise<AnalyticsPersisted> {
  const existing = await listAnalyticalSignals();
  const existingIds = new Set(existing.map((s) => s.id));

  const total = signals.length;
  let done = 0;
  const result: AnalyticsPersisted = { signalsCreated: 0, signalsSkipped: 0 };

  try {
    for (const s of signals) {
      if (existingIds.has(s.id)) result.signalsSkipped += 1;
      else {
        await insertAnalyticalSignal(s);
        result.signalsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "analytical signals", done, total });
    }
  } catch (err) {
    console.error("[analytics] persistence failure", err);
    throw new AnalyticsServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing analytical signals to the investigation store failed. The store may be left partially populated; re-run analytics to finish it — already-written rows are skipped.",
    );
  }

  return result;
}
