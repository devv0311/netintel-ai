import { getAppMeta, setAppMeta } from "@/lib/db/repository";

/**
 * The dossier generation marker, mirroring
 * src/lib/corroboration/marker.ts. Keyed by investigation id AND graph
 * version, so re-running graph synthesis (which produces a new graph
 * version) correctly surfaces the previous report as STALE rather than
 * reporting it as the current description of the case.
 *
 * Informational only — idempotency itself comes from the dossier's
 * content-addressed id being skipped on write in ./persist.ts, not from
 * this marker.
 */

export interface DossierMarker {
  investigationId: string;
  graphVersion: string;
  dossierId: string;
  reportVersion: string;
  generatedAt: string;
}

export function dossierMarkerKey(investigationId: string, graphVersion: string): string {
  return `dossier:${investigationId}:${graphVersion}`;
}

export async function getDossierMarker(key: string): Promise<DossierMarker | null> {
  const raw = await getAppMeta(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "dossierId" in parsed && "generatedAt" in parsed) {
      return parsed as DossierMarker;
    }
    return null;
  } catch {
    return null;
  }
}

export async function setDossierMarker(key: string, marker: DossierMarker): Promise<void> {
  await setAppMeta(key, JSON.stringify(marker));
}
