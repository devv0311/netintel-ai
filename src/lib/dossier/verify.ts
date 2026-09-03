import {
  DossierSchema,
  SECTION_ALLOWED_CLASSIFICATIONS,
  countReferences,
  isNarrativeSection,
  type Dossier,
  type DossierFinding,
} from "@/lib/domain/dossier";
import { validateSafe } from "@/lib/domain/validation";

import { DossierServiceError } from "./errors";
import type { DossierSnapshot } from "./load";

/**
 * Stage: validate and verify the assembled report.
 *
 * Blueprint task H2 requires that generation "fail loudly (not
 * silently) if any claim cannot be classified or traced" and that it
 * "must not emit a report with any unclassified or untraceable claim".
 * That is what this module is for: it runs before anything is written,
 * and every problem it finds aborts the whole report rather than
 * dropping the offending finding and shipping the rest. A dossier that
 * quietly lost a contradiction would be worse than no dossier.
 *
 * The checks here duplicate what `DossierSchema` already enforces on
 * write. That is deliberate, and matches src/lib/corroboration/verify.ts
 * — the schema protects the database, this protects the reader, and the
 * error a reader gets should name the specific finding rather than a
 * Zod path.
 */

export function validateReport(candidate: unknown): Dossier {
  const result = validateSafe(DossierSchema, candidate);
  if (!result.valid) {
    throw new DossierServiceError(
      "VALIDATION_FAILURE",
      "validate_report",
      "The assembled dossier failed validation and was rejected. No report was written.",
      result.errors.map((e) => `${e.path?.join(".") ?? "(root)"}: ${e.message}`),
    );
  }
  return result.data;
}

/** Every persisted id the report is allowed to reference, built from the snapshot it was assembled from. */
export interface KnownIds {
  evidenceSourceIds: Set<string>;
  evidenceItemIds: Set<string>;
  extractedRecordIds: Set<string>;
  entityIds: Set<string>;
  locationIds: Set<string>;
  resolutionDecisionIds: Set<string>;
  communicationEventIds: Set<string>;
  relationshipIds: Set<string>;
  analyticalSignalIds: Set<string>;
  corroborationFindingIds: Set<string>;
}

export function knownIdsFrom(snapshot: DossierSnapshot): KnownIds {
  return {
    evidenceSourceIds: new Set(snapshot.evidenceSources.map((r) => r.id)),
    evidenceItemIds: new Set(snapshot.evidenceItems.map((r) => r.id)),
    extractedRecordIds: new Set(snapshot.extractedRecords.map((r) => r.id)),
    entityIds: new Set(snapshot.entities.map((r) => r.id)),
    locationIds: new Set(snapshot.locations.map((r) => r.id)),
    resolutionDecisionIds: new Set(snapshot.resolutionDecisions.map((r) => r.id)),
    communicationEventIds: new Set(snapshot.communicationEvents.map((r) => r.id)),
    relationshipIds: new Set(snapshot.relationships.map((r) => r.id)),
    analyticalSignalIds: new Set(snapshot.analyticalSignals.map((r) => r.id)),
    corroborationFindingIds: new Set(snapshot.corroborationFindings.map((r) => r.id)),
  };
}

function checkReferences(finding: DossierFinding, known: KnownIds, problems: string[]): void {
  const groups: [keyof KnownIds, string[], string][] = [
    ["evidenceSourceIds", finding.references.evidenceSourceIds, "evidence source"],
    ["evidenceItemIds", finding.references.evidenceItemIds, "evidence item"],
    ["extractedRecordIds", finding.references.extractedRecordIds, "extracted record"],
    ["entityIds", finding.references.entityIds, "entity"],
    ["locationIds", finding.references.locationIds, "location"],
    ["resolutionDecisionIds", finding.references.resolutionDecisionIds, "resolution decision"],
    ["communicationEventIds", finding.references.communicationEventIds, "communication event"],
    ["relationshipIds", finding.references.relationshipIds, "relationship"],
    ["analyticalSignalIds", finding.references.analyticalSignalIds, "analytical signal"],
    ["corroborationFindingIds", finding.references.corroborationFindingIds, "corroboration finding"],
  ];
  for (const [key, ids, label] of groups) {
    for (const id of ids) {
      if (!known[key].has(id)) {
        problems.push(`finding ${finding.id}: ${label} id "${id}" does not resolve to a persisted record`);
      }
    }
  }
}

function checkProvenance(finding: DossierFinding, problems: string[]): void {
  const p = finding.provenance;
  if (!p.source || !p.location || !p.method) {
    problems.push(`finding ${finding.id}: provenance is missing source/location/method`);
  }
  if (p.confidence < 0 || p.confidence > 1) {
    problems.push(`finding ${finding.id}: provenance.confidence is out of range`);
  }
  if (!Array.isArray(p.processingHistory) || p.processingHistory.length === 0) {
    problems.push(`finding ${finding.id}: provenance.processingHistory is empty`);
  } else if (p.processingHistory[p.processingHistory.length - 1] !== "dossier:assemble") {
    problems.push(`finding ${finding.id}: processing history does not end at the dossier assembly step`);
  }
}

/**
 * Verifies that the report is traceable and correctly classified, in
 * full, before it is persisted.
 *
 * Checks, per finding: it carries a classification the section permits
 * (never an upgrade); it cites at least one persisted record; every id
 * it cites actually resolves; and its provenance is complete and ends
 * at this stage. Checks, per report: contradictions stayed Algorithmic
 * Signals, leads stayed Investigative Leads, analytical signals stayed
 * Algorithmic Signals, narrative sections carry no findings, and the
 * whole report is stamped with the graph version it was assembled from.
 *
 * Returns the number of findings verified.
 */
export function assertTraceability(
  dossier: Dossier,
  known: KnownIds,
  expectedGraphVersion: string,
): number {
  const problems: string[] = [];

  if (dossier.graphVersion !== expectedGraphVersion) {
    problems.push(
      `dossier ${dossier.id}: graphVersion "${dossier.graphVersion}" does not match the graph version this run assembled`,
    );
  }

  let verified = 0;
  for (const section of dossier.sections) {
    if (isNarrativeSection(section.kind) && section.findings.length > 0) {
      problems.push(`section ${section.kind}: narrative sections carry notes, never findings`);
    }
    for (const finding of section.findings) {
      verified += 1;

      if (finding.sectionKind !== section.kind) {
        problems.push(`finding ${finding.id}: declares section "${finding.sectionKind}" but appears in "${section.kind}"`);
      }

      // 100% classified — the report-generation pass threshold in
      // docs/evaluation/evaluation-spec.md is a correctness requirement,
      // not a tunable target.
      const allowed = SECTION_ALLOWED_CLASSIFICATIONS[section.kind];
      if (!allowed.includes(finding.classification)) {
        problems.push(
          `finding ${finding.id}: classification "${finding.classification}" is not permitted in section "${section.kind}" — the dossier may never relabel a claim`,
        );
      }

      // 100% traceable.
      if (countReferences(finding.references) === 0) {
        problems.push(`finding ${finding.id}: carries no reference to any persisted record`);
      }
      checkReferences(finding, known, problems);
      checkProvenance(finding, problems);

      if (finding.confidence < 0 || finding.confidence > 1) {
        problems.push(`finding ${finding.id}: confidence is out of range`);
      }
      if (!finding.derivationMethod) {
        problems.push(`finding ${finding.id}: carries no derivation method`);
      }
    }
  }

  // Section-level invariants, stated positively so a regression names
  // itself rather than showing up as a missing section.
  const sectionByKind = new Map(dossier.sections.map((s) => [s.kind, s]));

  const contradictions = sectionByKind.get("contradictions");
  if (contradictions) {
    for (const f of contradictions.findings) {
      if (f.classification !== "algorithmic_signal") {
        problems.push(`finding ${f.id}: a contradiction must remain an Algorithmic Signal, never a fact`);
      }
    }
  }

  const leads = sectionByKind.get("investigative_leads");
  if (leads) {
    for (const f of leads.findings) {
      if (f.classification !== "investigative_lead") {
        problems.push(`finding ${f.id}: an investigative lead must remain an Investigative Lead, never a claim of fact`);
      }
    }
  }

  const signals = sectionByKind.get("analytical_signals");
  if (signals) {
    for (const f of signals.findings) {
      if (f.classification !== "algorithmic_signal") {
        problems.push(`finding ${f.id}: an analytical signal must remain an Algorithmic Signal`);
      }
    }
  }

  if (!dossier.syntheticDataOnly) {
    problems.push("dossier: the synthetic-data declaration was cleared");
  }
  if (!dossier.humanVerificationRequired) {
    problems.push("dossier: the human-verification declaration was cleared");
  }
  if (dossier.limitations.length === 0) {
    problems.push("dossier: a report with no stated limitations overstates itself");
  }

  // No excerpt may claim AI synthesis the run did not perform.
  for (const excerpt of dossier.copilotExcerpts) {
    if (excerpt.aiSynthesized && !dossier.aiSynthesisAvailable) {
      problems.push(`copilot excerpt ${excerpt.questionId}: marked AI-synthesized on a run with no AI synthesis available`);
    }
    if (excerpt.status === "unavailable" && excerpt.answer !== null) {
      problems.push(`copilot excerpt ${excerpt.questionId}: an unavailable excerpt must not carry answer text`);
    }
  }

  if (problems.length > 0) {
    throw new DossierServiceError(
      "TRACEABILITY_FAILURE",
      "verify_traceability",
      "One or more dossier findings could not be classified or traced back to a persisted record. No report was written — the dossier fails rather than emitting a partial report.",
      problems,
    );
  }

  return verified;
}
