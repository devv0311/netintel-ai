"use client";

import { useState } from "react";
import { BarChart3, ChevronDown, ChevronRight, Network, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClassificationChip, classificationNote } from "@/components/ui/classification-chip";
import { formatCount } from "@/lib/format";
import type { CopilotClaim, CopilotModelError, CopilotResponse } from "@/lib/copilot/types";

/**
 * The answer surface. Its order is the order the milestone brief fixes:
 *
 *   QUESTION → ANSWER → CLASSIFICATION / CONFIDENCE → SUPPORTING
 *   EVIDENCE → PROVENANCE / DERIVATION → RELATED GRAPH / ANALYTICS /
 *   CORROBORATION
 *
 * Every claim shows its OWN classification and confidence next to it,
 * because an answer may legitimately mix a corroborated fact with an AI
 * inference and the two must never read alike
 * (docs/contracts/agent-contracts.md, Agent 6). Citations are rendered
 * as the persisted record ids they are, so an investigator can take any
 * one of them to the graph, analytics, or corroboration screen.
 */

const GROUNDING_LABELS: Record<CopilotResponse["grounding"], string> = {
  fully_grounded: "Fully grounded",
  partially_grounded: "Partially grounded",
  insufficient_evidence: "Insufficient evidence",
};

const MODE_LABELS: Record<CopilotResponse["derivation"]["mode"], string> = {
  llm_synthesis: "Claude synthesis over the grounded claims",
  deterministic: "Deterministic narration of the grounded claims",
  deterministic_fallback: "Deterministic narration (model output rejected)",
};

export function CopilotAnswer({
  response,
  modelError,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
}: {
  response: CopilotResponse;
  modelError: CopilotModelError | null;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [provenanceOpen, setProvenanceOpen] = useState(false);

  const totalCitations =
    response.supportingEvidenceIds.length +
    response.supportingExtractedRecordIds.length +
    response.supportingEntityIds.length +
    response.supportingRelationshipIds.length +
    response.supportingAnalyticalSignalIds.length +
    response.supportingCorroborationFindingIds.length;

  return (
    <div className="flex flex-col gap-3" data-testid="copilot-answer">
      {/* QUESTION */}
      <div className="flex items-start gap-2 text-xs text-muted-foreground">
        <span className="mt-px shrink-0 font-mono uppercase tracking-wide">question</span>
        <span className="font-medium text-foreground" data-testid="copilot-question">
          {response.question}
        </span>
      </div>

      {/* ANSWER */}
      <Card className="gap-3">
        <p
          className="whitespace-pre-wrap text-sm leading-relaxed text-foreground"
          data-testid="copilot-answer-text"
        >
          {response.answer}
        </p>

        {/* CLASSIFICATION / CONFIDENCE */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3 text-xs">
          <ClassificationChip
            classification={response.classification}
            data-testid="copilot-classification"
          />
          <Badge variant="outline" data-testid="copilot-grounding">
            {GROUNDING_LABELS[response.grounding]}
          </Badge>
          <Badge variant="outline" data-testid="copilot-confidence">
            confidence {response.confidence.toFixed(2)}
          </Badge>
          <Badge variant="outline" data-testid="copilot-derivation">
            {response.derivation.mode === "llm_synthesis" ? "Claude-worded" : "deterministic wording"}
          </Badge>
          <Badge variant="outline" data-testid="copilot-cache">
            cache {response.derivation.cache}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          Read the whole answer at the level of its weakest claim: {classificationNote(response.classification)}
        </p>
      </Card>

      {response.status === "ambiguous" && (
        <Card className="gap-2 border-accent/50" data-testid="copilot-ambiguity">
          <span className="text-xs font-semibold">Ambiguous reference — no answer composed</span>
          {response.ambiguities.map((a) => (
            <div key={a.surface} className="flex flex-col gap-1 text-xs">
              <span className="text-muted-foreground">
                “{a.surface}” matches {a.candidates.length} entities:
              </span>
              <div className="flex flex-wrap gap-1.5">
                {a.candidates.map((c) => (
                  <button
                    key={c.entityId}
                    type="button"
                    data-testid="copilot-ambiguity-candidate"
                    onClick={() => onViewInGraph(c.entityId)}
                    className="rounded border border-border px-1.5 py-0.5 text-left hover:bg-muted"
                  >
                    <span className="font-medium text-foreground">{c.label}</span>
                    <span className="ml-1 text-muted-foreground">{c.kind.replace(/_/g, " ")}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Card>
      )}

      {response.status === "insufficient_evidence" && (
        <Card className="gap-1 border-border text-xs text-muted-foreground" data-testid="copilot-insufficient">
          <span className="text-xs font-semibold text-foreground">Insufficient evidence</span>
          The Copilot answers only from this case&apos;s persisted evidence and derived intelligence. Nothing in it
          supports an answer here, so none was composed.
        </Card>
      )}

      {response.conflicts.length > 0 && (
        <Card className="gap-2 border-accent/50" data-testid="copilot-conflicts">
          <span className="text-xs font-semibold">
            {formatCount(response.conflicts.length)} unresolved conflict
            {response.conflicts.length === 1 ? "" : "s"} — reported, never resolved
          </span>
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {response.conflicts.map((c, i) => (
              <li key={`${c.summary}-${i}`} className="flex flex-col gap-0.5">
                <span className="text-foreground">{c.summary}</span>
                <span className="font-mono text-[10px]">
                  {c.claimIds.join(", ")} · sources {c.evidenceItemIds.join(", ")}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {modelError && (
        <Card className="gap-1 border-border bg-muted/40" data-testid="copilot-model-notice">
          <span className="text-xs font-semibold">
            {modelError.code === "MODEL_NOT_CONFIGURED"
              ? "AI narration unavailable"
              : modelError.code === "MODEL_REQUEST_FAILED"
                ? "AI provider unreachable"
                : "AI wording rejected by the grounding guardrail"}
          </span>
          <p className="text-xs text-muted-foreground">{modelError.message}</p>
          {modelError.rejections && modelError.rejections.length > 0 && (
            <ul className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
              {modelError.rejections.slice(0, 5).map((r) => (
                <li key={r} className="font-mono">
                  {r}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* SUPPORTING EVIDENCE */}
      {response.claims.length > 0 && (
        <Card className="gap-2" data-testid="copilot-claims">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">
              Supporting evidence — {formatCount(response.claims.length)} claim
              {response.claims.length === 1 ? "" : "s"}, {formatCount(totalCitations)} cited record
              {totalCitations === 1 ? "" : "s"}
            </span>
            <span className="text-muted-foreground">every claim carries its own classification</span>
          </div>
          <ul className="flex flex-col gap-1">
            {response.claims.map((claim) => (
              <ClaimRow
                key={claim.id}
                claim={claim}
                open={expanded === claim.id}
                onToggle={() => setExpanded((prev) => (prev === claim.id ? null : claim.id))}
                onViewInGraph={onViewInGraph}
                onViewInAnalytics={onViewInAnalytics}
                onViewInCorroboration={onViewInCorroboration}
              />
            ))}
          </ul>
        </Card>
      )}

      {response.caveats.length > 0 && (
        <Card className="gap-1 text-xs text-muted-foreground" data-testid="copilot-caveats">
          <span className="font-medium text-foreground">Caveats</span>
          <ul className="flex list-disc flex-col gap-0.5 pl-4">
            {response.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Card>
      )}

      {/* PROVENANCE / DERIVATION */}
      <Card className="gap-2" data-testid="copilot-provenance">
        <button
          type="button"
          onClick={() => setProvenanceOpen((v) => !v)}
          data-testid="copilot-provenance-toggle"
          className="flex items-center gap-1.5 text-left text-xs font-medium"
        >
          {provenanceOpen ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
          Provenance &amp; derivation
        </button>
        {provenanceOpen && (
          <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground" data-testid="copilot-provenance-detail">
            <span>synthesis</span>
            <span>{MODE_LABELS[response.derivation.mode]}</span>
            <span>model</span>
            <span className="font-mono text-[10px]">{response.derivation.modelVersion}</span>
            <span>prompt version</span>
            <span className="font-mono text-[10px]">{response.derivation.promptVersion}</span>
            <span>schema version</span>
            <span className="font-mono text-[10px]">{response.derivation.schemaVersion}</span>
            <span>cache</span>
            <span className="font-mono text-[10px]">{response.derivation.cache}</span>
            <span>graph version</span>
            <span className="font-mono text-[10px]">{response.graphVersion ?? "—"}</span>
            <span>method</span>
            <span className="font-mono text-[10px]">{response.provenance.method}</span>
            <span>source</span>
            <span className="truncate font-mono text-[10px]">{response.provenance.source}</span>
            <span>derived at</span>
            <span className="font-mono text-[10px]">{response.provenance.timestamp}</span>
            <span>history</span>
            <span className="font-mono text-[10px]">{response.provenance.processingHistory.join(" → ")}</span>
            {response.derivation.rejections.length > 0 && (
              <>
                <span>rejections</span>
                <span className="font-mono text-[10px]">{response.derivation.rejections.join(" · ")}</span>
              </>
            )}
          </div>
        )}
      </Card>

      {/* RELATED GRAPH / ANALYTICS / CORROBORATION */}
      {(response.relatedViews.entityIds.length > 0 ||
        response.relatedViews.analyticalSignalIds.length > 0 ||
        response.relatedViews.corroborationFindingIds.length > 0) && (
        <Card className="gap-2" data-testid="copilot-related">
          <span className="text-xs font-medium">Continue in another view</span>
          <div className="flex flex-wrap gap-1.5">
            {response.relatedViews.entityIds.slice(0, 1).map((id) => (
              <Button
                key={`g-${id}`}
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="copilot-view-in-graph"
                onClick={() => onViewInGraph(id)}
              >
                <Network className="size-3.5" aria-hidden />
                Open in graph
              </Button>
            ))}
            {response.relatedViews.entityIds.slice(0, 1).map((id) => (
              <Button
                key={`a-${id}`}
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="copilot-view-in-analytics"
                onClick={() => onViewInAnalytics(id)}
              >
                <BarChart3 className="size-3.5" aria-hidden />
                Open in analytics
              </Button>
            ))}
            {response.relatedViews.entityIds.slice(0, 1).map((id) => (
              <Button
                key={`c-${id}`}
                size="sm"
                variant="outline"
                className="gap-1.5"
                data-testid="copilot-view-in-corroboration"
                onClick={() => onViewInCorroboration(id)}
              >
                <ShieldCheck className="size-3.5" aria-hidden />
                Open in corroboration
              </Button>
            ))}
          </div>
          <span className="text-[10px] text-muted-foreground">
            {formatCount(response.relatedViews.entityIds.length)} entity ·{" "}
            {formatCount(response.relatedViews.relationshipIds.length)} relationship ·{" "}
            {formatCount(response.relatedViews.analyticalSignalIds.length)} signal ·{" "}
            {formatCount(response.relatedViews.corroborationFindingIds.length)} corroboration finding referenced
          </span>
        </Card>
      )}
    </div>
  );
}

function ClaimRow({
  claim,
  open,
  onToggle,
  onViewInGraph,
  onViewInAnalytics,
  onViewInCorroboration,
}: {
  claim: CopilotClaim;
  open: boolean;
  onToggle: () => void;
  onViewInGraph: (entityId: string) => void;
  onViewInAnalytics: (entityId: string) => void;
  onViewInCorroboration: (entityId: string) => void;
}) {
  const groups: [string, string[]][] = [
    ["evidence items", claim.citations.evidenceItemIds],
    ["extracted records", claim.citations.extractedRecordIds],
    ["entities", claim.citations.entityIds],
    ["relationships", claim.citations.relationshipIds],
    ["analytical signals", claim.citations.analyticalSignalIds],
    ["corroboration findings", claim.citations.corroborationFindingIds],
  ];
  const firstEntity = claim.citations.entityIds[0];
  const firstFinding = claim.citations.corroborationFindingIds[0];
  const firstSignal = claim.citations.analyticalSignalIds[0];

  return (
    <li data-testid="copilot-claim" data-claim-id={claim.id}>
      <button
        type="button"
        onClick={onToggle}
        data-testid="copilot-claim-toggle"
        className={`flex w-full items-start gap-2 rounded px-1.5 py-1 text-left text-xs hover:bg-muted ${open ? "bg-muted" : ""}`}
      >
        {open ? (
          <ChevronDown className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronRight className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        )}
        <span className="font-mono text-[10px] text-muted-foreground">{claim.id}</span>
        <span className="min-w-0 flex-1 text-foreground">{claim.statement}</span>
        <ClassificationChip classification={claim.classification} className="shrink-0" />
        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{claim.confidence.toFixed(2)}</span>
      </button>

      {open && (
        <div className="ml-6 flex flex-col gap-2 border-l border-border pl-3 pt-1.5 text-xs" data-testid="copilot-claim-detail">
          <p className="text-muted-foreground">{claim.explanation}</p>
          <span className="text-[10px] text-muted-foreground">
            {classificationNote(claim.classification)} · {claim.derivation === "derived" ? "computed by the retrieval layer" : "read from a persisted record"}
          </span>
          <div className="flex flex-col gap-1" data-testid="copilot-claim-citations">
            {groups
              .filter(([, ids]) => ids.length > 0)
              .map(([label, ids]) => (
                <div key={label} className="flex flex-wrap items-baseline gap-1">
                  <span className="text-muted-foreground">{label}:</span>
                  {ids.slice(0, 8).map((id) => (
                    <span key={id} className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {id}
                    </span>
                  ))}
                  {ids.length > 8 && <span className="text-[10px] text-muted-foreground">+{ids.length - 8} more</span>}
                </div>
              ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {firstEntity && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onViewInGraph(firstEntity)}>
                <Network className="size-3.5" aria-hidden />
                Graph
              </Button>
            )}
            {firstSignal && firstEntity && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onViewInAnalytics(firstEntity)}>
                <BarChart3 className="size-3.5" aria-hidden />
                Analytics
              </Button>
            )}
            {firstFinding && firstEntity && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onViewInCorroboration(firstEntity)}>
                <ShieldCheck className="size-3.5" aria-hidden />
                Corroboration
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  );
}
