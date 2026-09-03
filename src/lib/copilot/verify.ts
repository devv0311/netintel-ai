import { z } from "zod";

import type { EvidenceClassification } from "@/lib/domain/provenance";

import { ModelAnswerSchema, type CopilotClaim, type CopilotResponse, type ModelAnswer } from "./contract";
import type { EvidencePack, PackKind } from "./retrieval";

/**
 * The anti-hallucination guardrail and the output-boundary validator
 * (blueprint task G4: "an enforced check rejecting/flagging any answer
 * containing an uncited claim or a citation that does not resolve to
 * real evidence… implemented as an automated check on every answer
 * before it reaches the user, not a prompt-level instruction alone").
 *
 * Nothing here trusts the model. Every check runs on the model's raw
 * output, and any failure discards that output entirely — the
 * deterministic narration of the same claim set is served instead, and
 * the rejection reason is reported on the response. A guardrail that
 * "repairs" a bad answer would be a guardrail that ships one.
 */

// --- what counts as evidential support ----------------------------------

/**
 * Pack kinds that constitute EVIDENTIAL support for a claim. A resolved
 * `entity` is deliberately excluded: citing an entity identifies the
 * subject of a claim, it does not evidence it. A claim that cites only
 * entities therefore can never be a fact (rule G3 below).
 */
const EVIDENTIAL_KINDS = new Set<PackKind>([
  "evidence_item",
  "extracted_record",
  "relationship",
  "analytical_signal",
  "corroboration_finding",
]);

const FACT_CLASSIFICATIONS = new Set<EvidenceClassification>(["observed_fact", "corroborated_fact"]);

function citedPackEntries(claim: CopilotClaim, pack: EvidencePack) {
  const ids = [
    ...claim.citations.evidenceItemIds,
    ...claim.citations.extractedRecordIds,
    ...claim.citations.entityIds,
    ...claim.citations.relationshipIds,
    ...claim.citations.analyticalSignalIds,
    ...claim.citations.corroborationFindingIds,
  ];
  return ids.map((id) => pack.byId.get(id)).filter((e): e is NonNullable<typeof e> => e !== undefined);
}

/**
 * Classification enforcement over the deterministic claim set — run
 * BEFORE any model is involved, so a bug in retrieval cannot leak an
 * over-stated classification into an answer either.
 *
 * G1 — a fact claim must cite at least one evidential record that is
 *      itself a fact; a corroborated_fact claim additionally needs two
 *      or more distinct evidence items, or a corroboration finding that
 *      is itself corroborated (docs/requirements.md §7's definition of
 *      Corroborated Fact).
 * G2 — an algorithmic_signal claim must either cite a persisted
 *      algorithmic signal/finding or be one the retrieval layer
 *      computed itself (`derivation: "derived"`).
 * G3 — a claim with no evidential citation at all may never be a fact.
 */
export function enforceClassifications(claims: readonly CopilotClaim[], pack: EvidencePack): string[] {
  const issues: string[] = [];
  for (const claim of claims) {
    const entries = citedPackEntries(claim, pack);
    const evidential = entries.filter((e) => EVIDENTIAL_KINDS.has(e.kind));

    if (FACT_CLASSIFICATIONS.has(claim.classification)) {
      if (evidential.length === 0) {
        issues.push(`${claim.id}: classified ${claim.classification} but cites no evidential record.`);
        continue;
      }
      if (!evidential.some((e) => FACT_CLASSIFICATIONS.has(e.classification))) {
        issues.push(
          `${claim.id}: classified ${claim.classification} but every cited record is ${[...new Set(evidential.map((e) => e.classification))].join("/")}.`,
        );
      }
      if (claim.classification === "corroborated_fact") {
        const corroboratedSource = evidential.some(
          (e) => e.kind === "corroboration_finding" && e.classification === "corroborated_fact",
        );
        if (!corroboratedSource && claim.citations.evidenceItemIds.length < 2) {
          issues.push(
            `${claim.id}: classified corroborated_fact but cites ${claim.citations.evidenceItemIds.length} evidence item(s) and no corroborated finding.`,
          );
        }
      }
    }

    if (claim.classification === "algorithmic_signal") {
      const hasSignalSource = evidential.some(
        (e) => e.kind === "analytical_signal" || e.kind === "corroboration_finding",
      );
      if (!hasSignalSource && claim.derivation !== "derived") {
        issues.push(`${claim.id}: classified algorithmic_signal but neither cites a signal/finding nor is derived.`);
      }
    }
  }
  return issues;
}

// --- literal / phrasing guardrails ---------------------------------------

/**
 * Phrases that assert physical contact, co-presence, or causation.
 * Allowed only when the identical phrase already appears in a cited
 * claim or in the evidence pack — i.e. only when a source actually said
 * it. Cell-tower co-location, a shared time window, a graph path and a
 * centrality score are none of these things.
 */
const UNSUPPORTED_ASSERTION_PHRASES = [
  "met with",
  "meeting with",
  "met in person",
  "were together",
  "was together",
  "in person with",
  "physically present with",
  "made contact",
  "in contact with",
  "face to face",
  "caused",
  "because of",
  "as a result of",
  "led to",
  "proves",
  "proven",
  "establishes that",
  "beyond doubt",
  "undoubtedly",
  "certainly",
  "definitely",
];

/** Token shapes that must never appear unless they came from the pack. */
const LITERAL_PATTERNS: RegExp[] = [
  /\bSYN-[A-Z]+-[0-9]+\b/g,
  /\+[0-9][0-9 ]{6,}[0-9]\b/g,
  /\b[A-Z]{2,}\/SYN\/[0-9]{4}\/[0-9]+\b/g,
  /\b[0-9]{4}-[0-9]{2}-[0-9]{2}\b/g,
  /\b(?:entity|evidence_item|extracted_record|relationship|analytical_signal|corroboration_finding|location|investigation)_[0-9a-f]{8,}\b/g,
  /\b[A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+\b/g,
];

/** Domain vocabulary the Copilot may legitimately capitalize without it coming from a record. */
const ALLOWED_VOCABULARY = [
  "observed fact",
  "corroborated fact",
  "algorithmic signal",
  "ai inference",
  "investigative lead",
  "investigation copilot",
  "netintel ai",
  "graph synthesis",
  "entity resolution",
  "topology analytics",
  "spatial temporal corroboration",
  "call detail record",
  "call detail records",
  "insufficient evidence",
  "operation darknet delhi",
  "no direct",
];

function allowedCorpus(claims: readonly CopilotClaim[], pack: EvidencePack, question: string): string {
  return [
    question,
    ...claims.flatMap((c) => [c.statement, c.explanation]),
    ...pack.entries.flatMap((e) => [e.label, e.detail]),
    ...ALLOWED_VOCABULARY,
  ]
    .join(" \n ")
    .toLowerCase();
}

/** Every identifier- or name-shaped literal in `text` that is not present in the pack. */
export function findFabricatedLiterals(
  text: string,
  claims: readonly CopilotClaim[],
  pack: EvidencePack,
  question: string,
): string[] {
  const corpus = allowedCorpus(claims, pack, question);
  const fabricated: string[] = [];
  for (const pattern of LITERAL_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) {
      const literal = match[0].trim();
      const normalized = literal.toLowerCase().replace(/\s+/g, " ");
      if (corpus.includes(normalized)) continue;
      if (!fabricated.includes(literal)) fabricated.push(literal);
    }
  }
  return fabricated;
}

/** Contact/causation/certainty phrasing in `text` that no cited source used. */
export function findUnsupportedAssertions(
  text: string,
  claims: readonly CopilotClaim[],
  pack: EvidencePack,
  question: string,
): string[] {
  const corpus = allowedCorpus(claims, pack, question);
  const lower = text.toLowerCase();
  return UNSUPPORTED_ASSERTION_PHRASES.filter((phrase) => lower.includes(phrase) && !corpus.includes(phrase));
}

// --- model-output validation ---------------------------------------------

const INLINE_HANDLE_PATTERN = /\[([A-Za-z]{1,2}[0-9]{1,4})\]/g;

export type ModelAnswerCheck =
  | { ok: true; answer: ModelAnswer }
  | { ok: false; rejections: string[] };

/**
 * Validates raw model output against the schema and every grounding
 * guardrail. A single failure rejects the whole answer — there is no
 * partial acceptance and no repair path.
 */
export function validateModelAnswer(
  raw: unknown,
  claims: readonly CopilotClaim[],
  pack: EvidencePack,
  question: string,
): ModelAnswerCheck {
  const parsed = ModelAnswerSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      rejections: [
        `Model output failed schema ${"copilot.answer.v1"}: ${parsed.error.issues
          .slice(0, 5)
          .map((i) => `${i.path.join(".") || "(root)"} ${i.message}`)
          .join("; ")}`,
      ],
    };
  }
  const answer = parsed.data;
  const rejections: string[] = [];
  const claimIds = new Set(claims.map((c) => c.id));

  for (const id of answer.usedClaimIds) {
    if (!claimIds.has(id)) rejections.push(`Cited claim ${id} does not exist in the grounded claim set.`);
  }

  const inline = new Set<string>();
  INLINE_HANDLE_PATTERN.lastIndex = 0;
  for (const match of answer.answer.matchAll(INLINE_HANDLE_PATTERN)) inline.add(match[1] as string);
  for (const handle of inline) {
    if (!claimIds.has(handle)) {
      rejections.push(`Answer cites ${handle}, which is not a claim in the grounded claim set.`);
    } else if (!answer.usedClaimIds.includes(handle)) {
      rejections.push(`Answer cites ${handle} inline but omits it from usedClaimIds.`);
    }
  }

  if (!answer.insufficientEvidence && inline.size === 0) {
    rejections.push("Answer asserts something but carries no inline citation.");
  }
  if (!answer.insufficientEvidence && claims.length === 0) {
    rejections.push("Answer claims to be grounded, but the grounded claim set is empty.");
  }

  const fabricated = findFabricatedLiterals(answer.answer, claims, pack, question);
  for (const literal of fabricated.slice(0, 5)) {
    rejections.push(`Answer introduces “${literal}”, which appears in no retrieved record.`);
  }

  const unsupported = findUnsupportedAssertions(answer.answer, claims, pack, question);
  for (const phrase of unsupported.slice(0, 5)) {
    rejections.push(`Answer asserts “${phrase}”, which no cited source supports.`);
  }

  for (const caveat of answer.caveats) {
    for (const literal of findFabricatedLiterals(caveat, claims, pack, question).slice(0, 2)) {
      rejections.push(`Caveat introduces “${literal}”, which appears in no retrieved record.`);
    }
  }

  return rejections.length > 0 ? { ok: false, rejections } : { ok: true, answer };
}

// --- output-boundary citation resolution ---------------------------------

export interface KnownIds {
  evidenceItemIds: ReadonlySet<string>;
  extractedRecordIds: ReadonlySet<string>;
  entityIds: ReadonlySet<string>;
  relationshipIds: ReadonlySet<string>;
  analyticalSignalIds: ReadonlySet<string>;
  corroborationFindingIds: ReadonlySet<string>;
}

/**
 * The final output-boundary check: every id the response cites must
 * resolve to a record that is actually persisted right now. This is
 * what makes "citations resolve" a verified property rather than an
 * assumption inherited from retrieval.
 */
export function assertCitationsResolve(response: CopilotResponse, known: KnownIds): string[] {
  const issues: string[] = [];
  const check = (ids: readonly string[], set: ReadonlySet<string>, kind: string, where: string) => {
    for (const id of ids) {
      if (!set.has(id)) issues.push(`${where} cites ${kind} ${id}, which does not resolve to a persisted record.`);
    }
  };

  for (const claim of response.claims) {
    check(claim.citations.evidenceItemIds, known.evidenceItemIds, "evidence item", claim.id);
    check(claim.citations.extractedRecordIds, known.extractedRecordIds, "extracted record", claim.id);
    check(claim.citations.entityIds, known.entityIds, "entity", claim.id);
    check(claim.citations.relationshipIds, known.relationshipIds, "relationship", claim.id);
    check(claim.citations.analyticalSignalIds, known.analyticalSignalIds, "analytical signal", claim.id);
    check(claim.citations.corroborationFindingIds, known.corroborationFindingIds, "corroboration finding", claim.id);
  }

  check(response.supportingEvidenceIds, known.evidenceItemIds, "evidence item", "response");
  check(response.supportingExtractedRecordIds, known.extractedRecordIds, "extracted record", "response");
  check(response.supportingEntityIds, known.entityIds, "entity", "response");
  check(response.supportingRelationshipIds, known.relationshipIds, "relationship", "response");
  check(response.supportingAnalyticalSignalIds, known.analyticalSignalIds, "analytical signal", "response");
  check(response.supportingCorroborationFindingIds, known.corroborationFindingIds, "corroboration finding", "response");

  check(response.relatedViews.entityIds, known.entityIds, "entity", "relatedViews");
  check(response.relatedViews.relationshipIds, known.relationshipIds, "relationship", "relatedViews");
  check(response.relatedViews.analyticalSignalIds, known.analyticalSignalIds, "analytical signal", "relatedViews");
  check(response.relatedViews.corroborationFindingIds, known.corroborationFindingIds, "corroboration finding", "relatedViews");

  for (const conflict of response.conflicts) {
    check(conflict.evidenceItemIds, known.evidenceItemIds, "evidence item", `conflict “${conflict.summary}”`);
  }

  return issues;
}

/** Re-parses a response through the strict contract; throws a ZodError on any breach. */
export function parseResponseOrThrow(schema: z.ZodType<CopilotResponse>, value: unknown): CopilotResponse {
  return schema.parse(value);
}
