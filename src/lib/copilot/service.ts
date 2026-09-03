import type { EvidenceClassification } from "@/lib/domain/provenance";

import {
  CLASSIFICATION_STRENGTH,
  CopilotResponseSchema,
  type CopilotClaim,
  type CopilotResponse,
  type QuestionAmbiguity,
} from "./contract";
import { CopilotServiceError, toInternalError } from "./errors";
import { buildGroundingIndex, groundQuestion } from "./grounding";
import { loadCopilotSnapshot } from "./load";
import { ambiguousAnswer, insufficientEvidenceAnswer, narrate } from "./narrate";
import { COPILOT_PROMPT_VERSION } from "./prompt";
import { COPILOT_SCHEMA_VERSION } from "./contract";
import { retrieve, type CorpusSnapshot, type EvidencePack, type RetrievalOutput } from "./retrieval";
import { synthesizeAnswer } from "./synthesize";
import type {
  CopilotEvent,
  CopilotModelError,
  CopilotResult,
  CopilotStage,
  QuestionGrounding,
  StageReport,
} from "./types";
import { AI_MODEL_BASELINE } from "@/lib/ai/client";
import { assertCitationsResolve, enforceClassifications } from "./verify";

/**
 * The Investigation Copilot service.
 *
 * `askCopilot` runs the 9-stage pipeline described in
 * docs/data/copilot.md and returns a structured CopilotResult. It never
 * throws for an expected failure — no investigation, no derived
 * intelligence, an empty question, a contract breach, or an
 * unresolvable citation all come back as `status: "failed"` with a
 * user-safe `error`.
 *
 * Two failure modes are deliberately kept apart:
 *
 *   - a SERVICE failure (`status: "failed"`) — the Copilot could not
 *     produce a validated answer at all;
 *   - a MODEL failure (`modelError`, `status` still "answered") — the
 *     grounded claim set stands, only the prose fell back to
 *     deterministic narration. A provider outage must not cost the
 *     investigator the evidence.
 *
 * The Copilot writes nothing to any domain table. The single side
 * effect it may have is an entry in the on-disk LLM response cache.
 */

const MAX_QUESTION_LENGTH = 500;

type EventSink = (event: CopilotEvent) => void;

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** The weakest classification present — the reading floor for the whole answer. */
function weakestClassification(claims: readonly CopilotClaim[]): EvidenceClassification {
  if (claims.length === 0) return "investigative_lead";
  return claims.reduce<EvidenceClassification>(
    (acc, c) => (CLASSIFICATION_STRENGTH[c.classification] < CLASSIFICATION_STRENGTH[acc] ? c.classification : acc),
    claims[0]!.classification,
  );
}

function hasEvidentialCitation(claim: CopilotClaim): boolean {
  const c = claim.citations;
  return (
    c.evidenceItemIds.length +
      c.extractedRecordIds.length +
      c.relationshipIds.length +
      c.analyticalSignalIds.length +
      c.corroborationFindingIds.length >
    0
  );
}

function rollUp(claims: readonly CopilotClaim[]) {
  return {
    supportingEvidenceIds: uniqueSorted(claims.flatMap((c) => c.citations.evidenceItemIds)),
    supportingExtractedRecordIds: uniqueSorted(claims.flatMap((c) => c.citations.extractedRecordIds)),
    supportingEntityIds: uniqueSorted(claims.flatMap((c) => c.citations.entityIds)),
    supportingRelationshipIds: uniqueSorted(claims.flatMap((c) => c.citations.relationshipIds)),
    supportingAnalyticalSignalIds: uniqueSorted(claims.flatMap((c) => c.citations.analyticalSignalIds)),
    supportingCorroborationFindingIds: uniqueSorted(claims.flatMap((c) => c.citations.corroborationFindingIds)),
  };
}

function ambiguitiesFrom(grounding: QuestionGrounding): QuestionAmbiguity[] {
  return grounding.mentions
    .filter((m) => m.ambiguous)
    .map((m) => ({
      surface: m.surface,
      candidates: m.candidates.map((c) => ({
        entityId: c.entityId,
        label: c.label,
        kind: c.kind,
        matchedOn: c.matchedOn,
      })),
    }));
}

export async function askCopilot(question: string, onEvent?: EventSink): Promise<CopilotResult> {
  const startedAt = new Date().toISOString();
  const stages: StageReport[] = [];
  const warnings: string[] = [];
  let modelError: CopilotModelError | null = null;

  const runStage = async <T>(
    stage: CopilotStage,
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
      report.detail = err instanceof CopilotServiceError ? err.message : "Stage failed.";
      onEvent?.({ type: "stage", report: { ...report } });
      throw err;
    }
  };

  const finish = (result: CopilotResult): CopilotResult => {
    onEvent?.({ type: "result", result });
    return result;
  };

  try {
    const trimmed = (question ?? "").trim();

    const snapshot = await runStage(
      "parse_question",
      (v: { snapshot: CorpusSnapshot }) =>
        `Question accepted (${trimmed.length} chars); grounding against graph version ${v.snapshot.graphVersion}.`,
      async () => {
        if (trimmed.length === 0) {
          throw new CopilotServiceError("INVALID_QUESTION", "parse_question", "Enter a question before asking.");
        }
        if (trimmed.length > MAX_QUESTION_LENGTH) {
          throw new CopilotServiceError(
            "INVALID_QUESTION",
            "parse_question",
            `Questions are limited to ${MAX_QUESTION_LENGTH} characters. Shorten the question and ask again.`,
          );
        }
        const readiness = await loadCopilotSnapshot();
        if (!readiness.ready) {
          throw new CopilotServiceError("NO_DERIVED_INTELLIGENCE", "parse_question", readiness.reason);
        }
        return { snapshot: readiness.snapshot };
      },
    );
    const corpus = snapshot.snapshot;

    const grounding = await runStage(
      "ground_entities",
      (g: QuestionGrounding) =>
        `Intent “${g.intent}”; ${g.mentions.length} reference(s) recognised, ${g.resolvedEntityIds.length} resolved, ${g.mentions.filter((m) => m.ambiguous).length} ambiguous, ${g.unknownReferences.length} unknown.`,
      () => {
        const index = buildGroundingIndex(
          corpus.entities.map((e) => ({ id: e.id, kind: e.kind, canonicalLabel: e.canonicalLabel })),
          corpus.aliases.map((a) => ({ entityId: a.entityId, aliasValue: a.aliasValue })),
          corpus.locations.map((l) => ({ id: l.id, label: l.label })),
        );
        return groundQuestion(trimmed, index);
      },
    );

    const ambiguities = ambiguitiesFrom(grounding);
    const provenanceBase = {
      source: `investigation:${corpus.investigationId}`,
      location: `graph_version:${corpus.graphVersion}`,
      timestamp: new Date().toISOString(),
    };

    // An ambiguous reference short-circuits: the Copilot exposes the
    // candidates and asks, rather than silently picking one
    // (docs/requirements.md §5).
    if (ambiguities.length > 0) {
      const response: CopilotResponse = CopilotResponseSchema.parse({
        question: trimmed,
        normalizedQuestion: grounding.normalizedQuestion,
        status: "ambiguous",
        grounding: "insufficient_evidence",
        answer: ambiguousAnswer(ambiguities),
        classification: "investigative_lead",
        confidence: 0,
        claims: [],
        caveats: ["No claim was composed, because the question's subject could not be resolved to a single entity."],
        conflicts: [],
        ambiguities,
        ...rollUp([]),
        relatedViews: { entityIds: [], relationshipIds: [], analyticalSignalIds: [], corroborationFindingIds: [] },
        derivation: {
          mode: "deterministic",
          model: AI_MODEL_BASELINE,
          modelVersion: AI_MODEL_BASELINE,
          promptVersion: COPILOT_PROMPT_VERSION,
          schemaVersion: COPILOT_SCHEMA_VERSION,
          cache: "bypass",
          rejections: [],
        },
        graphVersion: corpus.graphVersion,
        provenance: {
          ...provenanceBase,
          method: "copilot:ambiguity_detection",
          confidence: 0,
          processingHistory: [`graph:synthesized:${corpus.graphVersion}`, "copilot:grounding:ambiguous"],
        },
      });
      for (const stage of ["retrieve_evidence", "assemble_pack", "build_claims", "synthesize_answer"] as const) {
        stages.push({
          stage,
          status: "skipped",
          detail: "Skipped — the question's subject is ambiguous, so nothing was retrieved or asserted.",
          startedAt: new Date().toISOString(),
        });
      }
      return finish({
        status: "answered",
        question: trimmed,
        response,
        modelError: null,
        warnings,
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      });
    }

    const retrieval = await runStage(
      "retrieve_evidence",
      (r: RetrievalOutput) =>
        `${r.pack.entries.length} persisted record(s) selected across ${new Set(r.pack.entries.map((e) => e.kind)).size} record type(s).`,
      () => retrieve(corpus, grounding),
    );
    warnings.push(...retrieval.warnings);

    await runStage<EvidencePack>(
      "assemble_pack",
      (p) => `Evidence pack assembled with ${p.entries.length} handle-addressed record(s); no database id is shown to the model.`,
      () => retrieval.pack,
    );

    const claims = await runStage<CopilotClaim[]>(
      "build_claims",
      (c) =>
        c.length === 0
          ? "No grounded claim could be built from the persisted records."
          : `${c.length} grounded claim(s): ${[...new Set(c.map((x) => x.classification))].join(", ")}.`,
      () => {
        const issues = enforceClassifications(retrieval.claims, retrieval.pack);
        if (issues.length > 0) {
          throw new CopilotServiceError(
            "VALIDATION_FAILURE",
            "build_claims",
            "A grounded claim carried an evidence classification its cited records do not support; the answer was withheld.",
            issues,
          );
        }
        return retrieval.claims;
      },
    );

    const insufficient = claims.length === 0;

    const synthesis = insufficient
      ? null
      : await runStage(
          "synthesize_answer",
          (s: Awaited<ReturnType<typeof synthesizeAnswer>>) =>
            `Prose composed via ${s.mode} (cache ${s.cache})${s.rejections.length > 0 ? `; ${s.rejections.length} guardrail rejection(s)` : ""}.`,
          () => synthesizeAnswer(grounding, retrieval.pack, claims),
        );

    if (insufficient) {
      stages.push({
        stage: "synthesize_answer",
        status: "skipped",
        detail: "Skipped — there is no grounded claim to word, so no answer was composed.",
        startedAt: new Date().toISOString(),
      });
    }

    let mode = synthesis?.mode ?? "deterministic";
    let rejections = synthesis?.rejections ?? [];
    modelError = synthesis?.modelError ?? null;

    // The model may not overrule the deterministic ground: if it reports
    // insufficiency while a grounded claim set exists, its wording is
    // discarded rather than allowed to hide retrieved evidence.
    if (synthesis?.answer && synthesis.answer.insufficientEvidence && claims.length > 0) {
      rejections = [...rejections, "Model reported insufficient evidence while a grounded claim set exists."];
      mode = "deterministic_fallback";
      modelError = {
        code: "MODEL_OUTPUT_REJECTED",
        message: "The model contradicted the retrieved evidence and its wording was discarded.",
        rejections,
      };
    }
    const useModelWording = mode === "llm_synthesis" && synthesis?.answer != null;

    const answerText = insufficient
      ? insufficientEvidenceAnswer(grounding, warnings)
      : useModelWording
        ? (synthesis?.answer as NonNullable<typeof synthesis>["answer"] & object).answer
        : narrate(grounding, claims, retrieval.conflicts);

    const caveats = uniqueSorted([
      ...retrieval.caveats,
      ...(useModelWording ? (synthesis?.answer?.caveats ?? []) : []),
      ...(grounding.unknownReferences.length > 0
        ? [
            `The question referred to ${grounding.unknownReferences.map((u) => `“${u}”`).join(", ")}, which this investigation holds no record of.`,
          ]
        : []),
    ]);

    const fullyGrounded = !insufficient && claims.every(hasEvidentialCitation) && grounding.unknownReferences.length === 0;
    const classification = weakestClassification(claims);
    const confidence = insufficient ? 0 : Math.min(...claims.map((c) => c.confidence));

    const response = await runStage<CopilotResponse>(
      "validate_response",
      (r) => `Response validated against ${COPILOT_SCHEMA_VERSION}: ${r.status}, ${r.grounding}, ${r.claims.length} claim(s).`,
      () => {
        const candidate = {
          question: trimmed,
          normalizedQuestion: grounding.normalizedQuestion,
          status: insufficient ? "insufficient_evidence" : "answered",
          grounding: insufficient ? "insufficient_evidence" : fullyGrounded ? "fully_grounded" : "partially_grounded",
          answer: answerText,
          classification,
          confidence,
          claims,
          caveats,
          conflicts: retrieval.conflicts,
          ambiguities: [],
          ...rollUp(claims),
          relatedViews: retrieval.relatedViews,
          derivation: {
            mode,
            model: AI_MODEL_BASELINE,
            modelVersion: AI_MODEL_BASELINE,
            promptVersion: COPILOT_PROMPT_VERSION,
            schemaVersion: COPILOT_SCHEMA_VERSION,
            cache: synthesis?.cache ?? "bypass",
            rejections,
          },
          graphVersion: corpus.graphVersion,
          provenance: {
            ...provenanceBase,
            method: `copilot:${grounding.intent}:${mode}`,
            confidence,
            processingHistory: [
              `graph:synthesized:${corpus.graphVersion}`,
              `copilot:retrieval:${grounding.intent}`,
              `copilot:synthesis:${mode}`,
              `copilot:validation:${COPILOT_SCHEMA_VERSION}`,
            ],
          },
        };
        const parsed = CopilotResponseSchema.safeParse(candidate);
        if (!parsed.success) {
          throw new CopilotServiceError(
            "VALIDATION_FAILURE",
            "validate_response",
            "The composed answer did not satisfy the Copilot response contract and was withheld.",
            parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
          );
        }
        return parsed.data;
      },
    );

    await runStage<number>(
      "verify_citations",
      (n) => `${n} citation(s) resolved to persisted records; none was fabricated.`,
      () => {
        const known = {
          evidenceItemIds: new Set(corpus.evidenceItems.map((i) => i.id)),
          extractedRecordIds: new Set(corpus.extractedRecords.map((r) => r.id)),
          entityIds: new Set([...corpus.entities.map((e) => e.id), ...corpus.locations.map((l) => l.id)]),
          relationshipIds: new Set(corpus.relationships.map((r) => r.id)),
          analyticalSignalIds: new Set(corpus.analyticalSignals.map((s) => s.id)),
          corroborationFindingIds: new Set(corpus.corroborationFindings.map((f) => f.id)),
        };
        const issues = assertCitationsResolve(response, known);
        if (issues.length > 0) {
          throw new CopilotServiceError(
            "VALIDATION_FAILURE",
            "verify_citations",
            "The answer cited a record that does not resolve, so it was withheld.",
            issues,
          );
        }
        return (
          response.supportingEvidenceIds.length +
          response.supportingExtractedRecordIds.length +
          response.supportingEntityIds.length +
          response.supportingRelationshipIds.length +
          response.supportingAnalyticalSignalIds.length +
          response.supportingCorroborationFindingIds.length
        );
      },
    );

    const result = await runStage<CopilotResult>(
      "result",
      (r) => `Copilot result assembled: ${r.response?.status ?? "failed"} (${r.response?.classification ?? "—"}).`,
      (): CopilotResult => ({
        status: "answered",
        question: trimmed,
        response,
        modelError,
        warnings: warnings.slice(0, 25),
        stages,
        error: null,
        startedAt,
        finishedAt: new Date().toISOString(),
      }),
    );

    return finish(result);
  } catch (err) {
    const lastStage = stages[stages.length - 1]?.stage ?? "parse_question";
    const error =
      err instanceof CopilotServiceError
        ? err.toCopilotError()
        : (console.error("[copilot] unexpected error", err), toInternalError(lastStage));

    return finish({
      status: "failed",
      question: (question ?? "").trim(),
      response: null,
      modelError,
      warnings: warnings.slice(0, 25),
      stages,
      error,
      startedAt,
      finishedAt: new Date().toISOString(),
    });
  }
}
