import { askCopilot } from "@/lib/copilot/service";
import type { CopilotClaim, CopilotResponse, CopilotResult } from "@/lib/copilot/types";
import type { DossierCopilotExcerpt, DossierFinding, DossierSection } from "@/lib/domain/dossier";
import type { EvidenceClassification } from "@/lib/domain/provenance";
import { makeContentId } from "@/lib/domain/ids";

import { SECTION_LIMITS, capReferenceIds, dossierRefs } from "./assemble";
import type { DossierSnapshot } from "./load";

/**
 * Copilot material for the dossier — task §4, and blueprint H2's
 * "(optionally) Copilot Q&A used during the investigation".
 *
 * This module REUSES the existing P5.8 Copilot service. It does not
 * re-implement retrieval, grounding, claim building, or the citation
 * guardrail, and it never talks to a model itself.
 *
 * Two properties matter here and are load-bearing:
 *
 *   1. Dossier generation never REQUIRES a live Claude request. The
 *      Copilot already degrades to deterministic narration of the same
 *      deterministically-retrieved claim set when no
 *      AI_PROVIDER_API_KEY is configured, so with no key the excerpts
 *      still carry real grounded claims, real citations and real
 *      classifications — only the wording is deterministic instead of
 *      model-authored, and that fact is recorded on every excerpt. If
 *      the Copilot cannot be consulted at all, the excerpt is recorded
 *      as `unavailable` WITH ITS REASON. Nothing is ever invented to
 *      fill the gap.
 *
 *   2. Nothing is re-labelled. An excerpt keeps the Copilot's own
 *      grounding status, per-claim classification, per-claim
 *      confidence, citations and provenance. If the Copilot said the
 *      evidence was insufficient, the dossier says so too.
 *
 * A Copilot failure is a WARNING, never a generation failure: the
 * deterministic sections are the report, and this is supporting
 * material attached to it.
 */

/**
 * The fixed dossier question set, drawn from the canonical investigative
 * questions in docs/demo/demo-contract.md §3 (questions 1, 6 and 8).
 *
 * Only the questions with no case-specific entity placeholder are used
 * — the placeholder ones (2, 3, 7) are bound to particular suspects and
 * belong on the interactive Copilot screen, where an investigator picks
 * them. A fixed, case-independent set also keeps report generation
 * deterministic: the same case always asks the same three questions.
 */
export const DOSSIER_QUESTIONS: readonly { id: string; question: string }[] = [
  { id: "dq1", question: "Who are the primary suspects in this case, and what aliases do they use?" },
  {
    id: "dq2",
    question: "Which entity in this case has the most significant structural role in the network, and why?",
  },
  {
    id: "dq3",
    question: "Summarize the case: what has been corroborated, and what remains only an inference or a lead?",
  },
];

const CLASSIFICATION_STRENGTH: Record<EvidenceClassification, number> = {
  corroborated_fact: 5,
  observed_fact: 4,
  algorithmic_signal: 3,
  ai_inference: 2,
  investigative_lead: 1,
};

function excerptFromResponse(
  questionId: string,
  question: string,
  response: CopilotResponse,
  modelNote: string | null,
): DossierCopilotExcerpt {
  return {
    questionId,
    question,
    status: response.status,
    // Verbatim. The dossier does not re-word a Copilot answer.
    answer: response.answer,
    grounding: response.grounding,
    classification: response.classification,
    confidence: response.confidence,
    synthesisMode: response.derivation.mode,
    aiSynthesized: response.derivation.mode === "llm_synthesis",
    claimCount: response.claims.length,
    references: dossierRefs({
      evidenceItemIds: response.supportingEvidenceIds,
      extractedRecordIds: response.supportingExtractedRecordIds,
      entityIds: response.supportingEntityIds,
      relationshipIds: response.supportingRelationshipIds,
      analyticalSignalIds: response.supportingAnalyticalSignalIds,
      corroborationFindingIds: response.supportingCorroborationFindingIds,
    }),
    note: modelNote,
  };
}

function unavailableExcerpt(questionId: string, question: string, reason: string): DossierCopilotExcerpt {
  return {
    questionId,
    question,
    status: "unavailable",
    answer: null,
    grounding: null,
    classification: null,
    confidence: null,
    synthesisMode: null,
    aiSynthesized: false,
    claimCount: 0,
    references: dossierRefs({}),
    note: reason,
  };
}

export interface CollectedCopilotMaterial {
  excerpts: DossierCopilotExcerpt[];
  findings: DossierFinding[];
  warnings: string[];
  /** True when at least one excerpt's wording actually came from a model. */
  anyAiSynthesis: boolean;
}

/**
 * Asks the existing Copilot the fixed dossier question set and maps the
 * answers into excerpts plus per-claim findings.
 *
 * `snapshot` supplies the graph version the findings are stamped with;
 * the Copilot loads its own state through its own loader, exactly as it
 * does for the Copilot screen, so this is genuine reuse rather than a
 * second retrieval path.
 */
export async function collectCopilotMaterial(
  snapshot: DossierSnapshot,
  generatedAt: string,
): Promise<CollectedCopilotMaterial> {
  const excerpts: DossierCopilotExcerpt[] = [];
  const findings: DossierFinding[] = [];
  const warnings: string[] = [];
  let anyAiSynthesis = false;

  for (const { id, question } of DOSSIER_QUESTIONS) {
    let result: CopilotResult;
    try {
      result = await askCopilot(question);
    } catch (err) {
      // The Copilot service returns structured failures rather than
      // throwing, so this is the belt-and-braces path. The message is
      // ours, never the thrown value: an internal error string could
      // carry a path or a provider detail.
      console.error("[dossier] copilot call threw", err);
      excerpts.push(
        unavailableExcerpt(id, question, "The Copilot could not be consulted for this question on this run."),
      );
      warnings.push(`Copilot material for "${question}" is unavailable; the report's deterministic sections are unaffected.`);
      continue;
    }

    if (result.status === "failed" || !result.response) {
      const reason = result.error?.message ?? "The Copilot could not be consulted for this question on this run.";
      excerpts.push(unavailableExcerpt(id, question, reason));
      warnings.push(`Copilot material for "${question}" is unavailable: ${reason}`);
      continue;
    }

    const response = result.response;
    // A model problem degrades the WORDING only — the claims, citations
    // and classifications underneath are deterministic either way — so
    // it is recorded on the excerpt rather than dropping the excerpt.
    const modelNote = result.modelError
      ? result.modelError.message
      : response.derivation.mode === "deterministic"
        ? "Wording is the deterministic narration of the grounded claim set; no model was used."
        : null;

    excerpts.push(excerptFromResponse(id, question, response, modelNote));
    if (response.derivation.mode === "llm_synthesis") anyAiSynthesis = true;
    if (result.modelError) {
      warnings.push(`Copilot wording for "${question}" fell back to deterministic narration: ${result.modelError.message}`);
    }

    // Strongest-classified claims first, then by handle, so the same
    // answer always contributes the same findings in the same order.
    const claims = [...response.claims]
      .sort((a: CopilotClaim, b: CopilotClaim) => {
        const strength = CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification];
        if (strength !== 0) return strength;
        return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })
      .slice(0, SECTION_LIMITS.copilotClaims);

    for (const claim of claims) {
      findings.push({
        id: makeContentId("dossier_finding", ["copilot_material", id, claim.id, snapshot.graphVersion]),
        sectionKind: "copilot_material",
        // The Copilot's own wording for its own claim, unmodified.
        statement: claim.statement,
        // Preserved, never recomputed.
        classification: claim.classification,
        confidence: claim.confidence,
        derivationMethod: `copilot:claim:${claim.derivation}`,
        explanation: `${claim.explanation} Carried into the dossier from the Copilot answer to "${question}" (${response.grounding.replace(/_/g, " ")}); classification and confidence are the Copilot's own.`,
        references: dossierRefs({
          evidenceItemIds: claim.citations.evidenceItemIds,
          extractedRecordIds: claim.citations.extractedRecordIds,
          entityIds: claim.citations.entityIds,
          relationshipIds: claim.citations.relationshipIds,
          analyticalSignalIds: claim.citations.analyticalSignalIds,
          corroborationFindingIds: claim.citations.corroborationFindingIds,
        }),
        provenance: {
          source: response.provenance.source,
          location: `copilot/answer/${id}/${claim.id}`,
          method: `copilot:claim:${claim.derivation}`,
          confidence: claim.confidence,
          processingHistory: [...response.provenance.processingHistory, "dossier:assemble"],
          timestamp: generatedAt,
        },
      });
    }
  }

  return { excerpts, findings, warnings, anyAiSynthesis };
}

/**
 * Builds the Copilot material section.
 *
 * When nothing could be consulted the section is still present, with
 * zero findings and a note saying exactly why — an empty section that
 * explains itself is honest; a missing section would quietly imply the
 * question was never asked.
 */
export function copilotMaterialSection(
  material: CollectedCopilotMaterial,
  aiSynthesisAvailable: boolean,
): DossierSection {
  const answered = material.excerpts.filter((e) => e.status === "answered").length;
  const unavailable = material.excerpts.filter((e) => e.status === "unavailable").length;
  const insufficient = material.excerpts.filter((e) => e.status === "insufficient_evidence").length;

  const notes: string[] = [
    aiSynthesisAvailable
      ? "An AI provider key is configured. Copilot wording may be model-authored; the claims, citations, classifications and confidences underneath it are not — those are produced deterministically and guardrail-checked before any wording is applied."
      : "No AI provider key is configured, so no AI synthesis was performed for this report. Every excerpt below uses the deterministic narration of the same grounded claim set. No model output was generated, and none was invented in its place.",
    "Each excerpt keeps the Copilot's own grounding status, per-claim classification, per-claim confidence and citations. The dossier does not re-word, re-classify, or strengthen a Copilot answer.",
  ];
  if (insufficient > 0) {
    notes.push(
      `${insufficient} question${insufficient === 1 ? "" : "s"} returned insufficient evidence. That is recorded as-is: the Copilot reports when the case does not support an answer rather than composing one.`,
    );
  }
  if (unavailable > 0) {
    notes.push(
      `${unavailable} question${unavailable === 1 ? "" : "s"} could not be answered on this run. The gap is recorded with its reason and nothing was substituted for it.`,
    );
  }

  return {
    kind: "copilot_material",
    title: "Copilot-supported material",
    summary:
      material.excerpts.length === 0
        ? "No Copilot material was collected for this report."
        : `${answered} of ${material.excerpts.length} dossier ${material.excerpts.length === 1 ? "question" : "questions"} produced a grounded answer, contributing ${material.findings.length} cited ${material.findings.length === 1 ? "claim" : "claims"}. Every claim keeps the classification the Copilot gave it.`,
    sourceStages: ["P5.8 investigation Copilot"],
    findings: material.findings,
    notes,
  };
}

export { capReferenceIds };
