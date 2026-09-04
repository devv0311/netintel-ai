"use client";

import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CircleDashed,
  FileText,
  FolderOpen,
  Layers,
  MessageSquareText,
  Network,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { EmptyState } from "@/components/ui/states";
import { ClassificationChip } from "@/components/ui/classification-chip";
import { formatCount, formatUtc } from "@/lib/format";
import { KIND_LABELS, KIND_VAR } from "@/lib/graph/tokens";
import { cn } from "@/lib/utils";
import type { NavView } from "@/components/shell/sidebar";
import type { InvestigationState } from "@/lib/ingestion/types";
import type { ExtractionState } from "@/lib/extraction/types";
import type { ResolutionState } from "@/lib/resolution/types";
import type { GraphState } from "@/lib/graph/types";
import type { AnalyticsState } from "@/lib/analytics/types";
import type { CorroborationState } from "@/lib/corroboration/types";
import type { CopilotState } from "@/lib/copilot/types";
import type { DossierState } from "@/lib/dossier/types";

import { EntitySearch } from "./entity-search";

/**
 * The case overview (P6.23) — the screen the product did not have.
 *
 * Everything on it is read from the same server-derived state the rest of
 * the shell already receives: no new endpoint, no new query, no derived
 * metric that the pipeline does not itself report. Where a stage has not
 * run, the card says so rather than showing a zero, because "0 entities"
 * and "resolution has not run" are different facts and an investigator
 * must be able to tell them apart at a glance.
 *
 * It deliberately does NOT show a list of recent investigations. This
 * build ingests exactly one investigation — the built-in corpus — so a
 * "recent cases" rail would be furniture with nothing real behind it.
 * The single loaded case is shown as what it is.
 */

const EVIDENCE_TYPE_LABELS: Record<string, string> = {
  fir: "FIRs",
  suspect_record: "Suspect records",
  alias_record: "Alias records",
  phone_record: "Phone records",
  imei_record: "IMEI records",
  vehicle_record: "Vehicle records",
  bank_account_record: "Bank account records",
  location_record: "Location records",
  cdr_event: "CDR events",
  financial_transaction_record: "Transaction records",
  witness_statement: "Witness statements",
  crime_event: "Crime events",
  public_record: "Public records",
};

/** The investigator's path through the product, as five real stages. */
type FlowStep = {
  key: string;
  label: string;
  caption: string;
  icon: typeof ScanSearch;
  done: boolean;
  view?: NavView;
};

function Metric({
  value,
  label,
  tone = "default",
  testId,
}: {
  value: ReactNode;
  label: string;
  tone?: "default" | "warn";
  testId?: string;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span
        className={cn(
          "text-lg font-semibold leading-none tabular-nums",
          tone === "warn" ? "text-[color:var(--cls-lead-fg)]" : "text-fg",
        )}
        data-testid={testId}
      >
        {value}
      </span>
      <span className="truncate text-[11px] leading-tight text-fg-muted">{label}</span>
    </div>
  );
}

function StageCard({
  icon: Icon,
  title,
  status,
  statusTone = "muted",
  onOpen,
  openLabel,
  children,
  footer,
  testId,
}: {
  icon: typeof FolderOpen;
  title: string;
  status: string;
  statusTone?: "ok" | "muted" | "warn";
  onOpen?: () => void;
  openLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}) {
  return (
    <Panel weight="panel" className="gap-3" data-testid={testId}>
      <div className="flex items-center gap-2">
        <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wide text-fg">{title}</span>
        <span
          className={cn(
            "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
            statusTone === "ok" && "bg-accent-quiet/50 text-fg",
            statusTone === "warn" && "border border-[color:var(--cls-lead-border)] text-[color:var(--cls-lead-fg)]",
            statusTone === "muted" && "text-fg-faint",
          )}
        >
          {status}
        </span>
      </div>
      {children}
      {(footer || onOpen) && (
        <div className="mt-auto flex items-center gap-2 border-t border-border pt-2">
          {footer}
          {onOpen && (
            <button
              type="button"
              onClick={onOpen}
              className="ml-auto inline-flex shrink-0 items-center gap-1 rounded text-[11px] font-medium text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {openLabel ?? "Open"}
              <ArrowRight className="size-3" aria-hidden />
            </button>
          )}
        </div>
      )}
    </Panel>
  );
}

/** A stage that has not run yet — never a card full of zeroes. */
function NotRun({ what }: { what: string }) {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-fg-faint">
      <CircleDashed className="mt-0.5 size-3 shrink-0" aria-hidden />
      {what}
    </p>
  );
}

export function OverviewScreen({
  investigation,
  extraction,
  resolution,
  graph,
  analytics,
  corroboration,
  copilot,
  dossier,
  onNavigate,
  onOpenEntity,
}: {
  investigation: InvestigationState;
  extraction: ExtractionState;
  resolution: ResolutionState;
  graph: GraphState;
  analytics: AnalyticsState;
  corroboration: CorroborationState;
  copilot: CopilotState;
  dossier: DossierState;
  onNavigate: (view: NavView) => void;
  onOpenEntity: (entityId: string) => void;
}) {
  if (investigation.status !== "loaded") {
    return (
      <EmptyState
        icon={FolderOpen}
        title="No investigation loaded"
        detail="Ingest the built-in Operation DarkNet Delhi corpus from the Evidence screen to open a case. Nothing on this dashboard is populated until real evidence has been ingested."
        action={
          <button
            type="button"
            onClick={() => onNavigate("evidence")}
            className="inline-flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground"
            data-testid="overview-go-evidence"
          >
            Go to Evidence
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        }
        data-testid="overview-empty"
      />
    );
  }

  const s = investigation.summary;
  const res = resolution.status === "resolved" ? resolution.summary : null;
  const gph = graph.status === "synthesized" ? graph.summary : null;
  const ext = extraction.status === "extracted" ? extraction.summary : null;
  const ana = analytics.status === "synthesized" ? analytics.summary : null;
  const cor = corroboration.status === "synthesized" ? corroboration.summary : null;
  const dos = dossier.status === "generated" || dossier.status === "stale" ? dossier.summary : null;

  const flow: FlowStep[] = [
    { key: "search", label: "Search", caption: "Find a subject", icon: ScanSearch, done: Boolean(res) },
    { key: "sources", label: "Sources", caption: "Ingest & extract", icon: FolderOpen, done: Boolean(ext), view: "evidence" },
    { key: "resolve", label: "Resolve", caption: "One entity, many mentions", icon: Users, done: Boolean(res), view: "evidence" },
    { key: "graph", label: "Graph", caption: "Connect the evidence", icon: Network, done: Boolean(gph), view: gph ? "graph" : undefined },
    { key: "report", label: "Dossier", caption: "Investigator-ready view", icon: FileText, done: Boolean(dos), view: dos ? "dossier" : undefined },
  ];

  const classificationOrder = ["observed_fact", "corroborated_fact", "ai_inference"] as const;
  const edgesByClassification = gph?.edgesByClassification ?? {};

  return (
    <div className="flex flex-col gap-4" data-testid="overview-screen">
      {/* --- case identity ------------------------------------------------ */}
      <Panel weight="hero" className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-semibold text-fg" data-testid="overview-case-name">
                {s.name}
              </h1>
              <Badge variant="outline" className="font-mono text-[10px]">
                {s.corpusName} · {s.corpusVersion}
              </Badge>
              <Badge variant="outline" className="uppercase tracking-wide">
                {s.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <p className="font-mono text-[11px] text-fg-faint">
              {s.investigationId}
              {s.ingestedAt ? ` · ingested ${formatUtc(s.ingestedAt)}` : ""}
            </p>
          </div>
          <Badge variant="outline" className="gap-1.5">
            <ShieldAlert className="size-3" aria-hidden />
            Synthetic data only — not a real investigation
          </Badge>
        </div>

        <div className="max-w-2xl">
          <EntitySearch
            variant="hero"
            available={Boolean(res && res.totalEntities > 0)}
            totalEntities={res?.totalEntities ?? 0}
            onSelect={onOpenEntity}
          />
        </div>

        {/* --- the investigator's path, as real stage state --------------- */}
        <ol className="flex flex-wrap items-stretch gap-1.5" data-testid="overview-flow">
            {flow.map((step, i) => {
              const clickable = Boolean(step.view);
              const Tag = clickable ? "button" : "div";
              return (
                <li key={step.key} className="flex min-w-[8.5rem] flex-1 items-center gap-1.5">
                  <Tag
                    {...(clickable
                      ? { type: "button" as const, onClick: () => step.view && onNavigate(step.view) }
                      : {})}
                    className={cn(
                      "flex min-w-0 flex-1 flex-col gap-0.5 rounded-md border px-2 py-1.5 text-left transition-colors",
                      step.done
                        ? "border-border-strong bg-surface-2"
                        : "border-dashed border-border bg-transparent",
                      clickable && "hover:border-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    )}
                  >
                    <span className="flex items-center gap-1.5">
                      <step.icon
                        className={cn("size-3 shrink-0", step.done ? "text-accent" : "text-fg-faint")}
                        aria-hidden
                      />
                      <span
                        className={cn(
                          "truncate text-[11px] font-medium",
                          step.done ? "text-fg" : "text-fg-faint",
                        )}
                      >
                        {step.label}
                      </span>
                    </span>
                    <span className="truncate text-[10px] leading-tight text-fg-faint">{step.caption}</span>
                  </Tag>
                  {i < flow.length - 1 && (
                    <ArrowRight className="hidden size-3 shrink-0 text-fg-faint/50 sm:block" aria-hidden />
                  )}
                </li>
              );
            })}
        </ol>
      </Panel>

      {/* --- stage cards -------------------------------------------------- */}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <StageCard
          icon={FolderOpen}
          title="Sources & evidence"
          status="ingested"
          statusTone="ok"
          onOpen={() => onNavigate("evidence")}
          openLabel="Evidence"
          testId="overview-card-sources"
        >
          <div className="grid grid-cols-3 gap-3">
            <Metric value={formatCount(s.counts.evidenceSources)} label="Sources" testId="overview-sources" />
            <Metric value={formatCount(s.counts.evidenceItems)} label="Evidence items" testId="overview-items" />
            <Metric value={formatCount(Object.keys(s.counts.evidenceItemsByType).length)} label="Item types" />
          </div>
          <ul className="flex flex-col gap-1">
            {Object.entries(s.counts.evidenceItemsByType)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 5)
              .map(([type, n]) => {
                const share = s.counts.evidenceItems > 0 ? n / s.counts.evidenceItems : 0;
                return (
                  <li key={type} className="flex items-center gap-2 text-[11px]">
                    <span className="w-32 shrink-0 truncate text-fg-muted">
                      {EVIDENCE_TYPE_LABELS[type] ?? type}
                    </span>
                    <span className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-3">
                      <span
                        className="block h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.max(share * 100, 1)}%` }}
                      />
                    </span>
                    <span className="w-10 shrink-0 text-right tabular-nums text-fg">{formatCount(n)}</span>
                  </li>
                );
              })}
          </ul>
        </StageCard>

        <StageCard
          icon={Layers}
          title="Extraction"
          status={ext ? "extracted" : "not run"}
          statusTone={ext ? "ok" : "muted"}
          onOpen={() => onNavigate("evidence")}
          openLabel="Evidence"
          testId="overview-card-extraction"
        >
          {ext ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric value={formatCount(ext.totalRecords)} label="Structured records" />
                <Metric value={formatCount(ext.evidenceItemsExtracted)} label="Items extracted" />
                <Metric value={formatCount(Object.keys(ext.recordsByType).length)} label="Record types" />
              </div>
              <p className="text-[11px] leading-relaxed text-fg-muted">
                Every extracted record is a direct field-read of one source. No identity decision and no
                inference is applied at this stage.
              </p>
            </>
          ) : (
            <NotRun what="Extraction has not run. Start it from the Evidence screen." />
          )}
        </StageCard>

        <StageCard
          icon={Users}
          title="Entity resolution"
          status={res ? (res.ambiguousDecisions + res.unresolvedDecisions > 0 ? "needs review" : "resolved") : "not run"}
          statusTone={res ? (res.ambiguousDecisions + res.unresolvedDecisions > 0 ? "warn" : "ok") : "muted"}
          onOpen={() => onNavigate("evidence")}
          openLabel="Evidence"
          testId="overview-card-resolution"
        >
          {res ? (
            <>
              <div className="grid grid-cols-4 gap-3">
                <Metric value={formatCount(res.totalEntities)} label="Entities" testId="overview-entities" />
                <Metric value={formatCount(res.totalAliases)} label="Aliases" />
                <Metric
                  value={formatCount(res.ambiguousDecisions)}
                  label="Ambiguous"
                  tone={res.ambiguousDecisions > 0 ? "warn" : "default"}
                />
                <Metric
                  value={formatCount(res.unresolvedDecisions)}
                  label="Unresolved"
                  tone={res.unresolvedDecisions > 0 ? "warn" : "default"}
                />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {Object.entries(res.entitiesByKind)
                  .sort(([, a], [, b]) => b - a)
                  .map(([kind, n]) => (
                    <span key={kind} className="flex items-center gap-1.5 text-[11px] text-fg-muted">
                      <span
                        className="size-2 shrink-0 rounded-full"
                        style={{ background: `var(${KIND_VAR[kind] ?? KIND_VAR.other})` }}
                        aria-hidden
                      />
                      {KIND_LABELS[kind] ?? kind}
                      <span className="tabular-nums text-fg">{formatCount(n)}</span>
                    </span>
                  ))}
              </div>
              <p className="text-[11px] leading-relaxed text-fg-muted">
                An ambiguous decision is one the resolver refused to merge. It is surfaced, never silently
                collapsed into a single identity.
              </p>
            </>
          ) : (
            <NotRun what="Entity resolution has not run. Nothing is resolved to a canonical identity yet." />
          )}
        </StageCard>

        <StageCard
          icon={Network}
          title="Graph"
          status={gph ? "synthesized" : "not run"}
          statusTone={gph ? "ok" : "muted"}
          onOpen={gph ? () => onNavigate("graph") : undefined}
          openLabel="Graph"
          testId="overview-card-graph"
        >
          {gph ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric value={formatCount(gph.totalNodes)} label="Nodes" testId="overview-nodes" />
                <Metric value={formatCount(gph.totalEdges)} label="Relationships" testId="overview-edges" />
                <Metric value={formatCount(Object.keys(gph.edgesByType).length)} label="Relationship types" />
              </div>
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
                  What the graph asserts
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {classificationOrder
                    .filter((c) => (edgesByClassification[c] ?? 0) > 0)
                    .map((c) => (
                      <span key={c} className="flex items-center gap-1">
                        <ClassificationChip classification={c} />
                        <span className="text-[11px] tabular-nums text-fg-muted">
                          ×{formatCount(edgesByClassification[c] ?? 0)}
                        </span>
                      </span>
                    ))}
                </div>
                <p className="text-[11px] leading-relaxed text-fg-muted">
                  Facts come from the sources. An AI inference is a chained conclusion the graph drew, and
                  is drawn dashed everywhere it appears.
                </p>
              </div>
            </>
          ) : (
            <NotRun what="Graph synthesis has not run. There are no relationships to explore yet." />
          )}
        </StageCard>

        <StageCard
          icon={BarChart3}
          title="Topology analytics"
          status={ana ? "computed" : "not run"}
          statusTone={ana ? "ok" : "muted"}
          onOpen={ana ? () => onNavigate("analytics") : undefined}
          openLabel="Analytics"
          testId="overview-card-analytics"
        >
          {ana ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric value={formatCount(ana.counts.rankedEntities)} label="Ranked entities" />
                <Metric value={formatCount(ana.counts.bridgeEntities)} label="Bridge entities" />
                <Metric value={formatCount(ana.counts.communities)} label="Communities" />
              </div>
              <p className="text-[11px] leading-relaxed text-fg-muted">
                Computed properties of the graph structure — Algorithmic Signals, not claims about people.
              </p>
            </>
          ) : (
            <NotRun what="Analytics has not run. It needs a synthesized graph first." />
          )}
        </StageCard>

        <StageCard
          icon={ShieldCheck}
          title="Corroboration"
          status={cor ? (cor.counts.contradictions > 0 ? `${cor.counts.contradictions} contradictions` : "clean") : "not run"}
          statusTone={cor ? (cor.counts.contradictions > 0 ? "warn" : "ok") : "muted"}
          onOpen={cor ? () => onNavigate("corroboration") : undefined}
          openLabel="Corroboration"
          testId="overview-card-corroboration"
        >
          {cor ? (
            <>
              <div className="grid grid-cols-4 gap-3">
                <Metric value={formatCount(cor.counts.corroboratedFacts)} label="Corroborated" />
                <Metric value={formatCount(cor.counts.spatialFindings)} label="Spatial" />
                <Metric value={formatCount(cor.counts.temporalFindings)} label="Temporal" />
                <Metric
                  value={formatCount(cor.counts.contradictions)}
                  label="Contradictions"
                  tone={cor.counts.contradictions > 0 ? "warn" : "default"}
                />
              </div>
              {cor.counts.contradictions > 0 && (
                <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-[color:var(--cls-lead-fg)]">
                  <AlertTriangle className="mt-0.5 size-3 shrink-0" aria-hidden />
                  Contradictions are shown, not resolved. Each one needs a human decision.
                </p>
              )}
            </>
          ) : (
            <NotRun what="Spatial/temporal corroboration has not run." />
          )}
        </StageCard>

        <StageCard
          icon={MessageSquareText}
          title="Investigation Copilot"
          status={copilot.status === "ready" ? (copilot.summary.modelConfigured ? "model configured" : "deterministic") : "unavailable"}
          statusTone={copilot.status === "ready" ? "ok" : "muted"}
          onOpen={copilot.status === "ready" ? () => onNavigate("copilot") : undefined}
          openLabel="Ask a question"
          testId="overview-card-copilot"
        >
          {copilot.status === "ready" ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric value={formatCount(copilot.summary.counts.entities)} label="Entities grounded" />
                <Metric value={formatCount(copilot.summary.counts.relationships)} label="Relationships" />
                <Metric value={formatCount(copilot.summary.suggestions.length)} label="Starter questions" />
              </div>
              <p className="text-[11px] leading-relaxed text-fg-muted">
                {copilot.summary.modelConfigured
                  ? "Answers are grounded in the persisted case record and cite it."
                  : "No AI provider key is configured, so answers use the deterministic narration of the grounded claim set. No model output is generated, and none is invented in its place."}
              </p>
            </>
          ) : (
            <NotRun what={copilot.reason} />
          )}
        </StageCard>

        <StageCard
          icon={FileText}
          title="Dossier"
          status={dossier.status === "stale" ? "stale" : dos ? "generated" : "not generated"}
          statusTone={dossier.status === "stale" ? "warn" : dos ? "ok" : "muted"}
          onOpen={dos ? () => onNavigate("dossier") : undefined}
          openLabel="Dossier"
          testId="overview-card-dossier"
        >
          {dos ? (
            <>
              <div className="grid grid-cols-3 gap-3">
                <Metric value={formatCount(dos.counts.findings)} label="Findings" />
                <Metric value={formatCount(dos.counts.sections)} label="Sections" />
                <Metric value={formatCount(dos.counts.leads)} label="Leads" />
              </div>
              <p className="text-[11px] leading-relaxed text-fg-muted">
                {dossier.status === "stale"
                  ? "This report describes a superseded graph version. It is kept for audit, but it no longer describes the case as it now stands."
                  : `Generated ${formatUtc(dos.generatedAt)} against graph version ${dos.graphVersion}.`}
              </p>
            </>
          ) : (
            <NotRun
              what={
                dossier.status === "not_available"
                  ? dossier.reason
                  : "No report has been generated for the current graph version yet."
              }
            />
          )}
        </StageCard>
      </div>
    </div>
  );
}
