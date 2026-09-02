import { insertCorroborationFinding, listCorroborationFindings } from "@/lib/db/repository";
import type { CorroborationFinding } from "@/lib/domain/corroboration";

import { CorroborationServiceError } from "./errors";
import type { CorroborationPersisted } from "./types";

/**
 * Idempotent persistence through the validated repository layer ONLY,
 * mirroring src/lib/analytics/persist.ts. Every finding id is content-
 * addressed (including the graph version it was computed against), so:
 *
 *   - first run against a graph version -> every finding created
 *   - repeat run against the SAME graph version -> every id already
 *     exists -> all skipped
 *   - partial-failure retry -> only the missing rows are inserted
 *   - a NEW graph version -> different finding ids, so stale
 *     corroboration never silently shadows a changed graph
 */

export interface PersistProgress {
  label: string;
  done: number;
  total: number;
}

export async function idempotentPersistCorroboration(
  findings: CorroborationFinding[],
  onProgress?: (p: PersistProgress) => void,
): Promise<CorroborationPersisted> {
  const existing = await listCorroborationFindings();
  const existingIds = new Set(existing.map((f) => f.id));

  const total = findings.length;
  let done = 0;
  const result: CorroborationPersisted = { findingsCreated: 0, findingsSkipped: 0 };

  try {
    for (const f of findings) {
      if (existingIds.has(f.id)) result.findingsSkipped += 1;
      else {
        await insertCorroborationFinding(f);
        result.findingsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "corroboration findings", done, total });
    }
  } catch (err) {
    console.error("[corroboration] persistence failure", err);
    throw new CorroborationServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing corroboration findings to the investigation store failed. The store may be left partially populated; re-run corroboration to finish it — already-written rows are skipped.",
    );
  }

  return result;
}
