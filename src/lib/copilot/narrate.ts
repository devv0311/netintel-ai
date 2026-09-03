import type { EvidenceClassification } from "@/lib/domain/provenance";

import { CLASSIFICATION_STRENGTH, type CopilotClaim, type CopilotConflict, type QuestionAmbiguity } from "./contract";
import type { QuestionGrounding } from "./types";

/**
 * The deterministic narrator.
 *
 * This is the answer the Copilot gives when no model is configured,
 * when the Claude call fails, and whenever a model answer is rejected
 * by a guardrail. It is a pure function of the grounded claim set, so
 * the same question over the same corpus always produces the same
 * prose — the reproducibility guarantee in docs/requirements.md §6.
 *
 * It never invents wording for a claim: each line is the statement
 * ./retrieval.ts already wrote in the register that claim's evidence
 * classification demands, plus its citation handle. Grouping by
 * classification is what keeps a signal, an inference, and a lead from
 * reading like established fact (docs/requirements.md §7).
 */

const GROUP_ORDER: EvidenceClassification[] = [
  "corroborated_fact",
  "observed_fact",
  "algorithmic_signal",
  "ai_inference",
  "investigative_lead",
];

const GROUP_HEADINGS: Record<EvidenceClassification, string> = {
  corroborated_fact: "Corroborated facts (independent sources agree):",
  observed_fact: "Observed facts (stated directly in one source):",
  algorithmic_signal: "Algorithmic signals (they describe the data — not established facts about people):",
  ai_inference: "AI inferences (beyond directly observed evidence — treat as provisional):",
  investigative_lead: "Investigative leads (prompts for further work, not claims of fact):",
};

export function insufficientEvidenceAnswer(grounding: QuestionGrounding, warnings: readonly string[]): string {
  const reasons = warnings.length > 0 ? warnings.slice(0, 4) : ["Structured retrieval returned no supporting record."];
  return [
    "Insufficient evidence: this investigation's persisted evidence and derived intelligence do not support an answer to that question.",
    "",
    "Why:",
    ...reasons.map((r) => `- ${r}`),
    "",
    "No answer has been composed, because composing one would mean asserting something the case evidence does not contain.",
  ].join("\n");
}

export function ambiguousAnswer(ambiguities: readonly QuestionAmbiguity[]): string {
  const lines = ambiguities.slice(0, 4).map((a) => {
    const options = a.candidates.map((c) => `  - ${c.label} (${c.kind.replace(/_/g, " ")}) — matched on ${c.matchedOn}`);
    return [`“${a.surface}” matches ${a.candidates.length} entities in this case:`, ...options].join("\n");
  });
  return [
    "That reference is ambiguous, so no answer has been composed — guessing which entity you meant would put an unfounded claim in front of you.",
    "",
    ...lines,
    "",
    "Re-ask with the full name or identifier of the entity you mean.",
  ].join("\n");
}

export function narrate(
  grounding: QuestionGrounding,
  claims: readonly CopilotClaim[],
  conflicts: readonly CopilotConflict[],
): string {
  if (claims.length === 0) return insufficientEvidenceAnswer(grounding, []);

  // The lead is the FIRST claim retrieval produced, not the strongest
  // one: retrieval emits the claim that directly answers the question
  // first, and leading with an incidental corroborated finding instead
  // would bury the answer under its supporting detail.
  const lead = claims[0] as CopilotClaim;

  const sorted = [...claims].sort(
    (a, b) =>
      CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification] ||
      b.confidence - a.confidence ||
      (a.id < b.id ? -1 : 1),
  );
  const sections: string[] = [`${lead.statement} [${lead.id}]`];

  for (const classification of GROUP_ORDER) {
    const group = sorted.filter((c) => c.classification === classification && c.id !== lead.id);
    if (group.length === 0) continue;
    sections.push("", GROUP_HEADINGS[classification], ...group.map((c) => `- ${c.statement} [${c.id}]`));
  }

  if (conflicts.length > 0) {
    sections.push(
      "",
      "Unresolved conflicts:",
      ...conflicts.map((c) => `- ${c.summary} [${c.claimIds.join("][")}] — reported, not resolved.`),
    );
  }

  return sections.join("\n");
}
