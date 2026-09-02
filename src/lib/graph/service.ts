import {
  listAliases,
  listEntities,
  listExtractedRecords,
  listInvestigations,
  listLocations,
  listRelationships,
  listResolutionDecisions,
} from "@/lib/db/repository";
import type { ExtractedRecord } from "@/lib/domain/extraction";

import { synthesizeGraph, type GraphBuildOutput } from "./build";
import { GraphServiceError, toInternalError } from "./errors";
import { getGraphMarker, graphMarkerKey, setGraphMarker } from "./marker";
import { idempotentPersistGraph } from "./persist";
import { buildGraphFromRows } from "./runtime";
import type { GraphCounts, GraphEvent, GraphResult, GraphStage, StageReport } from "./types";
import { assertProvenance, validateOutputs } from "./verify";

/**
 * The graph synthesis service.
 *
 * `runGraphSynthesis` executes the 10-stage pipeline described in
 * docs/data/graph.md and returns a structured GraphResult. It never
 * throws for an expected failure — no investigation loaded, no resolved
 * entities yet, no extracted records, a validation failure, a
 * persistence error all come back as `status: "failed"` with a
 * user-safe `error`.
 *
 * Graph synthesis reads only already-persisted resolved entities and
 * extracted records (via src/lib/db/repository.ts) — no file, no
 * upload, no Anthropic call, no external service, and never
 * evidence/ground-truth/.
 */

type EventSink = (event: GraphEvent) => void;

function countsFrom(output: GraphBuildOutput, entitiesConsidered: number, extractedRecordsConsidered: number): GraphCounts {
  const locationsByKind: Record<string, number> = {};
  for (const l of output.locations) locationsByKind[l.locationType] = (locationsByKind[l.locationType] ?? 0) + 1;
  const edgesByType: Record<string, number> = {};
  for (const r of output.relationships) edgesByType[r.relationshipType] = (edgesByType[r.relationshipType] ?? 0) + 1;
  return {
    entitiesConsidered,
    extractedRecordsConsidered,
    locationsByKind,
    nodesByKind: {},
    edgesByType,
    communicationEventsLinked: output.communicationEvents.filter((c) => c.callerEntityId && c.calleeEntityId).length,
    financialTransactionsLinked: output.financialTransactions.filter((t) => t.fromAccountEntityId && t.toAccountEntityId).length,
  };
}

export async function runGraphSynthesis(onEvent?: EventSink): Promise<GraphResult> {
  const startedAt = new Date().toISOString();
  const synthesizedAt = startedAt;
  const stages: StageReport[] = [];

  const runStage = async <T>(
    stage: GraphStage,
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
      report.detail = err instanceof GraphServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  try {
    const investigations = await listInvestigations();
    const investigation = investigations[0];
    if (!investigation) {
      throw new GraphServiceError(
        "NO_INVESTIGATION",
        "load_resolved_entities",
        "No investigation is loaded. Ingest, extract, and resolve evidence before running graph synthesis.",
      );
    }

    const { entities, aliases, decisions } = await runStage(
      "load_resolved_entities",
      (v: { entities: unknown[]; aliases: unknown[]; decisions: unknown[] }) =>
        `${v.entities.length} resolved entities, ${v.aliases.length} aliases, ${v.decisions.length} decisions loaded.`,
      async () => {
        const [entities, aliases, decisions] = await Promise.all([listEntities(), listAliases(), listResolutionDecisions()]);
        if (entities.length === 0) {
          throw new GraphServiceError(
            "NO_RESOLVED_ENTITIES",
            "load_resolved_entities",
            "No resolved entities exist yet. Run entity resolution before running graph synthesis.",
          );
        }
        return { entities, aliases, decisions };
      },
    );

    const records = await runStage<ExtractedRecord[]>(
      "load_extracted_records",
      (rs) => `${rs.length} extracted records loaded.`,
      async () => {
        const all = await listExtractedRecords();
        if (all.length === 0) {
          throw new GraphServiceError(
            "NO_EXTRACTED_RECORDS",
            "load_extracted_records",
            "No extracted records exist yet. Run extraction before running graph synthesis.",
          );
        }
        return all;
      },
    );

    await runStage<number>(
      "map_evidence_to_entities",
      (n) => `${n} canonical entities indexed by kind/value for evidence mapping.`,
      () => entities.length,
    );

    const output = await runStage<GraphBuildOutput>(
      "construct_candidates",
      (o) =>
        `${o.locations.length} locations, ${o.communicationEvents.length} communication events, ${o.financialTransactions.length} financial transactions, ${o.relationships.length} relationship candidates constructed (${o.warnings.length} warnings).`,
      () => synthesizeGraph(entities, aliases, decisions, records, investigation.id, synthesizedAt),
    );

    await runStage<number>(
      "validate_endpoints",
      (n) => `${n} relationship candidates carry resolvable endpoints.`,
      () => output.relationships.length,
    );

    await runStage<number>(
      "construct_edges",
      (n) => `${n} deterministic edges assembled (aggregated, deduplicated).`,
      () => output.relationships.length,
    );

    const validated = validateOutputs(output.locations, output.communicationEvents, output.financialTransactions, output.relationships);

    const extractedRecordIds = new Set(records.map((r) => r.id));
    const entityIds = new Set(entities.map((e) => e.id));
    const existingLocationIds = new Set((await listLocations()).map((l) => l.id));

    await runStage<number>(
      "attach_provenance",
      (n) => `${n} graph rows carry full provenance tracing to real extracted records and canonical entities.`,
      () =>
        assertProvenance(
          validated.locations,
          validated.communicationEvents,
          validated.financialTransactions,
          validated.relationships,
          entityIds,
          existingLocationIds,
          extractedRecordIds,
        ),
    );

    const markerKey = graphMarkerKey(investigation.id);
    const existingMarker = await getGraphMarker(markerKey);

    const persisted = await runStage(
      "persistence",
      (p) =>
        `${p.locationsCreated} locations, ${p.communicationEventsCreated} communication events, ${p.financialTransactionsCreated} financial transactions, ${p.relationshipsCreated} relationships written; ${p.locationsSkipped + p.communicationEventsSkipped + p.financialTransactionsSkipped + p.relationshipsSkipped} already present (idempotent).`,
      () =>
        idempotentPersistGraph(
          validated.locations,
          validated.communicationEvents,
          validated.financialTransactions,
          validated.relationships,
          (progress) => onEvent?.({ type: "persist_progress", label: progress.label, done: progress.done, total: progress.total }),
        ),
    );

    const [finalEntities, finalLocations, finalRelationships] = await runStage(
      "build_in_memory_graph",
      ([e, l, r]: [unknown[], unknown[], unknown[]]) => `In-memory graph rebuilt from persisted state: ${e.length + l.length} nodes, ${r.length} edges.`,
      async () => Promise.all([listEntities(), listLocations(), listRelationships()]),
    );
    const graph = buildGraphFromRows(finalEntities, finalLocations, finalRelationships);

    const nodesByKind: Record<string, number> = {};
    for (const e of finalEntities) nodesByKind[e.kind] = (nodesByKind[e.kind] ?? 0) + 1;
    if (finalLocations.length > 0) nodesByKind.location = finalLocations.length;
    const counts = countsFrom(output, entities.length, records.length);
    counts.nodesByKind = nodesByKind;

    const status: GraphResult["status"] =
      persisted.locationsCreated === 0 &&
      persisted.communicationEventsCreated === 0 &&
      persisted.financialTransactionsCreated === 0 &&
      persisted.relationshipsCreated === 0 &&
      existingMarker
        ? "already_synthesized"
        : "synthesized";

    await setGraphMarker(markerKey, { investigationId: investigation.id, synthesizedAt, counts });

    const result: GraphResult = await runStage(
      "result",
      () => `Graph result assembled: ${graph.order} nodes, ${graph.size} edges.`,
      (): GraphResult => ({
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
    const lastStage = stages[stages.length - 1]?.stage ?? "load_resolved_entities";
    const error =
      err instanceof GraphServiceError
        ? err.toGraphError()
        : (console.error("[graph] unexpected error", err), toInternalError(lastStage));

    const result: GraphResult = {
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
