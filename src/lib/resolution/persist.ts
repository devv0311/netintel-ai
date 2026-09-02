import {
  insertAlias,
  insertEntity,
  insertResolutionDecision,
  listAliases,
  listEntities,
  listResolutionDecisions,
} from "@/lib/db/repository";
import type { Alias, Entity } from "@/lib/domain/entity";
import type { ResolutionDecision } from "@/lib/domain/resolution";

import { ResolutionServiceError } from "./errors";
import type { ResolutionPersisted } from "./types";

/**
 * Idempotent persistence through the validated repository layer ONLY,
 * mirroring src/lib/extraction/persist.ts. Every id (entity, alias,
 * decision) is content-addressed, so:
 *
 *   - first resolution  → everything created
 *   - repeat resolution → everything already exists → all skipped
 *   - partial-failure retry → only the missing rows are inserted
 */

export interface PersistProgress {
  label: string;
  done: number;
  total: number;
}

export async function idempotentPersistResolution(
  entities: Entity[],
  aliases: Alias[],
  decisions: ResolutionDecision[],
  onProgress?: (p: PersistProgress) => void,
): Promise<ResolutionPersisted> {
  const [existingEntities, existingAliases, existingDecisions] = await Promise.all([
    listEntities(),
    listAliases(),
    listResolutionDecisions(),
  ]);
  const existingEntityIds = new Set(existingEntities.map((e) => e.id));
  const existingAliasIds = new Set(existingAliases.map((a) => a.id));
  const existingDecisionIds = new Set(existingDecisions.map((d) => d.id));

  const total = entities.length + aliases.length + decisions.length;
  let done = 0;
  const result: ResolutionPersisted = {
    entitiesCreated: 0,
    entitiesSkipped: 0,
    aliasesCreated: 0,
    aliasesSkipped: 0,
    decisionsCreated: 0,
    decisionsSkipped: 0,
  };

  try {
    // Entities first (aliases and decisions reference them by id).
    for (const e of entities) {
      if (existingEntityIds.has(e.id)) result.entitiesSkipped += 1;
      else {
        await insertEntity(e);
        result.entitiesCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "entities", done, total });
    }
    for (const a of aliases) {
      if (existingAliasIds.has(a.id)) result.aliasesSkipped += 1;
      else {
        await insertAlias(a);
        result.aliasesCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "aliases", done, total });
    }
    for (const d of decisions) {
      if (existingDecisionIds.has(d.id)) result.decisionsSkipped += 1;
      else {
        await insertResolutionDecision(d);
        result.decisionsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "resolution decisions", done, total });
    }
  } catch (err) {
    console.error("[resolution] persistence failure", err);
    throw new ResolutionServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing resolution output to the investigation store failed. The store may be left partially populated; re-run resolution to finish it — already-written rows are skipped.",
    );
  }

  return result;
}
