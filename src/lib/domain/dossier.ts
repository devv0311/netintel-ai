import { z } from "zod";

import {
  ConfidenceSchema,
  EvidenceClassificationSchema,
  ProvenanceSchema,
  type EvidenceClassification,
} from "./provenance";

/**
 * A Dossier — the investigator-facing case report, per
 * docs/requirements.md §4 ("Investigation Copilot → Dossier / Report"),
 * §5 ("Dossier/report generation"), §7 (evidence classification) and §8
 * (provenance), and blueprint Workstream H tasks H1–H3.
 *
 * The dossier is an ASSEMBLY, never a new analysis. Every substantive
 * finding in it is read off a row some earlier stage already persisted
 * — an evidence source, an extracted record, a resolved entity, a graph
 * edge, an analytical signal, a corroboration finding — and it carries
 * that row's OWN classification and confidence forward unchanged. The
 * dossier has no authority to promote a claim: an Algorithmic Signal
 * stays an Algorithmic Signal, an AI Inference stays an AI Inference,
 * and a contradiction stays a contradiction. That rule is enforced
 * structurally by `SECTION_ALLOWED_CLASSIFICATIONS` below rather than
 * left to the assembly code's good behaviour.
 *
 * Two invariants the report generation task (H2) turns on are schema
 * refinements here, so a violation cannot reach the database:
 *
 *   - every finding cites at least one persisted id (§8: "traceable in
 *     full, back to source evidence" — an uncited finding is not a
 *     finding, it is an assertion);
 *   - every finding's classification is one the section permits.
 *
 * `syntheticDataOnly` and `humanVerificationRequired` are fixed `true`
 * literals rather than booleans: this report is generated from the
 * fabricated Operation DarkNet Delhi corpus and is decision-support for
 * a human reviewer, never a finished investigative conclusion, and
 * neither statement is something a caller may switch off.
 */

// --- sections ----------------------------------------------------------

export const DOSSIER_SECTION_KINDS = [
  /** Case identity, corpus scale, pipeline versions. Narrative + notes; carries no findings of its own. */
  "case_summary",
  /** What evidence the case rests on, per source. */
  "evidence_inventory",
  /** The resolved entities the case turns on, with their aliases and merge rationale. */
  "key_entities",
  /** The graph edges that matter, each with the evidence behind it. */
  "key_relationships",
  /** Topology signals over the current graph version. */
  "analytical_signals",
  /** Spatial/temporal agreement between independent sources. */
  "corroboration",
  /** Conflicts between sources — reported, never resolved. */
  "contradictions",
  /** What a human should check next. Never a claim of fact. */
  "investigative_leads",
  /** Copilot answers included as supporting material, with their grounding intact. */
  "copilot_material",
  /** How to trace any finding above back to its originating rows. */
  "provenance_index",
  /** The classification legend and the confidence scale the report uses. */
  "classification_confidence",
  /** What this report does NOT establish. */
  "limitations",
] as const;
export const DossierSectionKindSchema = z.enum(DOSSIER_SECTION_KINDS);
export type DossierSectionKind = z.infer<typeof DossierSectionKindSchema>;

/**
 * Which evidence classifications each section may carry — the
 * structural form of "never upgrade evidence classification".
 *
 * An empty list means the section is narrative (summary + notes) and
 * carries no findings at all: `case_summary` describes the case rather
 * than claiming anything about it, and `provenance_index`,
 * `classification_confidence` and `limitations` are apparatus, not
 * findings. A section is never given a wider set than its upstream
 * source can actually produce — `analytical_signals` maps to
 * `analytical_signals.classification` (a fixed `algorithmic_signal`
 * literal), `investigative_leads` to `investigative_leads`, and
 * `contradictions` to the corroboration contract's rule that a flagged
 * inconsistency is always an Algorithmic Signal and never itself a
 * fact.
 */
export const SECTION_ALLOWED_CLASSIFICATIONS: Record<
  DossierSectionKind,
  readonly EvidenceClassification[]
> = {
  case_summary: [],
  // Read straight off persisted evidence rows, no inference applied.
  evidence_inventory: ["observed_fact"],
  // An entity is entity resolution's output, which is always AI Inference
  // (see src/lib/domain/resolution.ts) however deterministic the rule was.
  key_entities: ["ai_inference"],
  // An edge carries whatever src/lib/graph/build.ts assigned it.
  key_relationships: ["observed_fact", "corroborated_fact", "ai_inference"],
  analytical_signals: ["algorithmic_signal"],
  corroboration: ["corroborated_fact", "algorithmic_signal"],
  contradictions: ["algorithmic_signal"],
  investigative_leads: ["investigative_lead"],
  // A Copilot claim may legitimately be any of the five; the excerpt
  // keeps whatever the claim itself was labelled.
  copilot_material: [
    "observed_fact",
    "corroborated_fact",
    "algorithmic_signal",
    "ai_inference",
    "investigative_lead",
  ],
  provenance_index: [],
  classification_confidence: [],
  limitations: [],
};

/** True when the section is narrative apparatus rather than a findings surface. */
export function isNarrativeSection(kind: DossierSectionKind): boolean {
  return SECTION_ALLOWED_CLASSIFICATIONS[kind].length === 0;
}

// --- references --------------------------------------------------------

/**
 * Resolved references into already-persisted rows. Ids only — the
 * dossier never inlines a copy of an evidence payload, because a copy
 * cannot be re-checked against the store and would drift the moment
 * anything upstream changed. Every id here is expected to resolve
 * through the existing repository layer; src/lib/dossier/verify.ts
 * enforces that before anything is written.
 */
export const DossierReferencesSchema = z.object({
  evidenceSourceIds: z.array(z.string().min(1)),
  evidenceItemIds: z.array(z.string().min(1)),
  extractedRecordIds: z.array(z.string().min(1)),
  entityIds: z.array(z.string().min(1)),
  /**
   * `locations.id`. Kept separate from `entityIds` because the P5.6
   * analysis graph and the P5.7 corroboration findings both treat
   * locations as nodes alongside entities — a community's members or a
   * co-location finding's anchors can be either, and collapsing the two
   * would make an unresolvable id look resolvable.
   */
  locationIds: z.array(z.string().min(1)),
  /** `resolution_decisions.id` — the merge rationale behind an entity, and the anchor for an ambiguity lead. */
  resolutionDecisionIds: z.array(z.string().min(1)),
  /** `communication_events.id` — corroboration cites these alongside extracted records as its supporting rows. */
  communicationEventIds: z.array(z.string().min(1)),
  relationshipIds: z.array(z.string().min(1)),
  analyticalSignalIds: z.array(z.string().min(1)),
  corroborationFindingIds: z.array(z.string().min(1)),
});
export type DossierReferences = z.infer<typeof DossierReferencesSchema>;

export function countReferences(refs: DossierReferences): number {
  return (
    refs.evidenceSourceIds.length +
    refs.evidenceItemIds.length +
    refs.extractedRecordIds.length +
    refs.entityIds.length +
    refs.locationIds.length +
    refs.resolutionDecisionIds.length +
    refs.communicationEventIds.length +
    refs.relationshipIds.length +
    refs.analyticalSignalIds.length +
    refs.corroborationFindingIds.length
  );
}

export const EMPTY_DOSSIER_REFERENCES: DossierReferences = {
  evidenceSourceIds: [],
  evidenceItemIds: [],
  extractedRecordIds: [],
  entityIds: [],
  locationIds: [],
  resolutionDecisionIds: [],
  communicationEventIds: [],
  relationshipIds: [],
  analyticalSignalIds: [],
  corroborationFindingIds: [],
};

// --- findings ----------------------------------------------------------

export const DossierFindingSchema = z
  .object({
    /** Content-addressed (see src/lib/dossier/assemble.ts) — the same case state always yields the same id. */
    id: z.string().min(1),
    sectionKind: DossierSectionKindSchema,
    /**
     * The finding as an investigator reads it. Phrasing is the
     * assembler's responsibility: established-fact wording is reserved
     * for `observed_fact`/`corroborated_fact`, and everything else is
     * hedged and attributed (docs/requirements.md §7).
     */
    statement: z.string().min(1),
    /** Carried forward from the source row. The dossier never assigns a stronger label than the row it read. */
    classification: EvidenceClassificationSchema,
    /** Carried forward from the source row's own confidence. */
    confidence: ConfidenceSchema,
    /** `dossier:<section>` for an assembled roll-up, or the upstream row's own method when one is carried through. */
    derivationMethod: z.string().min(1),
    /** How this finding was produced, in the reader's terms. */
    explanation: z.string().min(1),
    references: DossierReferencesSchema,
    provenance: ProvenanceSchema,
  })
  .refine((f) => countReferences(f.references) > 0, {
    message: "every dossier finding must reference at least one persisted record",
    path: ["references"],
  })
  .refine(
    (f) => SECTION_ALLOWED_CLASSIFICATIONS[f.sectionKind].includes(f.classification),
    {
      message: "classification is not permitted in this dossier section",
      path: ["classification"],
    },
  );
export type DossierFinding = z.infer<typeof DossierFindingSchema>;

export const DossierSectionSchema = z
  .object({
    kind: DossierSectionKindSchema,
    title: z.string().min(1),
    /** Deterministic prose derived from the counts below — never model-authored. */
    summary: z.string().min(1),
    /** The pipeline stages this section's material came from, for the reader. */
    sourceStages: z.array(z.string().min(1)).min(1),
    findings: z.array(DossierFindingSchema),
    /** Section-level prose that is not a finding (counts, legends, caveats). */
    notes: z.array(z.string().min(1)),
  })
  .refine((s) => s.findings.every((f) => f.sectionKind === s.kind), {
    message: "a finding must declare the section it appears in",
    path: ["findings"],
  })
  .refine((s) => !isNarrativeSection(s.kind) || s.findings.length === 0, {
    message: "a narrative section carries notes, never findings",
    path: ["findings"],
  });
export type DossierSection = z.infer<typeof DossierSectionSchema>;

// --- Copilot excerpts ---------------------------------------------------

/**
 * How a Copilot excerpt turned out. The first three mirror
 * `CopilotAnswerStatus` exactly; `unavailable` is the dossier's own
 * fourth case, for when the Copilot could not be consulted at all
 * (the service reported a structured failure). It is recorded as an
 * explicit gap with its reason — never smoothed over, and never
 * replaced with invented prose.
 */
export const DOSSIER_COPILOT_STATUSES = [
  "answered",
  "insufficient_evidence",
  "ambiguous",
  "unavailable",
] as const;
export const DossierCopilotStatusSchema = z.enum(DOSSIER_COPILOT_STATUSES);
export type DossierCopilotStatus = z.infer<typeof DossierCopilotStatusSchema>;

/**
 * One Copilot answer carried into the dossier as supporting material.
 *
 * Everything that made the answer trustworthy travels with it: its
 * grounding status, its per-answer classification floor and confidence,
 * its citations, and the synthesis mode that produced the wording. An
 * excerpt is never re-worded, re-classified, or promoted by the
 * dossier; if the Copilot said the evidence was insufficient, the
 * dossier says so too.
 */
export const DossierCopilotExcerptSchema = z
  .object({
    /** Stable id for the dossier question this excerpt answers (`dq1`, `dq2`, …). */
    questionId: z.string().min(1),
    question: z.string().min(1),
    status: DossierCopilotStatusSchema,
    /** The Copilot's own answer text, verbatim. Null only when status is `unavailable`. */
    answer: z.string().min(1).nullable(),
    /** Null when unavailable; otherwise the Copilot's own grounding status. */
    grounding: z.enum(["fully_grounded", "partially_grounded", "insufficient_evidence"]).nullable(),
    /** The Copilot's answer-level classification floor (its weakest claim). Null when unavailable. */
    classification: EvidenceClassificationSchema.nullable(),
    confidence: ConfidenceSchema.nullable(),
    /** How the prose was produced — disclosed, per docs/requirements.md §6. Null when unavailable. */
    synthesisMode: z.enum(["llm_synthesis", "deterministic", "deterministic_fallback"]).nullable(),
    /** True when the wording came from a live/cached model call rather than deterministic narration. */
    aiSynthesized: z.boolean(),
    claimCount: z.number().int().min(0),
    references: DossierReferencesSchema,
    /** Present when the Copilot could not be consulted, or its prose fell back. Never a stack trace. */
    note: z.string().min(1).nullable(),
  })
  .refine((e) => e.status !== "unavailable" || e.answer === null, {
    message: "an unavailable excerpt must not carry an answer",
    path: ["answer"],
  })
  .refine((e) => e.status === "unavailable" || e.answer !== null, {
    message: "an available excerpt must carry the Copilot's own answer text",
    path: ["answer"],
  })
  .refine((e) => e.status !== "unavailable" || e.note !== null, {
    message: "an unavailable excerpt must record why",
    path: ["note"],
  })
  .refine((e) => !e.aiSynthesized || e.synthesisMode === "llm_synthesis", {
    message: "only an llm_synthesis excerpt may be marked AI-synthesized",
    path: ["aiSynthesized"],
  });
export type DossierCopilotExcerpt = z.infer<typeof DossierCopilotExcerptSchema>;

// --- counts -------------------------------------------------------------

/**
 * A classification census with every one of the five classifications
 * present, zeros included.
 *
 * Exhaustive rather than sparse on purpose: the report's classification
 * legend lists all five, and "0 investigative leads" is a meaningful
 * statement about the case, while a missing key is ambiguous between
 * "none" and "not counted".
 */
export function emptyClassificationCensus(): Record<EvidenceClassification, number> {
  return {
    observed_fact: 0,
    corroborated_fact: 0,
    algorithmic_signal: 0,
    ai_inference: 0,
    investigative_lead: 0,
  };
}

export const DossierCountsSchema = z.object({
  sections: z.number().int().min(0),
  findings: z.number().int().min(0),
  evidenceSources: z.number().int().min(0),
  evidenceItems: z.number().int().min(0),
  entities: z.number().int().min(0),
  relationships: z.number().int().min(0),
  analyticalSignals: z.number().int().min(0),
  corroborationFindings: z.number().int().min(0),
  contradictions: z.number().int().min(0),
  leads: z.number().int().min(0),
  copilotExcerpts: z.number().int().min(0),
  /** Findings per evidence classification — the report's own classification census. */
  byClassification: z.record(EvidenceClassificationSchema, z.number().int().min(0)),
});
export type DossierCounts = z.infer<typeof DossierCountsSchema>;

// --- the dossier --------------------------------------------------------

export const DossierSchema = z
  .object({
    /** Content-addressed over the deterministic body — identical case state yields an identical id. */
    id: z.string().min(1),
    investigationId: z.string().min(1),
    investigationName: z.string().min(1),
    /** The exact P5.5 graph version every derived finding here was computed against. */
    graphVersion: z.string().min(1),
    /** `dossier.v1.<12-hex digest>` of the deterministic body. Two runs over the same state agree. */
    reportVersion: z.string().min(1),
    title: z.string().min(1),
    /** When this report was assembled. Deliberately NOT part of the content digest. */
    generatedAt: z.string().datetime(),
    /** Fixed true — the corpus is fabricated (docs/requirements.md §9). */
    syntheticDataOnly: z.literal(true),
    /** Fixed true — this is decision support for a human reviewer, not a conclusion. */
    humanVerificationRequired: z.literal(true),
    /** Whether a model was available to narrate the Copilot excerpts on this run. */
    aiSynthesisAvailable: z.boolean(),
    /** Always populated: says either how AI synthesis was used, or that it was unavailable and what stood in. */
    aiSynthesisNote: z.string().min(1),
    sections: z.array(DossierSectionSchema).min(1),
    copilotExcerpts: z.array(DossierCopilotExcerptSchema),
    /** What this report does not establish. Never empty — a report with no stated limits overstates itself. */
    limitations: z.array(z.string().min(1)).min(1),
    counts: DossierCountsSchema,
    provenance: ProvenanceSchema,
  })
  .refine(
    (d) => new Set(d.sections.map((s) => s.kind)).size === d.sections.length,
    { message: "each dossier section may appear at most once", path: ["sections"] },
  )
  .refine(
    (d) => d.counts.findings === d.sections.reduce((n, s) => n + s.findings.length, 0),
    { message: "counts.findings must equal the number of findings actually present", path: ["counts"] },
  )
  .refine((d) => d.aiSynthesisAvailable || d.copilotExcerpts.every((e) => !e.aiSynthesized), {
    message: "no excerpt may be marked AI-synthesized when AI synthesis was unavailable",
    path: ["copilotExcerpts"],
  });
export type Dossier = z.infer<typeof DossierSchema>;
