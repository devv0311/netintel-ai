import { AppShell } from "@/components/shell/app-shell";
import { getInvestigationState } from "@/lib/ingestion/summary";
import { getExtractionState } from "@/lib/extraction/summary";
import { getResolutionState } from "@/lib/resolution/summary";
import { getGraphState } from "@/lib/graph/summary";

/** DB-backed — rendered on demand, never prerendered at build time. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const [state, extractionState, resolutionState, graphState] = await Promise.all([
    getInvestigationState(),
    getExtractionState(),
    getResolutionState(),
    getGraphState(),
  ]);

  return (
    <AppShell
      initialState={state}
      initialExtractionState={extractionState}
      initialResolutionState={resolutionState}
      initialGraphState={graphState}
    />
  );
}
