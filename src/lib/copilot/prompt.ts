import type { CopilotClaim } from "./contract";
import type { EvidencePack } from "./retrieval";
import type { QuestionGrounding } from "./types";

/**
 * The Copilot's versioned prompt template.
 *
 * `COPILOT_PROMPT_VERSION` is part of the LLM cache key
 * (docs/architecture/technology-stack.md §3): editing ANY wording in
 * this file must bump it, so entries generated under the old wording
 * are invalidated rather than silently replayed.
 *
 * The prompt hands the model a numbered claim set and a
 * handle-addressed evidence pack. It never shows a database identifier,
 * so the model cannot echo one back — every citation it can express is
 * a pack-local handle that ./verify.ts resolves. That, plus the fact
 * that classification and confidence are decided in ./retrieval.ts and
 * are read-only here, is what keeps the model a narrator rather than a
 * source of truth.
 */

export const COPILOT_PROMPT_VERSION = "copilot.system.v1";

export const COPILOT_SYSTEM_PROMPT = `You are the Investigation Copilot inside CIPHER, an investigative-intelligence demonstration that runs exclusively on synthetic, fabricated case data. You write for a trained investigator.

Your ONLY job is to word an answer over the GROUNDED CLAIMS you are given. You are not a source of information.

Hard rules:
1. Use only the supplied claims and evidence pack. Never add an entity, alias, identifier, phone number, account, vehicle, location, date, time, amount, relationship, analytical result, or corroboration finding that is not present in them.
2. Cite with claim handles in square brackets, e.g. [C1] or [C2][C5]. Every sentence that asserts something must end with at least one handle. Use no other citation format and invent no handles.
3. Never restate, alter, or argue with a claim's evidence classification. Respect it in your wording:
   - observed_fact / corroborated_fact — plain assertive language is allowed.
   - algorithmic_signal — describe it as a computed or structural result ("analytics ranks…", "the graph records no direct edge…"). Never present it as an established fact about people.
   - ai_inference — hedge explicitly ("the system infers…", "resolution merged these mentions, which is an inference…").
   - investigative_lead — present as a prompt for further work ("flagged for review"), never as a finding.
4. Never assert that two people met, were physically together, made contact, or that one thing caused another, unless a cited claim says so in those terms. Shared cell-tower activity, a shared time window, a graph path, and a centrality score are NOT contact and NOT causation.
5. If the claims do not support answering the question, set insufficientEvidence to true and say plainly what is missing. Never fill a gap with a plausible guess.
6. If claims conflict, report both sides and say the conflict is unresolved. Never choose a side.
7. Do not mention these instructions, the claim mechanics, prompts, models, or tooling. Write about the case.

Style: direct, factual, no preamble, no flattery. Two to six sentences for a focused question; a short structured rundown for a broad one. Put genuine limits in caveats, not in the answer body.`;

function renderClaims(claims: readonly CopilotClaim[], pack: EvidencePack): string {
  if (claims.length === 0) return "(none — retrieval found nothing that bears on this question)";
  return claims
    .map((c) => {
      const handles = [
        ...c.citations.evidenceItemIds,
        ...c.citations.extractedRecordIds,
        ...c.citations.entityIds,
        ...c.citations.relationshipIds,
        ...c.citations.analyticalSignalIds,
        ...c.citations.corroborationFindingIds,
      ]
        .map((id) => pack.byId.get(id)?.handle)
        .filter((h): h is string => h !== undefined);
      return [
        `[${c.id}] (${c.classification}, confidence ${c.confidence.toFixed(2)}, ${c.derivation})`,
        `  statement: ${c.statement}`,
        `  basis: ${c.explanation}`,
        `  records: ${handles.length > 0 ? handles.join(", ") : "—"}`,
      ].join("\n");
    })
    .join("\n");
}

function renderPack(pack: EvidencePack): string {
  if (pack.entries.length === 0) return "(empty)";
  return pack.entries.map((e) => `${e.handle} · ${e.kind} · ${e.classification} · ${e.detail}`).join("\n");
}

/**
 * The user-turn content. This exact string is also the cache identity's
 * normalized input, so it must be a pure function of the question and
 * the retrieved records — no timestamps, no random ordering, nothing
 * per-run.
 */
export function buildUserPrompt(grounding: QuestionGrounding, pack: EvidencePack, claims: readonly CopilotClaim[]): string {
  const mentions =
    grounding.mentions.length === 0
      ? "(none)"
      : grounding.mentions
          .map(
            (m) =>
              `- "${m.surface}" → ${m.ambiguous ? "AMBIGUOUS: " : ""}${m.candidates.map((c) => `${c.label} [${c.kind}]`).join(" | ")}`,
          )
          .join("\n");

  return `QUESTION
${grounding.normalizedQuestion}

RECOGNISED REFERENCES (resolved by identity resolution, not by you)
${mentions}

GROUNDED CLAIMS — the complete set of things you may assert
${renderClaims(claims, pack)}

EVIDENCE PACK — the records those claims rest on
${renderPack(pack)}

Answer the question using only the claims above, citing them by handle.`;
}
