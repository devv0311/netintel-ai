import { Header } from "@/components/shell/header";
import { Sidebar } from "@/components/shell/sidebar";
import { PipelineStatus } from "@/components/shell/pipeline-status";
import { InvestigationWorkspace } from "@/components/investigation/workspace";
import { getInvestigationState } from "@/lib/ingestion/summary";

/** DB-backed — rendered on demand, never prerendered at build time. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const state = await getInvestigationState();
  const completedStages =
    state.status === "loaded" ? ["Upload Evidence", "Ingestion"] : [];

  return (
    <div className="flex h-dvh flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
          <PipelineStatus completed={completedStages} />
          <InvestigationWorkspace initialState={state} />
        </main>
      </div>
    </div>
  );
}
