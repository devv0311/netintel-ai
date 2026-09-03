import { analyticsMarkerKey, getAnalyticsMarker } from "@/lib/analytics/marker";
import { corroborationMarkerKey, getCorroborationMarker } from "@/lib/corroboration/marker";
import {
  getDossierById,
  listAnalyticalSignals,
  listCommunicationEvents,
  listCorroborationFindings,
  listDossiers,
  listEntities,
  listEvidenceItems,
  listEvidenceSources,
  listExtractedRecords,
  listInvestigations,
  listLocations,
  listRelationships,
  listResolutionDecisions,
} from "@/lib/db/repository";
import type { Dossier } from "@/lib/domain/dossier";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

import { dossierMarkerKey, getDossierMarker } from "./marker";
import type { DossierDetail, DossierState, DossierSummary, ResolvedReference } from "./types";

/**
 * The server-derived dossier state/query surface the Dossier screen and
 * API routes render from, mirroring src/lib/corroboration/summary.ts.
 *
 * Reads only domain tables plus the graph/analytics/corroboration/
 * dossier markers — never `evidence/ground-truth/`.
 *
 * `getDossierState` is deliberately cheap: it is called on every render
 * of the investigation shell, so it touches markers and at most the
 * dossier table, never the full corpus. The expensive reference
 * resolution happens in `getDossierDetail`, which is only called when
 * an investigator actually opens the report.
 */

function summaryOf(dossier: Dossier): DossierSummary {
  return {
    dossierId: dossier.id,
    investigationId: dossier.investigationId,
    investigationName: dossier.investigationName,
    title: dossier.title,
    graphVersion: dossier.graphVersion,
    reportVersion: dossier.reportVersion,
    generatedAt: dossier.generatedAt,
    counts: dossier.counts,
    aiSynthesisAvailable: dossier.aiSynthesisAvailable,
    aiSynthesisNote: dossier.aiSynthesisNote,
  };
}

/** Newest first, with the id as a deterministic tie-break. */
function newestFirst(dossiers: Dossier[]): Dossier[] {
  return [...dossiers].sort((a, b) => {
    if (a.generatedAt !== b.generatedAt) return a.generatedAt < b.generatedAt ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

export async function getDossierState(): Promise<DossierState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) {
    return { status: "not_available", reason: "No investigation is loaded. Ingest the evidence corpus to begin." };
  }

  const graphMarker = await getGraphMarker(graphMarkerKey(investigation.id));
  if (!graphMarker) {
    return {
      status: "not_available",
      reason: "The case graph has not been synthesized yet. Run extraction, resolution, and graph synthesis first.",
    };
  }
  const currentGraphVersion = graphMarker.synthesizedAt;

  const [analyticsMarker, corroborationMarker] = await Promise.all([
    getAnalyticsMarker(analyticsMarkerKey(investigation.id, currentGraphVersion)),
    getCorroborationMarker(corroborationMarkerKey(investigation.id, currentGraphVersion)),
  ]);
  if (!analyticsMarker) {
    return { status: "not_available", reason: "Topology analytics has not been run against the current graph version yet." };
  }
  if (!corroborationMarker) {
    return {
      status: "not_available",
      reason: "Spatial/temporal corroboration has not been run against the current graph version yet.",
    };
  }

  // A report for the CURRENT graph version is the live one.
  const marker = await getDossierMarker(dossierMarkerKey(investigation.id, currentGraphVersion));
  if (marker) {
    const dossier = await getDossierById(marker.dossierId);
    if (dossier) return { status: "generated", summary: summaryOf(dossier) };
  }

  // Otherwise a report may still exist for a SUPERSEDED graph version.
  // It is kept for audit but must never be presented as current.
  const previous = newestFirst(await listDossiers()).find((d) => d.investigationId === investigation.id);
  if (previous) {
    return { status: "stale", summary: summaryOf(previous), currentGraphVersion };
  }

  return {
    status: "pending",
    investigationId: investigation.id,
    investigationName: investigation.name,
    graphVersion: currentGraphVersion,
  };
}

/**
 * Resolves every id the report references to something readable, plus
 * the screen that can show it. An id that no longer resolves is simply
 * absent from the map — the UI renders the bare id rather than
 * inventing a label for a row that is gone.
 */
async function resolveReferences(dossier: Dossier): Promise<Record<string, ResolvedReference>> {
  const wanted = {
    evidenceSourceIds: new Set<string>(),
    evidenceItemIds: new Set<string>(),
    extractedRecordIds: new Set<string>(),
    entityIds: new Set<string>(),
    locationIds: new Set<string>(),
    resolutionDecisionIds: new Set<string>(),
    communicationEventIds: new Set<string>(),
    relationshipIds: new Set<string>(),
    analyticalSignalIds: new Set<string>(),
    corroborationFindingIds: new Set<string>(),
  };

  const collect = (refs: Dossier["sections"][number]["findings"][number]["references"]) => {
    for (const id of refs.evidenceSourceIds) wanted.evidenceSourceIds.add(id);
    for (const id of refs.evidenceItemIds) wanted.evidenceItemIds.add(id);
    for (const id of refs.extractedRecordIds) wanted.extractedRecordIds.add(id);
    for (const id of refs.entityIds) wanted.entityIds.add(id);
    for (const id of refs.locationIds) wanted.locationIds.add(id);
    for (const id of refs.resolutionDecisionIds) wanted.resolutionDecisionIds.add(id);
    for (const id of refs.communicationEventIds) wanted.communicationEventIds.add(id);
    for (const id of refs.relationshipIds) wanted.relationshipIds.add(id);
    for (const id of refs.analyticalSignalIds) wanted.analyticalSignalIds.add(id);
    for (const id of refs.corroborationFindingIds) wanted.corroborationFindingIds.add(id);
  };
  for (const section of dossier.sections) for (const finding of section.findings) collect(finding.references);
  for (const excerpt of dossier.copilotExcerpts) collect(excerpt.references);

  const [sources, items, records, entities, locations, decisions, events, relationships, signals, findings] =
    await Promise.all([
      listEvidenceSources(),
      listEvidenceItems(),
      listExtractedRecords(),
      listEntities(),
      listLocations(),
      listResolutionDecisions(),
      listCommunicationEvents(),
      listRelationships(),
      listAnalyticalSignals(),
      listCorroborationFindings(),
    ]);

  const entityLabel = new Map(entities.map((e) => [e.id, e.canonicalLabel]));
  const out: Record<string, ResolvedReference> = {};

  for (const s of sources) {
    if (!wanted.evidenceSourceIds.has(s.id)) continue;
    out[s.id] = {
      id: s.id,
      kind: "evidence_source",
      label: `${s.label} (${s.sourceType.replace(/_/g, " ")})`,
      view: "evidence",
      focusEntityId: null,
    };
  }
  for (const i of items) {
    if (!wanted.evidenceItemIds.has(i.id)) continue;
    out[i.id] = {
      id: i.id,
      kind: "evidence_item",
      label: `${i.itemType.replace(/_/g, " ")} · ${i.validationStatus}`,
      view: "evidence",
      focusEntityId: null,
    };
  }
  for (const r of records) {
    if (!wanted.extractedRecordIds.has(r.id)) continue;
    out[r.id] = {
      id: r.id,
      kind: "extracted_record",
      label: `${r.recordType.replace(/_/g, " ")} from ${r.evidenceItemId}`,
      view: "evidence",
      focusEntityId: null,
    };
  }
  for (const e of entities) {
    if (!wanted.entityIds.has(e.id)) continue;
    out[e.id] = {
      id: e.id,
      kind: "entity",
      label: `${e.canonicalLabel} (${e.kind.replace(/_/g, " ")})`,
      view: "graph",
      focusEntityId: e.id,
    };
  }
  for (const l of locations) {
    if (!wanted.locationIds.has(l.id)) continue;
    out[l.id] = {
      id: l.id,
      kind: "location",
      label: `${l.label} (${l.locationType.replace(/_/g, " ")})`,
      view: "corroboration",
      focusEntityId: null,
    };
  }
  for (const ev of events) {
    if (!wanted.communicationEventIds.has(ev.id)) continue;
    out[ev.id] = {
      id: ev.id,
      kind: "communication_event",
      label: `call ${ev.callerPhone} → ${ev.calleePhone} at ${ev.occurredAt}`,
      view: "corroboration",
      focusEntityId: ev.callerEntityId ?? null,
    };
  }
  for (const d of decisions) {
    if (!wanted.resolutionDecisionIds.has(d.id)) continue;
    out[d.id] = {
      id: d.id,
      kind: "resolution_decision",
      label: `${d.resolutionType.replace(/_/g, " ")} · ${d.status} → ${entityLabel.get(d.canonicalEntityId) ?? d.canonicalEntityId}`,
      view: "graph",
      focusEntityId: d.canonicalEntityId,
    };
  }
  for (const rel of relationships) {
    if (!wanted.relationshipIds.has(rel.id)) continue;
    out[rel.id] = {
      id: rel.id,
      kind: "relationship",
      label: `${entityLabel.get(rel.sourceEntityId) ?? rel.sourceEntityId} → ${entityLabel.get(rel.targetEntityId) ?? rel.targetEntityId} (${rel.relationshipType.replace(/_/g, " ")})`,
      view: "graph",
      focusEntityId: rel.sourceEntityId,
    };
  }
  for (const sig of signals) {
    if (!wanted.analyticalSignalIds.has(sig.id)) continue;
    out[sig.id] = {
      id: sig.id,
      kind: "analytical_signal",
      label: `${sig.signalType} · ${sig.method.replace("analytics:", "").replace(/_/g, " ")}${
        sig.targetEntityId ? ` · ${entityLabel.get(sig.targetEntityId) ?? sig.targetEntityId}` : ""
      }`,
      view: "analytics",
      focusEntityId: sig.targetEntityId ?? null,
    };
  }
  for (const f of findings) {
    if (!wanted.corroborationFindingIds.has(f.id)) continue;
    out[f.id] = {
      id: f.id,
      kind: "corroboration_finding",
      label: `${f.findingType.replace(/_/g, " ")} · ${f.classification.replace(/_/g, " ")}`,
      view: "corroboration",
      focusEntityId: f.entityIds[0] ?? null,
    };
  }

  return out;
}

/**
 * The full report plus resolved references, for the Dossier screen.
 *
 * With no `dossierId` it returns the report for the current graph
 * version, falling back to the newest report if only a superseded one
 * exists — which is then marked `stale` rather than presented as
 * current.
 */
export async function getDossierDetail(dossierId?: string): Promise<DossierDetail | null> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return null;

  const graphMarker = await getGraphMarker(graphMarkerKey(investigation.id));
  const currentGraphVersion = graphMarker?.synthesizedAt ?? "";

  let dossier: Dossier | null = null;
  if (dossierId) {
    dossier = await getDossierById(dossierId);
  } else {
    const marker = currentGraphVersion
      ? await getDossierMarker(dossierMarkerKey(investigation.id, currentGraphVersion))
      : null;
    dossier = marker ? await getDossierById(marker.dossierId) : null;
    if (!dossier) {
      dossier = newestFirst(await listDossiers()).find((d) => d.investigationId === investigation.id) ?? null;
    }
  }
  if (!dossier) return null;

  return {
    dossier,
    stale: dossier.graphVersion !== currentGraphVersion,
    currentGraphVersion,
    references: await resolveReferences(dossier),
  };
}
