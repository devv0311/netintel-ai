import { listExtractedRecords, listInvestigations } from "@/lib/db/repository";
import type { Alias, Entity } from "@/lib/domain/entity";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { ResolutionDecision } from "@/lib/domain/resolution";

import { ResolutionServiceError, toInternalError } from "./errors";
import { resolutionMarkerKey, getResolutionMarker, setResolutionMarker } from "./marker";
import { idempotentPersistResolution } from "./persist";
import { resolveEntities, type ResolutionOutput } from "./resolve";
import type {
  ResolutionCounts,
  ResolutionEvent,
  ResolutionResult,
  ResolutionStage,
  StageReport,
} from "./types";
import { assertProvenance, validateOutputs } from "./verify";

/**
 * The entity resolution service.
 *
 * `runResolution` executes the 8-stage pipeline described in
 * docs/data/resolution.md and returns a structured ResolutionResult. It
 * never throws for an expected failure — no investigation loaded, no
 * extracted records yet, a validation failure, a persistence error all
 * come back as `status: "failed"` with a user-safe `error`.
 *
 * Resolution reads only already-persisted extracted records (via
 * src/lib/db/repository.ts) — no file, no upload, no Anthropic call, no
 * external service, and never evidence/ground-truth/.
 */

type EventSink = (event: ResolutionEvent) => void;

function countsFrom(output: ResolutionOutput, extractedRecordsConsidered: number): ResolutionCounts {
  const entitiesByKind: Record<string, number> = {};
  for (const e of output.entities) entitiesByKind[e.kind] = (entitiesByKind[e.kind] ?? 0) + 1;
  const decisionsByType: Record<string, number> = {};
  for (const d of output.decisions) decisionsByType[d.resolutionType] = (decisionsByType[d.resolutionType] ?? 0) + 1;
  return {
    extractedRecordsConsidered,
    entitiesByKind,
    aliasesCreated: output.aliases.length,
    decisionsByType,
    ambiguousDecisions: output.decisions.filter((d) => d.status === "ambiguous").length,
  };
}

export async function runResolution(onEvent?: EventSink): Promise<ResolutionResult> {
  const startedAt = new Date().toISOString();
  const resolvedAt = startedAt;
  const stages: StageReport[] = [];

  const runStage = async <T>(
    stage: ResolutionStage,
    detailWhenOk: (value: T) => string,
    fn: () => T | Promise<T>,
  ): Promise<T> => {
    const stageStart = Date.now();
    const report: StageReport = { stage, status: "running", detail: "", startedAt: new Date().toISOString() };
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
      report.detail = err instanceof ResolutionServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  try {
    const investigations = await listInvestigations();
    const investigation = investigations[0];
    if (!investigation) {
      throw new ResolutionServiceError(
        "NO_INVESTIGATION",
        "select_records",
        "No investigation is loaded. Ingest and extract evidence before running resolution.",
      );
    }

    const records = await runStage<ExtractedRecord[]>(
      "select_records",
      (rs) => `${rs.length} extracted records selected for resolution.`,
      async () => {
        const all = await listExtractedRecords();
        if (all.length === 0) {
          throw new ResolutionServiceError(
            "NO_EXTRACTED_RECORDS",
            "select_records",
            "No extracted records exist yet. Run extraction before running resolution.",
          );
        }
        return all;
      },
    );

    const output = resolveEntities(records, investigation.id, resolvedAt);

    await runStage<number>(
      "canonicalize_identifiers",
      (n) => `${n} identifier entities canonicalized (phone/IMEI/vehicle/bank account).`,
      () => output.entities.filter((e) => e.kind !== "person").length,
    );

    await runStage<number>(
      "cluster_identities",
      (n) => `${n} person entities established via shared-identifier and exact-name clustering.`,
      () => output.entities.filter((e) => e.kind === "person").length,
    );

    await runStage<number>(
      "resolve_mentions",
      (n) => `${n} resolution decisions made (${output.decisions.filter((d) => d.status === "ambiguous").length} left ambiguous, never force-merged).`,
      () => output.decisions.length,
    );

    const validated = await runStage(
      "validate_decisions",
      (v) => `${v.entities.length} entities, ${v.aliases.length} aliases, ${v.decisions.length} decisions passed schema validation.`,
      () => validateOutputs(output.entities, output.aliases, output.decisions),
    );

    const extractedRecordIds = new Set(records.map((r) => r.id));
    await runStage<number>(
      "attach_provenance",
      (n) => `${n} resolution rows carry full provenance tracing to a real extracted record, each classified "ai_inference".`,
      () => assertProvenance(validated.entities, validated.aliases, validated.decisions, extractedRecordIds),
    );

    const markerKey = resolutionMarkerKey(investigation.id);
    const existingMarker = await getResolutionMarker(markerKey);

    const persisted = await runStage(
      "persistence",
      (p) =>
        `${p.entitiesCreated} entities, ${p.aliasesCreated} aliases, ${p.decisionsCreated} decisions written; ${p.entitiesSkipped + p.aliasesSkipped + p.decisionsSkipped} already present (idempotent).`,
      () =>
        idempotentPersistResolution(validated.entities, validated.aliases, validated.decisions, (progress) =>
          onEvent?.({ type: "persist_progress", label: progress.label, done: progress.done, total: progress.total }),
        ),
    );

    const status: ResolutionResult["status"] =
      persisted.entitiesCreated === 0 &&
      persisted.aliasesCreated === 0 &&
      persisted.decisionsCreated === 0 &&
      existingMarker
        ? "already_resolved"
        : "resolved";
    const counts = countsFrom(output, records.length);

    await setResolutionMarker(markerKey, { investigationId: investigation.id, resolvedAt, counts });

    const result: ResolutionResult = await runStage(
      "result",
      () => "Resolution result assembled.",
      (): ResolutionResult => ({
        status,
        investigationId: investigation.id,
        counts,
        persisted,
        warnings: output.warnings,
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );

    onEvent?.({ type: "result", result });
    return result;
  } catch (err) {
    const lastStage = stages[stages.length - 1]?.stage ?? "select_records";
    const error =
      err instanceof ResolutionServiceError
        ? err.toResolutionError()
        : (console.error("[resolution] unexpected error", err), toInternalError(lastStage));

    const result: ResolutionResult = {
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

export type { Entity, Alias, ResolutionDecision };
