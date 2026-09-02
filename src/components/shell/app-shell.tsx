"use client";

import { useCallback, useState } from "react";

import { Header } from "./header";
import { Sidebar, type NavView } from "./sidebar";
import { PipelineStatus } from "./pipeline-status";
import { InvestigationWorkspace } from "@/components/investigation/workspace";
import { GraphScreen } from "@/components/investigation/graph-screen";
import { AnalyticsScreen } from "@/components/investigation/analytics-screen";
import type { InvestigationState } from "@/lib/ingestion/types";
import type { ExtractionState } from "@/lib/extraction/types";
import type { ResolutionState } from "@/lib/resolution/types";
import type { GraphState } from "@/lib/graph/types";
import type { AnalyticsState } from "@/lib/analytics/types";

/**
 * The top-level application shell: header, sidebar navigation, and the
 * active screen. The sidebar's "Graph" entry (P5.5) and "Analytics"
 * entry (P5.6) become real, clickable navigation targets once their
 * respective synthesis succeeds, switching the main content without a
 * page reload (server state is passed in once; the success paths
 * update it live via `onGraphStateChange`/`onAnalyticsStateChange`,
 * mirroring how `router.refresh()` already reconciles the other
 * stages). Selecting an entity or path on the Analytics screen can
 * hand off to the Graph screen, focused on that entity's neighborhood
 * (`graphFocusNodeId`), so the two screens feel like one connected
 * investigative surface rather than two unrelated dashboards.
 */
export function AppShell({
  initialState,
  initialExtractionState,
  initialResolutionState,
  initialGraphState,
  initialAnalyticsState,
}: {
  initialState: InvestigationState;
  initialExtractionState: ExtractionState;
  initialResolutionState: ResolutionState;
  initialGraphState: GraphState;
  initialAnalyticsState: AnalyticsState;
}) {
  const [view, setView] = useState<NavView>("evidence");
  const [graphState, setGraphState] = useState<GraphState>(initialGraphState);
  const [analyticsState, setAnalyticsState] = useState<AnalyticsState>(initialAnalyticsState);
  const [graphFocusNodeId, setGraphFocusNodeId] = useState<string | null>(null);

  const viewInGraph = useCallback((entityId: string) => {
    setGraphFocusNodeId(entityId);
    setView("graph");
  }, []);

  const completedStages =
    initialState.status === "loaded" ? ["Upload Evidence", "Ingestion"] : [];
  if (initialExtractionState.status === "extracted") completedStages.push("Extraction");
  if (initialResolutionState.status === "resolved") completedStages.push("Entity Resolution");
  if (graphState.status === "synthesized") completedStages.push("Graph Synthesis");
  if (analyticsState.status === "synthesized") completedStages.push("Analytics");

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          activeView={view}
          graphEnabled={graphState.status === "synthesized"}
          analyticsEnabled={analyticsState.status === "synthesized"}
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
              onGraphStateChange={setGraphState}
              onAnalyticsStateChange={setAnalyticsState}
            />
          )}
          {view === "graph" && (
            <GraphScreen
              key={graphFocusNodeId ?? "default"}
              initialState={graphState}
              initialFocusNodeId={graphFocusNodeId ?? undefined}
            />
          )}
          {view === "analytics" && <AnalyticsScreen initialState={analyticsState} onViewInGraph={viewInGraph} />}
        </main>
      </div>
    </div>
  );
}
