"use client";

import { useCallback, useState } from "react";

import { Header } from "./header";
import { Sidebar, type NavView } from "./sidebar";
import { PipelineStatus } from "./pipeline-status";
import { InvestigationWorkspace } from "@/components/investigation/workspace";
import { GraphScreen } from "@/components/investigation/graph-screen";
import { AnalyticsScreen } from "@/components/investigation/analytics-screen";
import { CorroborationScreen } from "@/components/investigation/corroboration-screen";
import { CopilotScreen } from "@/components/investigation/copilot-screen";
import type { InvestigationState } from "@/lib/ingestion/types";
import type { ExtractionState } from "@/lib/extraction/types";
import type { ResolutionState } from "@/lib/resolution/types";
import type { GraphState } from "@/lib/graph/types";
import type { AnalyticsState } from "@/lib/analytics/types";
import type { CorroborationState } from "@/lib/corroboration/types";
import type { CopilotState } from "@/lib/copilot/types";

/**
 * The top-level application shell: header, sidebar navigation, and the
 * active screen. The sidebar's "Graph" (P5.5), "Analytics" (P5.6),
 * "Corroboration" (P5.7), and "Ask a Question" (P5.8 — the Investigation
 * Copilot) entries become real, clickable navigation targets once their
 * backing stage succeeds, switching the main content without a page
 * reload (server state is passed in once; the success paths update it
 * live via the `on*StateChange` callbacks, mirroring how
 * `router.refresh()` already reconciles the other stages).
 *
 * Selecting an entity, a path, a finding, or a Copilot citation hands
 * off to the Graph, Analytics, or Corroboration screen focused on that
 * entity, so the screens feel like one connected investigative surface
 * rather than unrelated dashboards. The Copilot's own state is
 * reconciled by the screen itself on mount, because it depends on every
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
}: {
  initialState: InvestigationState;
  initialExtractionState: ExtractionState;
  initialResolutionState: ResolutionState;
  initialGraphState: GraphState;
  initialAnalyticsState: AnalyticsState;
  initialCorroborationState: CorroborationState;
  initialCopilotState: CopilotState;
}) {
  const [view, setView] = useState<NavView>("evidence");
  const [graphState, setGraphState] = useState<GraphState>(initialGraphState);
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>(initialAnalyticsState);
  const [corroborationState, setCorroborationState] = useState<CorroborationState>(initialCorroborationState);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);
  const [analyticsFocusEntityId, setAnalyticsFocusEntityId] = useState<string | null>(null);
  const [corroborationFocusEntityId, setCorroborationFocusEntityId] = useState<string | null>(null);

  const viewInGraph = useCallback((entityId: string) => {
    setGraphFocusNodeId(entityId);
    setView("graph");
  }, []);

  const viewInAnalytics = useCallback((entityId: string) => {
    setAnalyticsFocusEntityId(entityId);
    setView("analytics");
  }, []);

  const viewInCorroboration = useCallback((entityId: string) => {
    setCorroborationFocusEntityId(entityId);
    setView("corroboration");
  }, []);

  const completedStages =
    initialState.status === "loaded" ? ["Upload Evidence", "Ingestion"] : [];
  if (initialExtractionState.status === "extracted") completedStages.push("Extraction");
  if (initialResolutionState.status === "resolved") completedStages.push("Entity Resolution");
  if (graphState.status === "synthesized") completedStages.push("Graph Synthesis");
  if (analyticsState.status === "synthesized") completedStages.push("Analytics");
  if (corroborationState.status === "synthesized") completedStages.push("Corroboration");
  if (corroborationState.status === "synthesized") completedStages.push("Investigation Copilot");

  return (
    <div className="flex h-dvh flex-col">
      <Header />
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
          onNavigate={setView}
        />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <PipelineStatus completed={completedStages} />
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
              key={graphFocusNodeId ?? "default"}
              initialState={graphState}
              initialFocusNodeId={graphFocusNodeId ?? undefined}
            />
          )}
          {view === "analytics" && (
            <AnalyticsScreen
              key={analyticsFocusEntityId ?? "default"}
              initialState={analyticsState}
              initialFocusEntityId={analyticsFocusEntityId ?? undefined}
              onViewInGraph={viewInGraph}
            />
          )}
          {view === "corroboration" && (
            <CorroborationScreen
              key={corroborationFocusEntityId ?? "default"}
              initialState={corroborationState}
              initialFocusEntityId={corroborationFocusEntityId ?? undefined}
              onViewInGraph={viewInGraph}
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
        </main>
      </div>
    </div>
  );
}
