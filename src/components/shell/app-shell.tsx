"use client";

import { useState } from "react";

import { Header } from "./header";
import { Sidebar, type NavView } from "./sidebar";
import { PipelineStatus } from "./pipeline-status";
import { InvestigationWorkspace } from "@/components/investigation/workspace";
import { GraphScreen } from "@/components/investigation/graph-screen";
import type { InvestigationState } from "@/lib/ingestion/types";
import type { ExtractionState } from "@/lib/extraction/types";
import type { ResolutionState } from "@/lib/resolution/types";
import type { GraphState } from "@/lib/graph/types";

/**
 * The top-level application shell: header, sidebar navigation, and the
 * active screen. Introduced by P5.5 so the sidebar's "Graph" entry can
 * become a real, clickable navigation target once graph synthesis
 * succeeds, switching the main content between the evidence workspace
 * and the Graph screen — without a page reload (server state is passed
 * in once; the graph-synthesis success path updates it live via
 * `onGraphStateChange`, mirroring how `router.refresh()` already
 * reconciles the other stages).
 */
export function AppShell({
  initialState,
  initialExtractionState,
  initialResolutionState,
  initialGraphState,
}: {
  initialState: InvestigationState;
  initialExtractionState: ExtractionState;
  initialResolutionState: ResolutionState;
  initialGraphState: GraphState;
}) {
  const [view, setView] = useState<NavView>("evidence");
  const [graphState, setGraphState] = useState<GraphState>(initialGraphState);

  const completedStages =
    initialState.status === "loaded" ? ["Upload Evidence", "Ingestion"] : [];
  if (initialExtractionState.status === "extracted") completedStages.push("Extraction");
  if (initialResolutionState.status === "resolved") completedStages.push("Entity Resolution");
  if (graphState.status === "synthesized") completedStages.push("Graph Synthesis");

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar activeView={view} graphEnabled={graphState.status === "synthesized"} onNavigate={setView} />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <PipelineStatus completed={completedStages} />
          {view === "evidence" && (
            <InvestigationWorkspace
              initialState={initialState}
              initialExtractionState={initialExtractionState}
              initialResolutionState={initialResolutionState}
              initialGraphState={graphState}
              onGraphStateChange={setGraphState}
            />
          )}
          {view === "graph" && <GraphScreen initialState={graphState} />}
        </main>
      </div>
    </div>
  );
}
