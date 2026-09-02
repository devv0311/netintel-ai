import { listEvidenceItems, listInvestigations } from "@/lib/db/repository";
import type { EvidenceItem } from "@/lib/domain/evidence";
import type { ExtractedRecord } from "@/lib/domain/extraction";

import { buildCandidatesForItem, UnsupportedEvidenceTypeError, type ExtractedRecordCandidate } from "./extract";
import { ExtractionServiceError, toInternalError } from "./errors";
import { extractionMarkerKey, getExtractionMarker, setExtractionMarker } from "./marker";
import { idempotentPersistExtractedRecords } from "./persist";
import type {
  ExtractionCounts,
  ExtractionEvent,
  ExtractionResult,
  ExtractionStage,
  StageReport,
} from "./types";
import { assertProvenance, validateCandidates } from "./verify";

/**
 * The evidence extraction service.
 *
 * `runExtraction` executes the 7-stage pipeline described in
 * docs/data/extraction.md and returns a structured ExtractionResult. It
 * never throws for an expected failure — no investigation loaded, an
 * unsupported evidence type, a validation failure, a persistence error
 * all come back as `status: "failed"` with a user-safe `error`.
 * `onEvent`, when given, receives the same stage reports live (used by
 * the streaming route handler); the returned result is the source of
 * truth either way.
 *
 * Extraction reads only already-persisted application evidence (via
 * src/lib/db/repository.ts) — no file, no upload, no Anthropic call, no
 * external service. It never reads evidence/ground-truth/.
 */

type EventSink = (event: ExtractionEvent) => void;

function countsFrom(
  records: ReadonlyArray<{ recordType: string }>,
  evidenceItemsConsidered: number,
  evidenceItemsExtracted: number,
): ExtractionCounts {
  const recordsByType: Record<string, number> = {};
  for (const r of records) recordsByType[r.recordType] = (recordsByType[r.recordType] ?? 0) + 1;
  return { evidenceItemsConsidered, evidenceItemsExtracted, recordsByType };
}

export async function runExtraction(onEvent?: EventSink): Promise<ExtractionResult> {
  const startedAt = new Date().toISOString();
  // One wall-clock instant for the whole run: every record this run
  // produces shares the same provenance.timestamp, distinct from any
  // in-evidence event timestamp (docs/requirements.md §8).
  const extractedAt = startedAt;
  const stages: StageReport[] = [];

  const runStage = async <T>(
    stage: ExtractionStage,
    detailWhenOk: (value: T) => string,
    fn: () => T | Promise<T>,
  ): Promise<T> => {
    const stageStart = Date.now();
    const report: StageReport = {
      stage,
      status: "running",
      detail: "",
      startedAt: new Date().toISOString(),
    };
    stages.push(report);
    onEvent?.({ type: "stage", report: { ...report } });
    try {
      const value = await fn();
      report.status = "ok";
      report.detail = detailWhenOk(value);
      report.finishedAt = new Date().toISOString();
      report.durationMs = Date.now() - stageStart;
      onEvent?.({ type: "stage", report: { ...report } });
      return value;
    } catch (err) {
      report.status = "failed";
      report.finishedAt = new Date().toISOString();
      report.durationMs = Date.now() - stageStart;
      report.detail =
        err instanceof ExtractionServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  try {
    const investigations = await listInvestigations();
    const investigation = investigations[0];
    if (!investigation) {
      throw new ExtractionServiceError(
        "NO_INVESTIGATION",
        "select_evidence",
        "No investigation is loaded. Ingest evidence before running extraction.",
      );
    }

    const allItems = await listEvidenceItems();

    const items = await runStage<EvidenceItem[]>(
      "select_evidence",
      (its) =>
        `${its.length} of ${allItems.length} evidence items are accepted and extractable.`,
      () => allItems.filter((i) => i.validationStatus === "accepted"),
    );

    await runStage<number>(
      "parse_content",
      (n) => `${n} evidence items parsed as well-formed structured content.`,
      () => {
        for (const item of items) {
          if (!item.content || typeof item.content !== "object" || Array.isArray(item.content)) {
            throw new ExtractionServiceError(
              "VALIDATION_FAILURE",
              "parse_content",
              "One or more evidence items have malformed content and cannot be parsed.",
              [`evidence item ${item.id}: content is not a structured object`],
            );
          }
        }
        return items.length;
      },
    );

    const { candidates, warnings, itemsExtracted } = await runStage<{
      candidates: ExtractedRecordCandidate[];
      warnings: string[];
      itemsExtracted: number;
    }>(
      "extract_facts",
      (r) => `${r.candidates.length} explicit facts extracted from ${r.itemsExtracted} evidence items.`,
      () => {
        const allCandidates: ExtractedRecordCandidate[] = [];
        const warn: string[] = [];
        let extractedCount = 0;
        for (const item of items) {
          let itemCandidates: ExtractedRecordCandidate[];
          try {
            itemCandidates = buildCandidatesForItem(item, extractedAt);
          } catch (err) {
            if (err instanceof UnsupportedEvidenceTypeError) {
              throw new ExtractionServiceError(
                "UNSUPPORTED_EVIDENCE_TYPE",
                "extract_facts",
                `Evidence item type "${err.itemType}" is not supported by extraction.`,
                [`evidence item ${item.id} has unsupported itemType "${err.itemType}"`],
              );
            }
            throw err;
          }
          if (itemCandidates.length === 0) {
            warn.push(`evidence item ${item.id} (${item.itemType}) yielded no explicit facts`);
          } else {
            extractedCount += 1;
          }
          allCandidates.push(...itemCandidates);
        }
        return { candidates: allCandidates, warnings: warn, itemsExtracted: extractedCount };
      },
    );

    const records = await runStage<ExtractedRecord[]>(
      "validate_records",
      (rs) => `${rs.length} extracted records passed schema validation.`,
      () => validateCandidates(candidates),
    );

    await runStage<number>(
      "attach_provenance",
      (n) =>
        `${n} extracted records carry full provenance tracing to a source evidence item, each classified "observed_fact".`,
      () => assertProvenance(records, allItems),
    );

    const markerKey = extractionMarkerKey(investigation.id);
    const existingMarker = await getExtractionMarker(markerKey);

    const persisted = await runStage(
      "persistence",
      (p) => `${p.created} new extracted records written, ${p.skipped} already present (idempotent).`,
      () =>
        idempotentPersistExtractedRecords(records, (progress) =>
          onEvent?.({
            type: "persist_progress",
            label: progress.label,
            done: progress.done,
            total: progress.total,
          }),
        ),
    );

    const status: ExtractionResult["status"] =
      persisted.created === 0 && existingMarker ? "already_extracted" : "extracted";
    const counts = countsFrom(records, items.length, itemsExtracted);

    await setExtractionMarker(markerKey, {
      investigationId: investigation.id,
      extractedAt,
      counts,
    });

    const result: ExtractionResult = await runStage(
      "result",
      () => "Extraction result assembled.",
      (): ExtractionResult => ({
        status,
        investigationId: investigation.id,
        counts,
        persisted,
        warnings,
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );

    onEvent?.({ type: "result", result });
    return result;
  } catch (err) {
    const lastStage = stages[stages.length - 1]?.stage ?? "select_evidence";
    const error =
      err instanceof ExtractionServiceError
        ? err.toExtractionError()
        : (console.error("[extraction] unexpected error", err), toInternalError(lastStage));

    const result: ExtractionResult = {
      status: "failed",
      investigationId: null,
      counts: null,
      persisted: null,
      warnings: [],
      stages,
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    onEvent?.({ type: "result", result });
    return result;
  }
}
