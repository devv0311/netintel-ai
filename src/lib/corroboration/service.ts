import {
  listCommunicationEvents,
  listEntities,
  listEvidenceItems,
  listExtractedRecords,
  listInvestigations,
  listLocations,
  listRelationships,
} from "@/lib/db/repository";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

import { synthesizeCorroboration, type CorroborationFindingCandidate } from "./build";
import { CorroborationServiceError, toInternalError } from "./errors";
import { corroborationMarkerKey, getCorroborationMarker, setCorroborationMarker } from "./marker";
import { idempotentPersistCorroboration } from "./persist";
import type {
  CorroborationCounts,
  CorroborationEvent,
  CorroborationResult,
  CorroborationStage,
  StageReport,
} from "./types";
import { assertProvenance, validateOutputs } from "./verify";

/**
 * The spatial/temporal corroboration service.
 *
 * `runCorroborationSynthesis` executes the 10-stage pipeline described
 * in docs/data/corroboration.md and returns a structured
 * CorroborationResult. It never throws for an expected failure — no
 * investigation loaded, no graph synthesized yet, no spatial/temporal
 * data to compare, a validation failure, or a persistence error all
 * come back as `status: "failed"` with a user-safe `error`.
 *
 * Corroboration reads only already-persisted observable state
 * (communication events, extracted event mentions, entities, locations,
 * relationships, evidence items) plus the P5.5 graph completion marker
 * (for the graph version it stamps its findings with) — no file, no
 * upload, no Anthropic call, no external service, and never
 * evidence/ground-truth/. It writes only to `corroboration_findings`.
 */

type EventSink = (event: CorroborationEvent) => void;

function countsFrom(
  candidates: CorroborationFindingCandidate[],
  stats: { entitiesConsidered: number; locationsConsidered: number; activityEvents: number },
): CorroborationCounts {
  const byType = (t: string) => candidates.filter((c) => c.findingType === t).length;
  return {
    entitiesConsidered: stats.entitiesConsidered,
    locationsConsidered: stats.locationsConsidered,
    activityEvents: stats.activityEvents,
    spatialFindings: byType("spatial_co_location") + byType("spatial_proximity"),
    temporalFindings: byType("temporal_co_occurrence"),
    spatiotemporalFindings: byType("repeated_spatiotemporal_overlap"),
    contradictions: byType("spatiotemporal_contradiction"),
    corroboratedFacts: candidates.filter((c) => c.classification === "corroborated_fact").length,
    algorithmicSignals: candidates.filter((c) => c.classification === "algorithmic_signal").length,
  };
}

export async function runCorroborationSynthesis(onEvent?: EventSink): Promise<CorroborationResult> {
  const startedAt = new Date().toISOString();
  const analyzedAt = startedAt;
  const stages: StageReport[] = [];

  const runStage = async <T>(
    stage: CorroborationStage,
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
      report.detail = err instanceof CorroborationServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  let graphVersionForCatch: string | null = null;

  try {
    const investigations = await listInvestigations();
    const investigation = investigations[0];
    if (!investigation) {
      throw new CorroborationServiceError(
        "NO_INVESTIGATION",
        "load_graph_state",
        "No investigation is loaded. Ingest, extract, resolve, and synthesize the graph before running corroboration.",
      );
    }

    const loaded = await runStage(
      "load_graph_state",
      (v: {
        entities: unknown[];
        locations: unknown[];
        relationships: unknown[];
        communicationEvents: unknown[];
        records: unknown[];
        graphVersion: string;
      }) =>
        `${v.entities.length} entities, ${v.locations.length} locations, ${v.relationships.length} relationships, ${v.communicationEvents.length} communication events loaded at graph version ${v.graphVersion}.`,
      async () => {
        const graphMarker = await getGraphMarker(graphMarkerKey(investigation.id));
        const [entities, locations, relationships, communicationEvents, records, evidenceItems] = await Promise.all([
          listEntities(),
          listLocations(),
          listRelationships(),
          listCommunicationEvents(),
          listExtractedRecords(),
          listEvidenceItems(),
        ]);
        if (!graphMarker || relationships.length === 0) {
          throw new CorroborationServiceError(
            "NO_GRAPH",
            "load_graph_state",
            "No graph has been synthesized yet. Run graph synthesis before running corroboration.",
          );
        }
        return {
          entities,
          locations,
          relationships,
          communicationEvents,
          records,
          evidenceItems,
          graphVersion: graphMarker.synthesizedAt,
        };
      },
    );
    graphVersionForCatch = loaded.graphVersion;

    const build = await runStage(
      "build_activity_index",
      (v: { stats: { activityEvents: number; entitiesConsidered: number; locationsConsidered: number } }) =>
        `${v.stats.activityEvents} observable activity events across ${v.stats.entitiesConsidered} entities and ${v.stats.locationsConsidered} located sites.`,
      () => {
        const out = synthesizeCorroboration(
          loaded.entities,
          loaded.locations,
          loaded.relationships,
          loaded.communicationEvents,
          loaded.records,
          investigation.id,
          loaded.graphVersion,
          analyzedAt,
        );
        if (out.stats.activityEvents === 0) {
          throw new CorroborationServiceError(
            "INSUFFICIENT_SPATIAL_TEMPORAL_DATA",
            "build_activity_index",
            "There is no spatial or temporal activity to compare — no communication event or dated transaction resolved to a known entity. This is distinct from 'checked, nothing found'.",
          );
        }
        return out;
      },
    );

    const candidates = build.findings;

    await runStage<number>(
      "compute_spatial",
      (n) => `${n} spatial findings (co-location + haversine proximity within the documented threshold).`,
      () => candidates.filter((c) => c.kind === "spatial").length,
    );
    await runStage<number>(
      "compute_temporal",
      (n) => `${n} temporal co-occurrence findings within the documented time window.`,
      () => candidates.filter((c) => c.findingType === "temporal_co_occurrence").length,
    );
    await runStage<number>(
      "compute_spatiotemporal",
      (n) => `${n} spatiotemporal findings (repeated overlaps + travel-speed contradictions).`,
      () =>
        candidates.filter(
          (c) => c.findingType === "repeated_spatiotemporal_overlap" || c.findingType === "spatiotemporal_contradiction",
        ).length,
    );
    await runStage(
      "classify_findings",
      (v: { corroborated: number; algorithmic: number }) =>
        `${v.corroborated} corroborated facts (multi-source agreement), ${v.algorithmic} algorithmic signals.`,
      () => ({
        corroborated: candidates.filter((c) => c.classification === "corroborated_fact").length,
        algorithmic: candidates.filter((c) => c.classification === "algorithmic_signal").length,
      }),
    );

    const validated = await runStage(
      "validate_findings",
      (v: { findings: unknown[] }) => `${v.findings.length} finding candidates passed schema validation.`,
      () => validateOutputs(candidates),
    );

    const entityIds = new Set(loaded.entities.map((e) => e.id));
    const locationIds = new Set(loaded.locations.map((l) => l.id));
    const evidenceItemIds = new Set(loaded.evidenceItems.map((i) => i.id));
    await runStage<number>(
      "attach_provenance",
      (n) => `${n} corroboration findings carry full provenance, resolvable endpoints, and the correct graph version.`,
      () => assertProvenance(validated.findings, entityIds, locationIds, evidenceItemIds, loaded.graphVersion),
    );

    const markerKey = corroborationMarkerKey(investigation.id, loaded.graphVersion);
    const existingMarker = await getCorroborationMarker(markerKey);

    const persisted = await runStage(
      "persistence",
      (p) => `${p.findingsCreated} findings written; ${p.findingsSkipped} already present (idempotent).`,
      () =>
        idempotentPersistCorroboration(validated.findings, (progress) =>
          onEvent?.({ type: "persist_progress", label: progress.label, done: progress.done, total: progress.total }),
        ),
    );

    const counts = countsFrom(candidates, build.stats);
    const status: CorroborationResult["status"] =
      persisted.findingsCreated === 0 && existingMarker ? "already_synthesized" : "synthesized";
    await setCorroborationMarker(markerKey, {
      investigationId: investigation.id,
      graphVersion: loaded.graphVersion,
      analyzedAt,
      counts,
    });

    const result: CorroborationResult = await runStage(
      "result",
      () =>
        `Corroboration result assembled: ${validated.findings.length} findings — ${counts.corroboratedFacts} corroborated facts, ${counts.algorithmicSignals} algorithmic signals, ${counts.contradictions} contradictions.`,
      (): CorroborationResult => ({
        status,
        investigationId: investigation.id,
        graphVersion: loaded.graphVersion,
        counts,
        persisted,
        warnings: build.warnings.slice(0, 25),
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
      err instanceof CorroborationServiceError
        ? err.toCorroborationError()
        : (console.error("[corroboration] unexpected error", err), toInternalError(lastStage));

    const result: CorroborationResult = {
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
