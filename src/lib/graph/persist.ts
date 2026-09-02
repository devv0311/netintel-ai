import { insertRelationship, listRelationships } from "@/lib/db/repository";
import type { Relationship } from "@/lib/domain/relationship";

import { GraphServiceError } from "./errors";
import type { GraphPersisted } from "./types";

/**
 * Idempotent persistence through the validated repository layer ONLY,
 * mirroring src/lib/resolution/persist.ts. Every relationship id is
 * content-addressed, so:
 *
 *   - first synthesis  → every new edge created
 *   - repeat synthesis → every edge already exists → all skipped
 *   - partial-failure retry → only the missing rows are inserted
 *
 * `relationships` is the only table this milestone writes —
 * locations/communication_events/financial_transactions are P5.2
 * ingestion's rows and are never touched here.
 */

export interface PersistProgress {
  label: string;
  done: number;
  total: number;
}

export async function idempotentPersistGraph(
  relationships: Relationship[],
  onProgress?: (p: PersistProgress) => void,
): Promise<GraphPersisted> {
  const existing = await listRelationships();
  const existingIds = new Set(existing.map((r) => r.id));

  const total = relationships.length;
  let done = 0;
  const result: GraphPersisted = { relationshipsCreated: 0, relationshipsSkipped: 0 };

  try {
    for (const r of relationships) {
      if (existingIds.has(r.id)) result.relationshipsSkipped += 1;
      else {
        await insertRelationship(r);
        result.relationshipsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "relationships", done, total });
    }
  } catch (err) {
    console.error("[graph] persistence failure", err);
    throw new GraphServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing graph relationships to the investigation store failed. The store may be left partially populated; re-run graph synthesis to finish it — already-written rows are skipped.",
    );
  }

  return result;
}
