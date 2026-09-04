"use client";

import { useCallback, useState } from "react";

import { Header } from "./header";
import { Sidebar, type NavView } from "./sidebar";
import { OverviewScreen } from "@/components/investigation/overview-screen";
import { InvestigationWorkspace } from "@/components/investigation/workspace";
import { GraphScreen } from "@/components/investigation/graph-screen";
import { AnalyticsScreen } from "@/components/investigation/analytics-screen";
import { CorroborationScreen } from "@/components/investigation/corroboration-screen";
import { CopilotScreen } from "@/components/investigation/copilot-screen";
import { DossierScreen } from "@/components/investigation/dossier-screen";
import type { InvestigationState } from "@/lib/ingestion/types";
import type { ExtractionState } from "@/lib/extraction/types";
import type { ResolutionState } from "@/lib/resolution/types";
import type { GraphState } from "@/lib/graph/types";
import type { AnalyticsState } from "@/lib/analytics/types";
import type { CorroborationState } from "@/lib/corroboration/types";
import type { CopilotState } from "@/lib/copilot/types";
import type { DossierState } from "@/lib/dossier/types";

/**
 * The top-level application shell: header, sidebar navigation, and the
 * active screen. The sidebar's "Graph" (P5.5), "Analytics" (P5.6),
 * "Corroboration" (P5.7), "Ask a Question" (P5.8 — the Investigation
 * Copilot) and "Dossier" (P5.9 — the case report) entries become real,
 * clickable navigation targets once their backing stage succeeds,
 * switching the main content without a page reload (server state is
 * passed in once; the success paths update it live via the
 * `on*StateChange` callbacks, mirroring how `router.refresh()` already
 * reconciles the other stages).
 *
 * Selecting an entity, a path, a finding, a Copilot citation, or a
 * dossier finding's reference hands off to the Evidence, Graph,
 * Analytics, or Corroboration screen focused on that entity, so the
 * screens feel like one connected investigative surface rather than
 * unrelated dashboards. The Copilot's and Dossier's own states are
 * reconciled by their screens on mount, because both depend on every
 * earlier stage having completed.
 */
export function AppShell({
  initialState,
  initialExtractionState,
  initialResolutionState,
  initialGraphState,
  initialAnalyticsState,
  initialCorroborationState,
  initialCopilotState,
  initialDossierState,
}: {
  initialState: InvestigationState;
  initialExtractionState: ExtractionState;
  initialResolutionState: ResolutionState;
  initialGraphState: GraphState;
  initialAnalyticsState: AnalyticsState;
  initialCorroborationState: CorroborationState;
  initialCopilotState: CopilotState;
  initialDossierState: DossierState;
}) {
  const [view, setView] = useState<NavView>("evidence");
  const [graphState, setGraphState] = useState<GraphState>(initialGraphState);
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>(initialAnalyticsState);
  const [corroborationState, setCorroborationState] = useState<CorroborationState>(initialCorroborationState);
  // The one persistent focused entity (M10.3). Every analysis surface's
  // Inspector opens on it, cross-navigation sets it, and it survives
  // moving between Graph, Analytics and Corroboration. Surfaced as the
  // command-bar focus chip; clearing the chip clears it everywhere.
  const [focusedEntityId, setFocusedEntityId] = useState<string | null>(null);

  const viewInGraph = useCallback((entityId: string) => {
    setFocusedEntityId(entityId);
    setView("graph");
  }, []);

  const viewInAnalytics = useCallback((entityId: string) => {
    setFocusedEntityId(entityId);
    setView("analytics");
  }, []);

  const viewInCorroboration = useCallback((entityId: string) => {
    setFocusedEntityId(entityId);
    setView("corroboration");
  }, []);

  const viewEvidence = useCallback(() => {
    setFocusedEntityId(null);
    setView("evidence");
  }, []);

  const clearFocus = useCallback(() => setFocusedEntityId(null), []);

  const caseName =
    initialState.status === "loaded" ? initialState.summary.name : null;
  const caseDetail =
    initialState.status === "loaded"
      ? `${initialState.summary.corpusName} · ${initialState.summary.corpusVersion}`
      : null;

  const completedStages =
    initialState.status === "loaded" ? ["Upload Evidence", "Ingestion"] : [];
  if (initialExtractionState.status === "extracted") completedStages.push("Extraction");
  if (initialResolutionState.status === "resolved") completedStages.push("Entity Resolution");
  if (graphState.status === "synthesized") completedStages.push("Graph Synthesis");
  if (analyticsState.status === "synthesized") completedStages.push("Analytics");
  if (corroborationState.status === "synthesized") completedStages.push("Corroboration");
  // Must match a JOURNEY_STAGES label in shell/pipeline-status.tsx exactly,
  // or the stage silently never lights up.
  if (corroborationState.status === "synthesized") completedStages.push("Copilot");
  if (initialDossierState.status === "generated") completedStages.push("Dossier / Report");

  return (
    <div className="flex h-dvh flex-col bg-bg text-fg">
      <Header
        caseName={caseName}
        caseDetail={caseDetail}
        completedStages={completedStages}
        focusedEntityId={focusedEntityId}
        onClearFocus={clearFocus}
        searchAvailable={
          initialResolutionState.status === "resolved" &&
          initialResolutionState.summary.totalEntities > 0
        }
        totalEntities={
          initialResolutionState.status === "resolved"
            ? initialResolutionState.summary.totalEntities
            : 0
        }
        onOpenEntity={viewInGraph}
        onNavigateStage={setView}
        showSearch={view !== "overview"}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeView={view}
          graphEnabled={graphState.status === "synthesized"}
          analyticsEnabled={analyticsState.status === "synthesized"}
          corroborationEnabled={corroborationState.status === "synthesized"}
          // The Copilot grounds on every earlier stage, so corroboration
          // completing is exactly the point at which it has everything
          // Agent 6's contract requires.
          copilotEnabled={corroborationState.status === "synthesized"}
          // The dossier reports on every earlier stage, so corroboration
          // completing is exactly the point at which it has everything
          // Workstream H requires. The screen itself reconciles whether a
          // report has actually been generated yet.
          dossierEnabled={corroborationState.status === "synthesized"}
          onNavigate={setView}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden bg-bg p-3 sm:p-4">
          {view === "overview" && (
            <OverviewScreen
              investigation={initialState}
              extraction={initialExtractionState}
              resolution={initialResolutionState}
              graph={graphState}
              analytics={analyticsState}
              corroboration={corroborationState}
              copilot={initialCopilotState}
              dossier={initialDossierState}
              onNavigate={setView}
              onOpenEntity={viewInGraph}
            />
          )}
          {view === "evidence" && (
            <InvestigationWorkspace
              initialState={initialState}
              initialExtractionState={initialExtractionState}
              initialResolutionState={initialResolutionState}
              initialGraphState={graphState}
              initialAnalyticsState={analyticsState}
              initialCorroborationState={corroborationState}
              onGraphStateChange={setGraphState}
              onAnalyticsStateChange={setAnalyticsState}
              onCorroborationStateChange={setCorroborationState}
            />
          )}
          {view === "graph" && (
            <GraphScreen
              initialState={graphState}
              focusEntityId={focusedEntityId}
              onFocusEntity={setFocusedEntityId}
              onViewInGraph={viewInGraph}
              onViewInAnalytics={viewInAnalytics}
              onViewInCorroboration={viewInCorroboration}
            />
          )}
          {view === "analytics" && (
            <AnalyticsScreen
              initialState={analyticsState}
              focusEntityId={focusedEntityId}
              onFocusEntity={setFocusedEntityId}
              onViewInGraph={viewInGraph}
              onViewInAnalytics={viewInAnalytics}
              onViewInCorroboration={viewInCorroboration}
            />
          )}
          {view === "corroboration" && (
            <CorroborationScreen
              initialState={corroborationState}
              focusEntityId={focusedEntityId}
              onViewInGraph={viewInGraph}
              onViewInAnalytics={viewInAnalytics}
              onViewInCorroboration={viewInCorroboration}
            />
          )}
          {view === "copilot" && (
            <CopilotScreen
              initialState={initialCopilotState}
              onViewInGraph={viewInGraph}
              onViewInAnalytics={viewInAnalytics}
              onViewInCorroboration={viewInCorroboration}
            />
          )}
          {view === "dossier" && (
            <DossierScreen
              initialState={initialDossierState}
              onViewInGraph={viewInGraph}
              onViewInAnalytics={viewInAnalytics}
              onViewInCorroboration={viewInCorroboration}
              onViewEvidence={viewEvidence}
            />
          )}
        </main>
      </div>
    </div>
  );
}
