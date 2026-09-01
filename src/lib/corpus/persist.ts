import {
  insertInvestigation,
  insertEvidenceSource,
  insertEvidenceItem,
  insertLocation,
  insertCommunicationEvent,
  insertFinancialTransaction,
} from "@/lib/db/repository";

import type { LoadedCorpus } from "./load";

/**
 * Persists a loaded corpus into the database through the validated
 * repository layer ONLY (src/lib/db/repository.ts). It does not touch
 * Drizzle, the schema, or the client directly, so every row is
 * Zod-validated and provenance-checked on the way in, per
 * docs/architecture/stack-contract.md hard constraint #3.
 *
 * No entity resolution, extraction, or graph work happens here — the
 * corpus is loaded as raw application evidence plus the structured
 * observational rows (locations, communication events, financial
 * transactions) the P4.2 schema defines for the full dataset. Entity
 * foreign keys on those rows are intentionally left unresolved.
 */

export interface CorpusPersistCounts {
  investigations: number;
  evidenceSources: number;
  evidenceItems: number;
  locations: number;
  communicationEvents: number;
  financialTransactions: number;
}

export async function persistCorpus(
  loaded: LoadedCorpus,
): Promise<CorpusPersistCounts> {
  await insertInvestigation(loaded.investigation);

  for (const source of loaded.evidenceSources) {
    await insertEvidenceSource(source);
  }
  for (const item of loaded.evidenceItems) {
    await insertEvidenceItem(item);
  }
  for (const location of loaded.locations) {
    await insertLocation(location);
  }
  for (const event of loaded.communicationEvents) {
    await insertCommunicationEvent(event);
  }
  for (const tx of loaded.financialTransactions) {
    await insertFinancialTransaction(tx);
  }

  return {
    investigations: 1,
    evidenceSources: loaded.evidenceSources.length,
    evidenceItems: loaded.evidenceItems.length,
    locations: loaded.locations.length,
    communicationEvents: loaded.communicationEvents.length,
    financialTransactions: loaded.financialTransactions.length,
  };
}
