import { fingerprint } from "@/lib/corpus/canonicalize";
import type { LoadedCorpus } from "@/lib/corpus/load";
import type { CorpusManifest } from "@/lib/corpus/manifest-schema";

import { IngestionServiceError, toInternalError } from "./errors";
import {
  assertDeterministicIds,
  assertProvenance,
  normalizeCorpus,
  validateCorpusSchema,
} from "./normalize";
import { resolveSource } from "./source";
import { idempotentPersist } from "./persist";
import {
  getIngestionMarker,
  ingestionMarkerKey,
  setIngestionMarker,
} from "./marker";
import {
  listEvidenceItems,
  listEvidenceSources,
  listCommunicationEvents,
  listFinancialTransactions,
  listLocations,
} from "@/lib/db/repository";
import type {
  EvidenceCounts,
  IngestionEvent,
  IngestionResult,
  IngestionSourceInput,
  IngestionStage,
  StageReport,
} from "./types";

/**
 * The evidence ingestion service.
 *
 * `runIngestion` executes the 8-stage pipeline and returns a structured
 * IngestionResult. It never throws for expected failures — a malformed
 * corpus, a rejected ground-truth file, a persistence error all come
 * back as `status: "failed"` with a user-safe `error`. `onEvent`, when
 * given, receives the same stage reports live (used by the streaming
 * route handler); the returned result is the source of truth either way.
 *
 * No Anthropic call. No external service. Local SQLite + a local JSON
 * file only.
 */

type EventSink = (event: IngestionEvent) => void;

function countsFromLoaded(loaded: LoadedCorpus): EvidenceCounts {
  const evidenceItemsByType: Record<string, number> = {};
  for (const item of loaded.evidenceItems) {
    evidenceItemsByType[item.itemType] = (evidenceItemsByType[item.itemType] ?? 0) + 1;
  }
  return {
    evidenceSources: loaded.evidenceSources.length,
    evidenceItems: loaded.evidenceItems.length,
    communications: loaded.communicationEvents.length,
    financialTransactions: loaded.financialTransactions.length,
    locations: loaded.locations.length,
    evidenceItemsByType,
  };
}

async function countsFromDb(): Promise<EvidenceCounts> {
  const [items, sources, comms, txns, locations] = await Promise.all([
    listEvidenceItems(),
    listEvidenceSources(),
    listCommunicationEvents(),
    listFinancialTransactions(),
    listLocations(),
  ]);
  const evidenceItemsByType: Record<string, number> = {};
  for (const item of items) {
    evidenceItemsByType[item.itemType] = (evidenceItemsByType[item.itemType] ?? 0) + 1;
  }
  return {
    evidenceSources: sources.length,
    evidenceItems: items.length,
    communications: comms.length,
    financialTransactions: txns.length,
    locations: locations.length,
    evidenceItemsByType,
  };
}

export async function runIngestion(
  input: IngestionSourceInput,
  onEvent?: EventSink,
): Promise<IngestionResult> {
  const startedAt = new Date().toISOString();
  const stages: StageReport[] = [];

  const runStage = async <T>(
    stage: IngestionStage,
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
        err instanceof IngestionServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  const markStageSkipped = (stage: IngestionStage, detail: string) => {
    const report: StageReport = {
      stage,
      status: "skipped",
      detail,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      durationMs: 0,
    };
    stages.push(report);
    onEvent?.({ type: "stage", report: { ...report } });
  };

  try {
    const resolved = await runStage(
      "input",
      (r) => `Source: ${r.label}`,
      () => resolveSource(input),
    );

    // resolveSource already read + parsed + shape-checked the file.
    await runStage(
      "file_validation",
      () => "Evidence file is readable JSON with a corpus manifest shape.",
      () => resolved.raw,
    );

    const manifest = await runStage<CorpusManifest>(
      "schema_validation",
      (m) =>
        `Corpus "${m.corpus.name}" v${m.corpus.version}: ${m.evidenceItems.length} evidence items, ${m.evidenceSources.length} sources.`,
      () => validateCorpusSchema(resolved.raw),
    );

    const corpusFingerprint = fingerprint(manifest);

    const loaded = await runStage<LoadedCorpus>(
      "normalization",
      (l) =>
        `Normalized ${l.evidenceItems.length} items, ${l.communicationEvents.length} communications, ${l.financialTransactions.length} transactions, ${l.locations.length} locations.`,
      () => normalizeCorpus(manifest),
    );

    await runStage(
      "id_assignment",
      (n) => `${n} deterministic content-addressed IDs assigned; no collisions.`,
      () => assertDeterministicIds(loaded),
    );

    await runStage(
      "provenance",
      (n) => `${n} structured rows carry full provenance tracing to a source evidence item.`,
      () => assertProvenance(loaded),
    );

    const markerKey = ingestionMarkerKey(manifest.corpus.name, manifest.corpus.version);
    const existingMarker = await getIngestionMarker(markerKey);

    let persisted: { created: number; skipped: number } | null = null;
    let status: IngestionResult["status"] = "ingested";
    let counts: EvidenceCounts;

    if (existingMarker) {
      status = "already_ingested";
      markStageSkipped(
        "persistence",
        `Corpus v${manifest.corpus.version} already ingested at ${existingMarker.ingestedAt}. No records written.`,
      );
      counts = await countsFromDb();
    } else {
      persisted = await runStage(
        "persistence",
        (p) =>
          `${p.created} new records written, ${p.skipped} already present (idempotent).`,
        () =>
          idempotentPersist(loaded, (progress) =>
            onEvent?.({
              type: "persist_progress",
              label: progress.label,
              done: progress.done,
              total: progress.total,
            }),
          ),
      );
      counts = countsFromLoaded(loaded);
      await setIngestionMarker(markerKey, {
        corpusName: manifest.corpus.name,
        corpusVersion: manifest.corpus.version,
        fingerprint: corpusFingerprint,
        ingestedAt: new Date().toISOString(),
        counts,
      });
      if (persisted.created === 0) status = "already_ingested";
    }

    const result: IngestionResult = await runStage(
      "result",
      () => "Ingestion result assembled.",
      (): IngestionResult => ({
        status,
        corpus: {
          name: manifest.corpus.name,
          version: manifest.corpus.version,
          fingerprint: corpusFingerprint,
        },
        investigationId: loaded.investigation.id,
        counts,
        persisted,
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );

    onEvent?.({ type: "result", result });
    return result;
  } catch (err) {
    const lastStage = stages[stages.length - 1]?.stage ?? "input";
    const error =
      err instanceof IngestionServiceError
        ? err.toIngestionError()
        : (console.error("[ingestion] unexpected error", err), toInternalError(lastStage));

    const result: IngestionResult = {
      status: "failed",
      corpus: null,
      investigationId: null,
      counts: null,
      persisted: null,
      stages,
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    onEvent?.({ type: "result", result });
    return result;
  }
}
