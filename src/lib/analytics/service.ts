import { listEntities, listInvestigations, listLocations, listRelationships } from "@/lib/db/repository";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

import { buildAnalysisGraph, synthesizeAnalytics, type AnalyticalSignalCandidate } from "./build";
import { AnalyticsServiceError, toInternalError } from "./errors";
import { analyticsMarkerKey, getAnalyticsMarker, setAnalyticsMarker } from "./marker";
import { idempotentPersistAnalytics } from "./persist";
import type { AnalyticsCounts, AnalyticsEvent, AnalyticsResult, AnalyticsStage, StageReport } from "./types";
import { assertProvenance, validateOutputs } from "./verify";

/**
 * The topology analytics service.
 *
 * `runAnalyticsSynthesis` executes the 10-stage pipeline described in
 * docs/data/analytics.md and returns a structured AnalyticsResult. It
 * never throws for an expected failure — no investigation loaded, no
 * graph synthesized yet, a validation failure, a persistence error all
 * come back as `status: "failed"` with a user-safe `error`.
 *
 * Analytics reads only already-persisted entities, locations, and
 * relationships (via src/lib/db/repository.ts) plus the graph
 * synthesis completion marker (for the graph version it is analyzing)
 * — no file, no upload, no Anthropic call, no external service, and
 * never evidence/ground-truth/. It writes only to `analytical_signals`;
 * it never creates, updates, or deletes a relationship.
 */

type EventSink = (event: AnalyticsEvent) => void;

function countsFrom(candidates: AnalyticalSignalCandidate[], entitiesAnalyzed: number, edgesAnalyzed: number): AnalyticsCounts {
  const bridgeEntities = candidates.filter((c) => c.signalType === "bridge").length;
  const communities = candidates.filter((c) => c.signalType === "community").length;
  const rankedEntities = candidates.filter((c) => c.signalType === "ranking").length;
  return { entitiesAnalyzed, edgesAnalyzed, bridgeEntities, communities, rankedEntities };
}

export async function runAnalyticsSynthesis(onEvent?: EventSink): Promise<AnalyticsResult> {
  const startedAt = new Date().toISOString();
  const analyzedAt = startedAt;
  const stages: StageReport[] = [];

  const runStage = async <T>(
    stage: AnalyticsStage,
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
      report.detail = err instanceof AnalyticsServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  let graphVersionForCatch: string | null = null;

  try {
    const investigations = await listInvestigations();
    const investigation = investigations[0];
    if (!investigation) {
      throw new AnalyticsServiceError(
        "NO_INVESTIGATION",
        "load_graph_state",
        "No investigation is loaded. Ingest, extract, resolve, and synthesize the graph before running analytics.",
      );
    }

    const { entities, locations, relationships, graphVersion } = await runStage(
      "load_graph_state",
      (v: { entities: unknown[]; locations: unknown[]; relationships: unknown[]; graphVersion: string }) =>
        `${v.entities.length} entities, ${v.locations.length} locations, ${v.relationships.length} relationships loaded at graph version ${v.graphVersion}.`,
      async () => {
        const graphMarker = await getGraphMarker(graphMarkerKey(investigation.id));
        const [entities, locations, relationships] = await Promise.all([listEntities(), listLocations(), listRelationships()]);
        if (!graphMarker || relationships.length === 0) {
          throw new AnalyticsServiceError(
            "NO_GRAPH",
            "load_graph_state",
            "No graph has been synthesized yet. Run graph synthesis before running analytics.",
          );
        }
        return { entities, locations, relationships, graphVersion: graphMarker.synthesizedAt };
      },
    );
    graphVersionForCatch = graphVersion;

    const analysisGraphInfo = await runStage(
      "build_analysis_graph",
      (v: { order: number; size: number }) => `Deterministic analysis graph built: ${v.order} nodes, ${v.size} edges.`,
      () => {
        // Reuses the same construction synthesizeAnalytics performs internally;
        // computed here only to report accurate stage-progress counts.
        const { order, size } = buildAnalysisGraph(entities, locations, relationships);
        return { order, size };
      },
    );

    const candidates = synthesizeAnalytics(entities, locations, relationships, investigation.id, graphVersion, analyzedAt).signals;

    await runStage<number>(
      "compute_centrality",
      (n) => `${n} centrality signals computed (degree + betweenness, per entity).`,
      () => candidates.filter((c) => c.signalType === "centrality").length,
    );
    await runStage<number>(
      "compute_bridges",
      (n) => `${n} bridge / intermediary entities identified.`,
      () => candidates.filter((c) => c.signalType === "bridge").length,
    );
    await runStage<number>(
      "compute_communities",
      (n) => `${n} communities detected.`,
      () => candidates.filter((c) => c.signalType === "community").length,
    );
    await runStage<number>(
      "compute_ranking",
      (n) => `${n} entities ranked by structural prominence.`,
      () => candidates.filter((c) => c.signalType === "ranking").length,
    );

    const validated = validateOutputs(candidates);

    const entityIds = new Set(entities.map((e) => e.id));
    const locationIds = new Set(locations.map((l) => l.id));
    await runStage<number>(
      "attach_provenance",
      (n) => `${n} analytical signals carry full provenance and the correct graph version.`,
      () => assertProvenance(validated.signals, entityIds, locationIds, graphVersion),
    );

    const markerKey = analyticsMarkerKey(investigation.id, graphVersion);
    const existingMarker = await getAnalyticsMarker(markerKey);

    const persisted = await runStage(
      "persistence",
      (p) => `${p.signalsCreated} signals written; ${p.signalsSkipped} already present (idempotent).`,
      () =>
        idempotentPersistAnalytics(validated.signals, (progress) =>
          onEvent?.({ type: "persist_progress", label: progress.label, done: progress.done, total: progress.total }),
        ),
    );

    const counts = countsFrom(candidates, entities.length, analysisGraphInfo.size);
    const status: AnalyticsResult["status"] = persisted.signalsCreated === 0 && existingMarker ? "already_synthesized" : "synthesized";
    await setAnalyticsMarker(markerKey, { investigationId: investigation.id, graphVersion, analyzedAt, counts });

    const result: AnalyticsResult = await runStage(
      "result",
      () => `Analytics result assembled: ${validated.signals.length} signals across ${counts.rankedEntities} ranked entities, ${counts.communities} communities, ${counts.bridgeEntities} bridges.`,
      (): AnalyticsResult => ({
        status,
        investigationId: investigation.id,
        graphVersion,
        counts,
        persisted,
        warnings: [],
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );

    onEvent?.({ type: "result", result });
    return result;
  } catch (err) {
    const lastStage = stages[stages.length - 1]?.stage ?? "load_graph_state";
    const error =
      err instanceof AnalyticsServiceError
        ? err.toAnalyticsError()
        : (console.error("[analytics] unexpected error", err), toInternalError(lastStage));

    const result: AnalyticsResult = {
      status: "failed",
      investigationId: null,
      graphVersion: graphVersionForCatch,
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
