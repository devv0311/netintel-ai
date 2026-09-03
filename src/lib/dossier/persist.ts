import { getDossierById, insertDossier } from "@/lib/db/repository";
import type { Dossier } from "@/lib/domain/dossier";

import { DossierServiceError } from "./errors";
import type { DossierPersisted } from "./types";

/**
 * Idempotent persistence through the validated repository layer ONLY,
 * mirroring src/lib/corroboration/persist.ts.
 *
 * The dossier id is content-addressed over the report body (including
 * the graph version it describes), so:
 *
 *   - first generation for a case state  -> the row is created
 *   - regeneration with nothing changed  -> the id already exists, so
 *     the existing report is reused and nothing is written
 *   - a NEW graph version, or any real change upstream -> a different
 *     digest, so a different id, so a new report rather than a silent
 *     overwrite of one that described a state that no longer exists
 *
 * Reports are never updated in place. A dossier is a point-in-time
 * statement about a case; rewriting one would destroy the record of
 * what was reported when.
 */
export async function idempotentPersistDossier(dossier: Dossier): Promise<DossierPersisted> {
  try {
    const existing = await getDossierById(dossier.id);
    if (existing) return { created: 0, skipped: 1 };
    await insertDossier(dossier);
    return { created: 1, skipped: 0 };
  } catch (err) {
    console.error("[dossier] persistence failure", err);
    throw new DossierServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing the dossier to the investigation store failed. Nothing partial was written; re-run generation to retry.",
    );
  }
}
