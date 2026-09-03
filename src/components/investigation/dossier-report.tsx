"use client";

import { useState } from "react";
import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  FolderOpen,
  Network,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatCount, formatUtc } from "@/lib/format";
import type { DossierDetail, DossierFinding, DossierSection, ResolvedReference } from "@/lib/dossier/types";
import type { DossierCopilotExcerpt, DossierSectionKind } from "@/lib/domain/dossier";
import type { EvidenceClassification } from "@/lib/domain/provenance";

/**
 * The rendered dossier — blueprint task H3.
 *
 * The rule this component exists to obey: "preserve classification and
 * traceability VISIBLY in the rendered form — do not render a 'clean'
 * version that drops the labels for presentation polish." So every
 * finding shows its own classification badge and confidence inline, and
 * every finding can be expanded to its explanation, the exact persisted
 * ids it rests on, its full six-field provenance, and a route into the
 * screen that owns those ids. Nothing is summarised away.
 */

const CLASSIFICATION_LABELS: Record<EvidenceClassification, string> = {
  observed_fact: "Observed Fact",
  corroborated_fact: "Corroborated Fact",
  algorithmic_signal: "Algorithmic Signal",
  ai_inference: "AI Inference",
  investigative_lead: "Investigative Lead",
};

const CLASSIFICATION_NOTE: Record<EvidenceClassification, string> = {
  observed_fact: "Stated directly in one source, no inference applied.",
  corroborated_fact: "Independently supported by two or more distinct sources.",
  algorithmic_signal: "A computed property of the data — not a claim about people.",
  ai_inference: "Goes beyond directly observed evidence — treat as provisional.",
  investigative_lead: "A prompt for further work. Not a claim of fact at any confidence.",
};

/** Only the two fact classifications get the assertive (accent) treatment. */
function badgeVariant(classification: EvidenceClassification): "accent" | "outline" {
  return classification === "corroborated_fact" || classification === "observed_fact" ? "accent" : "outline";
}

const SECTION_ORDER: DossierSectionKind[] = [
  "case_summary",
  "evidence_inventory",
  "key_entities",
  "key_relationships",
  "analytical_signals",
  "corroboration",
  "contradictions",
  "investigative_leads",
  "copilot_material",
  "provenance_index",
  "classification_confidence",
  "limitations",
];

export function DossierReport({
  detail,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
  onViewEvidence,
}: {
  detail: DossierDetail;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
  onViewEvidence: () => void;
}) {
  const { dossier, references, stale, currentGraphVersion } = detail;
  const sections = [...dossier.sections].sort(
    (a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind),
  );

  return (
    <div className="flex flex-col gap-4" data-testid="dossier-report">
      {/* HEADER / INVESTIGATION IDENTITY */}
      <Card className="gap-3" data-testid="dossier-report-header">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-base font-semibold" data-testid="dossier-title">
            {dossier.title}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground" data-testid="dossier-report-version">
            {dossier.reportVersion}
          </span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
          <span>investigation</span>
          <span className="font-mono text-[10px]">{dossier.investigationId}</span>
          <span>graph version</span>
          <span className="font-mono text-[10px]" data-testid="dossier-graph-version">
            {dossier.graphVersion}
          </span>
          <span>generated</span>
          <span className="font-mono text-[10px]" data-testid="dossier-generated-at">
            {formatUtc(dossier.generatedAt)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-1.5" data-testid="dossier-census">
          <Badge variant="outline">{formatCount(dossier.counts.findings)} findings</Badge>
          <Badge variant="outline">{formatCount(dossier.counts.sections)} sections</Badge>
          {(Object.entries(dossier.counts.byClassification) as [EvidenceClassification, number][])
            .filter(([, n]) => n > 0)
            .map(([classification, n]) => (
              <Badge
                key={classification}
                variant={badgeVariant(classification)}
                data-testid={`dossier-census-${classification}`}
              >
                {n} {CLASSIFICATION_LABELS[classification]}
              </Badge>
            ))}
        </div>

        {stale && (
          <div
            className="flex items-start gap-2 rounded-md border border-accent/50 px-3 py-2 text-xs"
            data-testid="dossier-stale-notice"
          >
            <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
            <span>
              This report describes graph version{" "}
              <span className="font-mono text-[10px]">{dossier.graphVersion}</span>, which has been superseded by{" "}
              <span className="font-mono text-[10px]">{currentGraphVersion}</span>. It is kept for audit but is no
              longer a description of the case as it now stands. Regenerate to describe the current graph.
            </span>
          </div>
        )}

        {/* SYNTHETIC-DATA INDICATOR */}
        <div
          className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
          data-testid="dossier-synthetic-notice"
        >
          <ShieldAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong>Synthetic data only.</strong> Every person, phone, account, vehicle, location, transaction and
            event in this case is fabricated. No real investigation, individual, agency or record is represented.
          </span>
        </div>

        {/* HUMAN-VERIFICATION DISCLAIMER */}
        <div
          className="flex items-start gap-2.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground"
          data-testid="dossier-verification-notice"
        >
          <UserCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong>Requires human verification.</strong> This report is decision support for a human reviewer. It
            establishes nothing on its own, and nothing in it is a finished investigative conclusion.
          </span>
        </div>

        <p className="text-xs text-muted-foreground" data-testid="dossier-ai-note">
          {dossier.aiSynthesisNote}
        </p>
      </Card>

      {sections.map((section) => (
        <SectionCard
          key={section.kind}
          section={section}
          references={references}
          excerpts={section.kind === "copilot_material" ? dossier.copilotExcerpts : []}
          onViewInGraph={onViewInGraph}
          onViewInAnalytics={onViewInAnalytics}
          onViewInCorroboration={onViewInCorroboration}
          onViewEvidence={onViewEvidence}
        />
      ))}
    </div>
  );
}

function SectionCard({
  section,
  references,
  excerpts,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
  onViewEvidence,
}: {
  section: DossierSection;
  references: Record<string, ResolvedReference>;
  excerpts: DossierCopilotExcerpt[];
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
  onViewEvidence: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Card className="gap-3" data-testid="dossier-section" data-section-kind={section.kind}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="text-sm font-semibold" data-testid="dossier-section-title">
          {section.title}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground">
          {section.sourceStages.join(" · ")}
        </span>
        {section.findings.length > 0 && (
          <Badge variant="outline" className="ml-auto">
            {formatCount(section.findings.length)} {section.findings.length === 1 ? "finding" : "findings"}
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground" data-testid="dossier-section-summary">
        {section.summary}
      </p>

      {section.findings.length > 0 && (
        <ul className="flex flex-col gap-1" data-testid="dossier-section-findings">
          {section.findings.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              references={references}
              open={expanded === finding.id}
              onToggle={() => setExpanded((prev) => (prev === finding.id ? null : finding.id))}
              onViewInGraph={onViewInGraph}
              onViewInAnalytics={onViewInAnalytics}
              onViewInCorroboration={onViewInCorroboration}
              onViewEvidence={onViewEvidence}
            />
          ))}
        </ul>
      )}

      {excerpts.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-3" data-testid="dossier-copilot-excerpts">
          {excerpts.map((excerpt) => (
            <CopilotExcerptRow key={excerpt.questionId} excerpt={excerpt} />
          ))}
        </div>
      )}

      {section.notes.length > 0 && (
        <ul
          className="flex list-disc flex-col gap-1 border-t border-border pl-4 pt-3 text-xs text-muted-foreground"
          data-testid="dossier-section-notes"
        >
          {section.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function FindingRow({
  finding,
  references,
  open,
  onToggle,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
  onViewEvidence,
}: {
  finding: DossierFinding;
  references: Record<string, ResolvedReference>;
  open: boolean;
  onToggle: () => void;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
  onViewEvidence: () => void;
}) {
  const groups: [string, string[]][] = [
    ["evidence sources", finding.references.evidenceSourceIds],
    ["evidence items", finding.references.evidenceItemIds],
    ["extracted records", finding.references.extractedRecordIds],
    ["entities", finding.references.entityIds],
    ["locations", finding.references.locationIds],
    ["resolution decisions", finding.references.resolutionDecisionIds],
    ["communication events", finding.references.communicationEventIds],
    ["relationships", finding.references.relationshipIds],
    ["analytical signals", finding.references.analyticalSignalIds],
    ["corroboration findings", finding.references.corroborationFindingIds],
  ];

  const allIds = groups.flatMap(([, ids]) => ids);
  const resolved = allIds.map((id) => references[id]).filter((r): r is ResolvedReference => Boolean(r));
  const graphTarget = resolved.find((r) => r.view === "graph" && r.focusEntityId)?.focusEntityId ?? null;
  const analyticsTarget = resolved.find((r) => r.view === "analytics" && r.focusEntityId)?.focusEntityId ?? null;
  const corroborationTarget =
    resolved.find((r) => r.view === "corroboration" && r.focusEntityId)?.focusEntityId ?? null;
  const hasEvidence = resolved.some((r) => r.view === "evidence");

  return (
    <li data-testid="dossier-finding" data-classification={finding.classification} data-finding-id={finding.id}>
      <button
        type="button"
        onClick={onToggle}
        data-testid="dossier-finding-toggle"
        className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${open ? "bg-muted" : ""}`}
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
        <span className="min-w-0 flex-1 text-foreground">{finding.statement}</span>
        <Badge
          variant={badgeVariant(finding.classification)}
          className="shrink-0"
          data-testid="dossier-finding-classification"
        >
          {CLASSIFICATION_LABELS[finding.classification]}
        </Badge>
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground" data-testid="dossier-finding-confidence">
          {finding.confidence.toFixed(2)}
        </span>
      </button>

      {open && (
        <div
          className="ml-6 flex flex-col gap-2 border-l border-border pl-3 pt-1.5 text-xs"
          data-testid="dossier-finding-detail"
        >
          <p className="text-muted-foreground">{finding.explanation}</p>
          <span className="text-[10px] text-muted-foreground">
            {CLASSIFICATION_NOTE[finding.classification]}
          </span>

          {/* TRACEABILITY — the exact persisted rows this rests on. */}
          <div className="flex flex-col gap-1" data-testid="dossier-finding-references">
            {groups
              .filter(([, ids]) => ids.length > 0)
              .map(([label, ids]) => (
                <div key={label} className="flex flex-wrap items-baseline gap-1">
                  <span className="text-muted-foreground">{label}:</span>
                  {ids.slice(0, 8).map((id) => (
                    <span
                      key={id}
                      title={references[id]?.label ?? id}
                      className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground"
                    >
                      {references[id]?.label ?? id}
                    </span>
                  ))}
                  {ids.length > 8 && <span className="text-[10px] text-muted-foreground">+{ids.length - 8} more</span>}
                </div>
              ))}
          </div>

          {/* PROVENANCE — the six required fields, in full. */}
          <div
            className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 border-t border-border pt-1.5 text-[10px] text-muted-foreground"
            data-testid="dossier-finding-provenance"
          >
            <span>source</span>
            <span className="truncate font-mono">{finding.provenance.source}</span>
            <span>location</span>
            <span className="truncate font-mono">{finding.provenance.location}</span>
            <span>method</span>
            <span className="font-mono">{finding.provenance.method}</span>
            <span>confidence</span>
            <span className="font-mono">{finding.provenance.confidence.toFixed(2)}</span>
            <span>history</span>
            <span className="font-mono">{finding.provenance.processingHistory.join(" → ")}</span>
            <span>derived at</span>
            <span className="font-mono">{finding.provenance.timestamp}</span>
          </div>

          {/* CROSS-NAVIGATION into the screens that own these ids. */}
          <div className="flex flex-wrap gap-1.5">
            {graphTarget && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="dossier-view-in-graph"
                onClick={() => onViewInGraph(graphTarget)}
              >
                <Network className="size-3.5" aria-hidden />
                Graph
              </Button>
            )}
            {analyticsTarget && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="dossier-view-in-analytics"
                onClick={() => onViewInAnalytics(analyticsTarget)}
              >
                <BarChart3 className="size-3.5" aria-hidden />
                Analytics
              </Button>
            )}
            {corroborationTarget && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="dossier-view-in-corroboration"
                onClick={() => onViewInCorroboration(corroborationTarget)}
              >
                <ShieldCheck className="size-3.5" aria-hidden />
                Corroboration
              </Button>
            )}
            {hasEvidence && (
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="dossier-view-evidence"
                onClick={onViewEvidence}
              >
                <FolderOpen className="size-3.5" aria-hidden />
                Evidence
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

const EXCERPT_STATUS_LABELS: Record<DossierCopilotExcerpt["status"], string> = {
  answered: "Answered",
  insufficient_evidence: "Insufficient evidence",
  ambiguous: "Ambiguous reference",
  unavailable: "Not available",
};

const MODE_LABELS: Record<NonNullable<DossierCopilotExcerpt["synthesisMode"]>, string> = {
  llm_synthesis: "Claude-worded",
  deterministic: "deterministic wording",
  deterministic_fallback: "deterministic wording (model output rejected)",
};

function CopilotExcerptRow({ excerpt }: { excerpt: DossierCopilotExcerpt }) {
  return (
    <div
      className="flex flex-col gap-1 rounded border border-border px-2 py-1.5"
      data-testid="dossier-copilot-excerpt"
      data-status={excerpt.status}
    >
      <span className="text-xs font-medium text-foreground">{excerpt.question}</span>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" data-testid="dossier-excerpt-status">
          {EXCERPT_STATUS_LABELS[excerpt.status]}
        </Badge>
        {excerpt.grounding && <Badge variant="outline">{excerpt.grounding.replace(/_/g, " ")}</Badge>}
        {excerpt.classification && (
          <Badge variant={badgeVariant(excerpt.classification)}>
            {CLASSIFICATION_LABELS[excerpt.classification]}
          </Badge>
        )}
        {excerpt.confidence !== null && (
          <Badge variant="outline">confidence {excerpt.confidence.toFixed(2)}</Badge>
        )}
        {excerpt.synthesisMode && (
          <Badge variant="outline" data-testid="dossier-excerpt-mode">
            {MODE_LABELS[excerpt.synthesisMode]}
          </Badge>
        )}
      </div>
      {excerpt.answer && (
        <p className="whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">{excerpt.answer}</p>
      )}
      {excerpt.note && (
        <p className="text-[10px] text-muted-foreground" data-testid="dossier-excerpt-note">
          {excerpt.note}
        </p>
      )}
    </div>
  );
}
