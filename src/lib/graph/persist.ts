import {
  insertCommunicationEvent,
  insertFinancialTransaction,
  insertLocation,
  insertRelationship,
  listCommunicationEvents,
  listFinancialTransactions,
  listLocations,
  listRelationships,
} from "@/lib/db/repository";
import type { CommunicationEvent, FinancialTransaction } from "@/lib/domain/events";
import type { Location } from "@/lib/domain/location";
import type { Relationship } from "@/lib/domain/relationship";

import { GraphServiceError } from "./errors";
import type { GraphPersisted } from "./types";

/**
 * Idempotent persistence through the validated repository layer ONLY,
 * mirroring src/lib/resolution/persist.ts. Every id (location,
 * communication event, financial transaction, relationship) is
 * content-addressed, so:
 *
 *   - first synthesis  → everything created
 *   - repeat synthesis → everything already exists → all skipped
 *   - partial-failure retry → only the missing rows are inserted
 *
 * Order matters: locations are written first (relationships/
 * communication events may reference them), then communication events
 * and financial transactions, then relationships.
 */

export interface PersistProgress {
  label: string;
  done: number;
  total: number;
}

export async function idempotentPersistGraph(
  locations: Location[],
  communicationEvents: CommunicationEvent[],
  financialTransactions: FinancialTransaction[],
  relationships: Relationship[],
  onProgress?: (p: PersistProgress) => void,
): Promise<GraphPersisted> {
  const [existingLocations, existingComms, existingTxns, existingRels] = await Promise.all([
    listLocations(),
    listCommunicationEvents(),
    listFinancialTransactions(),
    listRelationships(),
  ]);
  const existingLocationIds = new Set(existingLocations.map((l) => l.id));
  const existingCommIds = new Set(existingComms.map((c) => c.id));
  const existingTxnIds = new Set(existingTxns.map((t) => t.id));
  const existingRelIds = new Set(existingRels.map((r) => r.id));

  const total = locations.length + communicationEvents.length + financialTransactions.length + relationships.length;
  let done = 0;
  const result: GraphPersisted = {
    locationsCreated: 0,
    locationsSkipped: 0,
    communicationEventsCreated: 0,
    communicationEventsSkipped: 0,
    financialTransactionsCreated: 0,
    financialTransactionsSkipped: 0,
    relationshipsCreated: 0,
    relationshipsSkipped: 0,
  };

  try {
    for (const l of locations) {
      if (existingLocationIds.has(l.id)) result.locationsSkipped += 1;
      else {
        await insertLocation(l);
        result.locationsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "locations", done, total });
    }
    for (const c of communicationEvents) {
      if (existingCommIds.has(c.id)) result.communicationEventsSkipped += 1;
      else {
        await insertCommunicationEvent(c);
        result.communicationEventsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "communication events", done, total });
    }
    for (const t of financialTransactions) {
      if (existingTxnIds.has(t.id)) result.financialTransactionsSkipped += 1;
      else {
        await insertFinancialTransaction(t);
        result.financialTransactionsCreated += 1;
      }
      done += 1;
      if (done === total || done % 200 === 0) onProgress?.({ label: "financial transactions", done, total });
    }
    for (const r of relationships) {
      if (existingRelIds.has(r.id)) result.relationshipsSkipped += 1;
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
      "Writing graph output to the investigation store failed. The store may be left partially populated; re-run graph synthesis to finish it — already-written rows are skipped.",
    );
  }

  return result;
}
