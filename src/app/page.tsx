import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { PipelineStatus } from "@/components/shell/pipeline-status";
import { InvestigationWorkspace } from "@/components/investigation/workspace";
import { getInvestigationState } from "@/lib/ingestion/summary";
import { getExtractionState } from "@/lib/extraction/summary";
import { getResolutionState } from "@/lib/resolution/summary";

/** DB-backed — rendered on demand, never prerendered at build time. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const [state, extractionState, resolutionState] = await Promise.all([
    getInvestigationState(),
    getExtractionState(),
    getResolutionState(),
  ]);
  const completedStages =
    state.status === "loaded" ? ["Upload Evidence", "Ingestion"] : [];
  if (extractionState.status === "extracted") completedStages.push("Extraction");
  if (resolutionState.status === "resolved") completedStages.push("Entity Resolution");

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <PipelineStatus completed={completedStages} />
          <InvestigationWorkspace
            initialState={state}
            initialExtractionState={extractionState}
            initialResolutionState={resolutionState}
          />
        </main>
      </div>
    </div>
  );
}
