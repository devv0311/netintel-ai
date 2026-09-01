import {
  listInvestigations,
  listEvidenceSources,
  listEvidenceItems,
  listLocations,
  listCommunicationEvents,
  listFinancialTransactions,
  insertInvestigation,
  insertEvidenceSource,
  insertEvidenceItem,
  insertLocation,
  insertCommunicationEvent,
  insertFinancialTransaction,
} from "@/lib/db/repository";
import type { LoadedCorpus } from "@/lib/corpus/load";

import { IngestionServiceError } from "./errors";

/**
 * Stage 7: idempotent persistence through the validated repository layer
 * ONLY (every insert still runs `validateOrThrow`). No Drizzle, schema,
 * or client access here.
 *
 * Idempotency does not depend on the completion marker: before inserting,
 * we load the ids already present in each table and skip any row whose
 * deterministic id is already there. So:
 *   - first ingestion  → every row is new  → all created
 *   - repeat ingestion → every row exists  → all skipped, zero writes
 *   - partial-failure retry → only the missing rows are inserted
 */

export interface PersistProgress {
  label: string;
  done: number;
  total: number;
}

export interface PersistOutcome {
  created: number;
  skipped: number;
}

export async function idempotentPersist(
  loaded: LoadedCorpus,
  onProgress?: (p: PersistProgress) => void,
): Promise<PersistOutcome> {
  const [investigations, sources, items, locations, comms, txns] = await Promise.all([
    listInvestigations(),
    listEvidenceSources(),
    listEvidenceItems(),
    listLocations(),
    listCommunicationEvents(),
    listFinancialTransactions(),
  ]);

  const existing = {
    investigations: new Set(investigations.map((r) => r.id)),
    sources: new Set(sources.map((r) => r.id)),
    items: new Set(items.map((r) => r.id)),
    locations: new Set(locations.map((r) => r.id)),
    comms: new Set(comms.map((r) => r.id)),
    txns: new Set(txns.map((r) => r.id)),
  };

  const total =
    1 +
    loaded.evidenceSources.length +
    loaded.evidenceItems.length +
    loaded.locations.length +
    loaded.communicationEvents.length +
    loaded.financialTransactions.length;

  let created = 0;
  let skipped = 0;
  let done = 0;

  const step = async <T>(
    rows: T[],
    seen: Set<string>,
    idOf: (row: T) => string,
    insert: (row: T) => Promise<unknown>,
    label: string,
  ) => {
    for (const row of rows) {
      if (seen.has(idOf(row))) {
        skipped += 1;
      } else {
        await insert(row);
        created += 1;
      }
      done += 1;
    }
    onProgress?.({ label, done, total });
  };

  try {
    await step(
      [loaded.investigation],
      existing.investigations,
      (r) => r.id,
      (r) => insertInvestigation(r),
      "investigation",
    );
    await step(loaded.evidenceSources, existing.sources, (r) => r.id, (r) => insertEvidenceSource(r), "evidence sources");
    await step(loaded.evidenceItems, existing.items, (r) => r.id, (r) => insertEvidenceItem(r), "evidence items");
    await step(loaded.locations, existing.locations, (r) => r.id, (r) => insertLocation(r), "locations");
    await step(loaded.communicationEvents, existing.comms, (r) => r.id, (r) => insertCommunicationEvent(r), "communication events");
    await step(
      loaded.financialTransactions,
      existing.txns,
      (r) => r.id,
      (r) => insertFinancialTransaction(r),
      "financial transactions",
    );
  } catch (err) {
    // Log the real cause server-side; never surface a raw driver message
    // (it can carry a filesystem path) to the client.
    console.error("[ingestion] persistence failure", err);
    throw new IngestionServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing evidence to the investigation store failed. The store may be left partially populated; re-run ingestion to finish it — already-written rows are skipped.",
    );
  }

  return { created, skipped };
}
