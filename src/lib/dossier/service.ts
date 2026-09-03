import { emptyClassificationCensus, type Dossier, type DossierCounts, type DossierSection } from "@/lib/domain/dossier";
import { getEnv } from "@/lib/env";

import { assembleDeterministicSections } from "./assemble";
import { collectCopilotMaterial, copilotMaterialSection, type CollectedCopilotMaterial } from "./copilot";
import { DossierServiceError, toInternalError } from "./errors";
import { loadDossierSnapshot, type DossierSnapshot } from "./load";
import { dossierMarkerKey, getDossierMarker, setDossierMarker } from "./marker";
import { idempotentPersistDossier } from "./persist";
import type { DossierEvent, DossierResult, DossierStage, StageReport } from "./types";
import { assertTraceability, knownIdsFrom, validateReport } from "./verify";

/**
 * The dossier / report service.
 *
 * `runDossierGeneration` executes the 11-stage pipeline described in
 * docs/data/dossier.md and returns a structured DossierResult. It never
 * throws for an expected failure — no investigation loaded, no graph
 * synthesized, analytics or corroboration not yet run against the
 * current graph version, nothing substantive to report, a validation
 * failure, a traceability failure, or a persistence error all come back
 * as `status: "failed"` with a user-safe `error`.
 *
 * The dossier reads only already-persisted state (through the
 * repository and the existing per-stage layers) and reuses the existing
 * Copilot service for its excerpts. It never reads a file, an upload,
 * or `evidence/ground-truth/`, and it writes only to `dossiers`.
 *
 * Generation does NOT require a live Claude request: with no
 * AI_PROVIDER_API_KEY the deterministic sections are unaffected and the
 * Copilot falls back to deterministic narration of the same grounded
 * claim set, which the report labels explicitly.
 */

type EventSink = (event: DossierEvent) => void;

const DOSSIER_METHOD = "dossier:assemble";

function countsFor(
  snapshot: DossierSnapshot,
  sections: readonly DossierSection[],
  excerptCount: number,
): DossierCounts {
  const findings = sections.flatMap((s) => s.findings);
  const byClassification = emptyClassificationCensus();
  for (const f of findings) byClassification[f.classification] += 1;
  return {
    sections: sections.length,
    findings: findings.length,
    evidenceSources: snapshot.evidenceSources.length,
    evidenceItems: snapshot.evidenceItems.length,
    entities: snapshot.entities.length,
    relationships: snapshot.relationships.length,
    analyticalSignals: snapshot.analyticalSignals.length,
    corroborationFindings: snapshot.corroborationFindings.length,
    contradictions: snapshot.corroborationFindings.filter(
      (f) => f.findingType === "spatiotemporal_contradiction",
    ).length,
    leads: sections.find((s) => s.kind === "investigative_leads")?.findings.length ?? 0,
    copilotExcerpts: excerptCount,
    byClassification,
  };
}

export async function runDossierGeneration(onEvent?: EventSink): Promise<DossierResult> {
  const startedAt = new Date().toISOString();
  const generatedAt = startedAt;
  const stages: StageReport[] = [];
  const warnings: string[] = [];

  const runStage = async <T>(
    stage: DossierStage,
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
      report.detail = err instanceof DossierServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  let graphVersionForCatch: string | null = null;

  try {
    const aiSynthesisAvailable = Boolean(getEnv().AI_PROVIDER_API_KEY);

    const snapshot = await runStage(
      "load_case_state",
      (s: DossierSnapshot) =>
        `${s.evidenceItems.length} evidence items, ${s.entities.length} entities, ${s.relationships.length} relationships, ` +
        `${s.analyticalSignals.length} signals and ${s.corroborationFindings.length} corroboration findings loaded at graph version ${s.graphVersion}.`,
      async () => {
        const readiness = await loadDossierSnapshot();
        if (!readiness.ready) {
          throw new DossierServiceError(readiness.code, "load_case_state", readiness.reason);
        }
        return readiness.snapshot;
      },
    );
    graphVersionForCatch = snapshot.graphVersion;

    // The whole deterministic body is assembled in one pass — it is a
    // single pure function of the snapshot — and the stages that follow
    // report what that pass produced, mirroring how
    // src/lib/corroboration/service.ts reports its own single build.
    const assembled = await runStage(
      "assemble_summary",
      (a: ReturnType<typeof assembleDeterministicSections>) => {
        const inventory = a.sections.find((s) => s.kind === "evidence_inventory");
        return `Case summary composed; evidence inventory covers ${inventory?.findings.length ?? 0} sources across ${snapshot.evidenceItems.length} items.`;
      },
      () => {
        const out = assembleDeterministicSections(snapshot, generatedAt, aiSynthesisAvailable);
        warnings.push(...out.warnings);
        if (out.findingCount === 0) {
          throw new DossierServiceError(
            "INSUFFICIENT_EVIDENCE",
            "assemble_summary",
            "There is nothing substantive to report — no evidence, entity, relationship, signal or corroboration finding was available to assemble. This is distinct from 'assembled, found nothing'.",
          );
        }
        return out;
      },
    );

    const sectionFindings = (kind: string): number =>
      assembled.sections.find((s) => s.kind === kind)?.findings.length ?? 0;

    await runStage<number>(
      "assemble_entities",
      (n) => `${n} key entities and ${sectionFindings("key_relationships")} key relationships assembled, each carrying its source row's own classification.`,
      () => sectionFindings("key_entities"),
    );
    await runStage<number>(
      "assemble_signals",
      (n) => `${n} analytical signals and ${sectionFindings("corroboration")} corroboration findings assembled.`,
      () => sectionFindings("analytical_signals"),
    );
    await runStage<number>(
      "assemble_contradictions",
      (n) => `${n} contradictions preserved as algorithmic signals; ${sectionFindings("investigative_leads")} items flagged for human verification.`,
      () => sectionFindings("contradictions"),
    );

    const material = await runStage(
      "collect_copilot",
      (m: CollectedCopilotMaterial) => {
        const answered = m.excerpts.filter((e) => e.status === "answered").length;
        return `${answered} of ${m.excerpts.length} dossier questions answered, contributing ${m.findings.length} cited claims (${m.anyAiSynthesis ? "model-worded" : "deterministic wording"}).`;
      },
      async () => {
        const collected = await collectCopilotMaterial(snapshot, generatedAt);
        warnings.push(...collected.warnings);
        return collected;
      },
    );

    const dossierCandidate = await runStage(
      "compose_report",
      (d: Dossier) => `Report ${d.reportVersion} composed: ${d.counts.sections} sections, ${d.counts.findings} findings, ${d.limitations.length} stated limitations.`,
      (): Dossier => {
        const sections: DossierSection[] = [...assembled.sections];
        // The Copilot section is inserted at its contract position —
        // after the leads section, before the provenance apparatus —
        // rather than appended, so the report reads in the order
        // docs/data/dossier.md documents.
        const provenanceIndex = sections.findIndex((s) => s.kind === "provenance_index");
        sections.splice(provenanceIndex, 0, copilotMaterialSection(material, aiSynthesisAvailable));

        return {
          id: assembled.dossierId,
          investigationId: snapshot.investigationId,
          investigationName: snapshot.investigationName,
          graphVersion: snapshot.graphVersion,
          reportVersion: assembled.reportVersion,
          title: `${snapshot.investigationName} — investigation dossier`,
          generatedAt,
          syntheticDataOnly: true,
          humanVerificationRequired: true,
          aiSynthesisAvailable,
          aiSynthesisNote: aiSynthesisAvailable
            ? material.anyAiSynthesis
              ? "An AI provider key is configured and Copilot wording in this report was model-authored over a deterministically retrieved, guardrail-checked claim set. Grounding, citations, classifications and confidences are not model-authored."
              : "An AI provider key is configured, but no excerpt in this report ended up model-worded; every excerpt uses the deterministic narration of its grounded claim set."
            : "No AI provider key is configured. No AI synthesis was performed for this report: the deterministic sections are unaffected, and Copilot excerpts use the deterministic narration of the same grounded claim set. No model output was generated, and none was invented in its place.",
          sections,
          copilotExcerpts: material.excerpts,
          limitations: assembled.limitations,
          counts: countsFor(snapshot, sections, material.excerpts.length),
          provenance: {
            source: snapshot.investigationId,
            location: `investigations/${snapshot.investigationId}`,
            method: DOSSIER_METHOD,
            confidence: 1,
            processingHistory: [
              "ingestion",
              "extraction",
              "resolution",
              "graph_synthesis",
              "analytics",
              "corroboration",
              ...(material.excerpts.some((e) => e.status !== "unavailable") ? ["copilot"] : []),
              DOSSIER_METHOD,
            ],
            timestamp: generatedAt,
          },
        };
      },
    );

    const dossier = await runStage(
      "validate_report",
      (d: Dossier) => `Report validated against the dossier contract: ${d.counts.findings} findings, all classified.`,
      () => validateReport(dossierCandidate),
    );

    await runStage<number>(
      "verify_traceability",
      (n) => `${n} findings verified — 100% classified and 100% resolvable to persisted records.`,
      () => assertTraceability(dossier, knownIdsFrom(snapshot), snapshot.graphVersion),
    );

    const markerKey = dossierMarkerKey(snapshot.investigationId, snapshot.graphVersion);
    const existingMarker = await getDossierMarker(markerKey);

    const persisted = await runStage(
      "persistence",
      (p) => (p.created === 1 ? "Dossier written." : "An identical dossier already existed; nothing was written (idempotent)."),
      () => idempotentPersistDossier(dossier),
    );

    await setDossierMarker(markerKey, {
      investigationId: snapshot.investigationId,
      graphVersion: snapshot.graphVersion,
      dossierId: dossier.id,
      reportVersion: dossier.reportVersion,
      // The marker points at the report that currently describes this
      // graph version. On an idempotent re-run it keeps pointing at the
      // ORIGINAL generation time rather than being bumped to now: the
      // report has not been regenerated, it has been reused.
      generatedAt:
        persisted.created === 0 && existingMarker?.dossierId === dossier.id
          ? existingMarker.generatedAt
          : generatedAt,
    });

    const result: DossierResult = await runStage(
      "result",
      () =>
        `Dossier result assembled: ${dossier.counts.findings} findings across ${dossier.counts.sections} sections — ` +
        `${Object.entries(dossier.counts.byClassification)
          .map(([c, n]) => `${n} ${c.replace(/_/g, " ")}`)
          .join(", ")}.`,
      (): DossierResult => ({
        status: persisted.created === 0 ? "already_generated" : "generated",
        dossierId: dossier.id,
        reportVersion: dossier.reportVersion,
        investigationId: dossier.investigationId,
        graphVersion: dossier.graphVersion,
        counts: dossier.counts,
        persisted,
        warnings: warnings.slice(0, 25),
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );

    onEvent?.({ type: "result", result });
    return result;
  } catch (err) {
    const lastStage = stages[stages.length - 1]?.stage ?? "load_case_state";
    const error =
      err instanceof DossierServiceError
        ? err.toDossierError()
        : (console.error("[dossier] unexpected error", err), toInternalError(lastStage));

    const result: DossierResult = {
      status: "failed",
      dossierId: null,
      reportVersion: null,
      investigationId: null,
      graphVersion: graphVersionForCatch,
      counts: null,
      persisted: null,
      warnings: warnings.slice(0, 25),
      stages,
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
    };
    onEvent?.({ type: "result", result });
    return result;
  }
}
