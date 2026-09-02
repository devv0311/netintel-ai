import { listExtractedRecords, insertExtractedRecord } from "@/lib/db/repository";
import type { ExtractedRecord } from "@/lib/domain/extraction";

import { ExtractionServiceError } from "./errors";

/**
 * Stage 6: idempotent persistence through the validated repository layer
 * ONLY (every insert still runs `validateOrThrow`), mirroring
 * src/lib/ingestion/persist.ts. Every extracted record id is
 * content-addressed (deterministic per evidence item + field), so:
 *
 *   - first extraction  → every record is new  → all created
 *   - repeat extraction → every record exists  → all skipped, zero writes
 *   - partial-failure retry → only the missing records are inserted
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

export async function idempotentPersistExtractedRecords(
  records: ExtractedRecord[],
  onProgress?: (p: PersistProgress) => void,
): Promise<PersistOutcome> {
  const existing = new Set((await listExtractedRecords()).map((r) => r.id));
  const total = records.length;
  let created = 0;
  let skipped = 0;
  let done = 0;

  try {
    for (const record of records) {
      if (existing.has(record.id)) {
        skipped += 1;
      } else {
        await insertExtractedRecord(record);
        created += 1;
      }
      done += 1;
      if (done === total || done % 100 === 0) {
        onProgress?.({ label: "extracted records", done, total });
      }
    }
  } catch (err) {
    // Log the real cause server-side; never surface a raw driver message
    // (it can carry a filesystem path) to the client.
    console.error("[extraction] persistence failure", err);
    throw new ExtractionServiceError(
      "PERSISTENCE_FAILURE",
      "persistence",
      "Writing extracted records to the investigation store failed. The store may be left partially populated; re-run extraction to finish it — already-written records are skipped.",
    );
  }

  return { created, skipped };
}
