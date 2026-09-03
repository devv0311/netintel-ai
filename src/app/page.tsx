import { AppShell } from "@/components/shell/app-shell";
import { getInvestigationState } from "@/lib/ingestion/summary";
import { getExtractionState } from "@/lib/extraction/summary";
import { getResolutionState } from "@/lib/resolution/summary";
import { getGraphState } from "@/lib/graph/summary";
import { getAnalyticsState } from "@/lib/analytics/summary";
import { getCorroborationState } from "@/lib/corroboration/summary";
import { getCopilotState } from "@/lib/copilot/summary";
import { getDossierState } from "@/lib/dossier/summary";

/** DB-backed — rendered on demand, never prerendered at build time. */
export const dynamic = "force-dynamic";

export default async function Home() {
  const [
    state,
    extractionState,
    resolutionState,
    graphState,
    analyticsState,
    corroborationState,
    copilotState,
    dossierState,
  ] = await Promise.all([
    getInvestigationState(),
    getExtractionState(),
    getResolutionState(),
    getGraphState(),
    getAnalyticsState(),
    getCorroborationState(),
    getCopilotState(),
    getDossierState(),
  ]);

  return (
    <AppShell
      initialState={state}
      initialExtractionState={extractionState}
      initialResolutionState={resolutionState}
      initialGraphState={graphState}
      initialAnalyticsState={analyticsState}
      initialCorroborationState={corroborationState}
      initialCopilotState={copilotState}
      initialDossierState={dossierState}
    />
  );
}
