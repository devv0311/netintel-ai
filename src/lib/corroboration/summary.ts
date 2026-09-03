import {
  listCorroborationFindings,
  listEntities,
  listInvestigations,
  listLocations,
} from "@/lib/db/repository";
import type { CorroborationFinding } from "@/lib/domain/corroboration";
import { getGraphMarker, graphMarkerKey } from "@/lib/graph/marker";

import { corroborationMarkerKey, getCorroborationMarker } from "./marker";
import type {
  CorroborationClassification,
  CorroborationFindingsFilter,
  CorroborationFindingsPage,
  CorroborationFindingType,
  CorroborationFindingView,
  CorroborationKind,
  CorroborationState,
  CorroborationSummary,
  EntityPairOverlapView,
} from "./types";

/**
 * The server-derived corroboration state/query surface the
 * Corroboration screen and API routes render from, mirroring
 * src/lib/analytics/summary.ts. Reads only domain tables (entities,
 * locations, corroboration_findings) plus the graph and corroboration
 * markers — never evidence/ground-truth/.
 */

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

/** Corroborated facts sort ahead of algorithmic signals — the strongest evidence first. */
const CLASSIFICATION_RANK: Record<CorroborationClassification, number> = {
  corroborated_fact: 0,
  algorithmic_signal: 1,
};

async function loadCurrentGraphVersion(investigationId: string): Promise<string | null> {
  const marker = await getGraphMarker(graphMarkerKey(investigationId));
  return marker?.synthesizedAt ?? null;
}

export async function getCorroborationState(): Promise<CorroborationState> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return { status: "not_available" };

  const graphVersion = await loadCurrentGraphVersion(investigation.id);
  if (!graphVersion) return { status: "not_available" };

  const marker = await getCorroborationMarker(corroborationMarkerKey(investigation.id, graphVersion));
  if (!marker) return { status: "pending" };

  const summary: CorroborationSummary = {
    investigationId: investigation.id,
    graphVersion,
    analyzedAt: marker.analyzedAt,
    counts: marker.counts,
  };
  return { status: "synthesized", summary };
}

interface Context {
  graphVersion: string;
  entityById: Map<string, { id: string; canonicalLabel: string; kind: string }>;
  locationById: Map<string, { id: string; label: string; latitude: number; longitude: number }>;
  findings: CorroborationFinding[];
}

async function loadContext(): Promise<Context | null> {
  const investigations = await listInvestigations();
  const investigation = investigations[0];
  if (!investigation) return null;
  const graphVersion = await loadCurrentGraphVersion(investigation.id);
  if (!graphVersion) return null;

  const [entities, locations, allFindings] = await Promise.all([
    listEntities(),
    listLocations(),
    listCorroborationFindings(),
  ]);

  // Only findings stamped with the CURRENT graph version are live — a
  // stale finding from a prior graph version stays in the store for
  // audit but is never surfaced as current.
  const findings = allFindings
    .filter((f) => f.graphVersion === graphVersion)
    .sort((a, b) => {
      const rank = CLASSIFICATION_RANK[a.classification] - CLASSIFICATION_RANK[b.classification];
      if (rank !== 0) return rank;
      if (a.findingType !== b.findingType) return a.findingType < b.findingType ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

  return {
    graphVersion,
    entityById: new Map(entities.map((e) => [e.id, { id: e.id, canonicalLabel: e.canonicalLabel, kind: e.kind }])),
    locationById: new Map(
      locations.map((l) => [l.id, { id: l.id, label: l.label, latitude: l.latitude, longitude: l.longitude }]),
    ),
    findings,
  };
}

function toView(f: CorroborationFinding, ctx: Context): CorroborationFindingView {
  return {
    id: f.id,
    findingType: f.findingType,
    kind: f.kind,
    classification: f.classification,
    entities: f.entityIds.map((id) => {
      const e = ctx.entityById.get(id);
      return { id, label: e?.canonicalLabel ?? id, kind: e?.kind ?? "unknown" };
    }),
    locations: f.locationIds.map((id) => {
      const l = ctx.locationById.get(id);
      return { id, label: l?.label ?? id, latitude: l?.latitude ?? 0, longitude: l?.longitude ?? 0 };
    }),
    window: f.window,
    value: f.value,
    method: f.method,
    explanation: f.explanation,
    evidenceItemIds: f.evidenceItemIds,
    supportingRecordIds: f.supportingRecordIds,
    provenance: f.provenance,
  };
}

export interface CorroborationFindingsQuery {
  offset?: number;
  limit?: number;
  kind?: CorroborationKind | null;
  type?: CorroborationFindingType | null;
  classification?: CorroborationClassification | null;
  entityId?: string | null;
}

export async function getCorroborationFindings(query?: CorroborationFindingsQuery): Promise<CorroborationFindingsPage | null> {
  const ctx = await loadContext();
  if (!ctx) return null;

  const filter: CorroborationFindingsFilter = {
    kind: query?.kind ?? null,
    type: query?.type ?? null,
    classification: query?.classification ?? null,
    entityId: query?.entityId ?? null,
  };

  let filtered = ctx.findings;
  if (filter.kind) filtered = filtered.filter((f) => f.kind === filter.kind);
  if (filter.type) filtered = filtered.filter((f) => f.findingType === filter.type);
  if (filter.classification) filtered = filtered.filter((f) => f.classification === filter.classification);
  if (filter.entityId) filtered = filtered.filter((f) => f.entityIds.includes(filter.entityId as string));

  const total = filtered.length;
  const offset = Math.max(0, query?.offset ?? 0);
  const limit = Math.min(Math.max(1, query?.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
  const findings = filtered.slice(offset, offset + limit).map((f) => toView(f, ctx));

  return { findings, total, offset, limit, graphVersion: ctx.graphVersion, filter };
}

export async function getCorroborationFindingDetail(id: string): Promise<CorroborationFindingView | null> {
  const ctx = await loadContext();
  if (!ctx) return null;
  const finding = ctx.findings.find((f) => f.id === id);
  return finding ? toView(finding, ctx) : null;
}

export async function getEntityPairOverlaps(): Promise<EntityPairOverlapView[] | null> {
  const ctx = await loadContext();
  if (!ctx) return null;

  const pairs = new Map<string, EntityPairOverlapView>();
  for (const f of ctx.findings) {
    if (f.entityIds.length !== 2) continue;
    const [a, b] = [...f.entityIds].sort();
    const key = `${a}|${b}`;
    let pair = pairs.get(key);
    if (!pair) {
      const ea = ctx.entityById.get(a as string);
      const eb = ctx.entityById.get(b as string);
      pair = {
        entityAId: a as string,
        entityBId: b as string,
        entityALabel: ea?.canonicalLabel ?? (a as string),
        entityBLabel: eb?.canonicalLabel ?? (b as string),
        entityAKind: ea?.kind ?? "unknown",
        entityBKind: eb?.kind ?? "unknown",
        spatialFindings: 0,
        temporalFindings: 0,
        repeatedOverlaps: 0,
        contradictions: 0,
        corroboratedFacts: 0,
        strongestClassification: "algorithmic_signal",
        findingIds: [],
      };
      pairs.set(key, pair);
    }
    pair.findingIds.push(f.id);
    if (f.kind === "spatial") pair.spatialFindings += 1;
    if (f.findingType === "temporal_co_occurrence") pair.temporalFindings += 1;
    if (f.findingType === "repeated_spatiotemporal_overlap") pair.repeatedOverlaps += 1;
    if (f.findingType === "spatiotemporal_contradiction") pair.contradictions += 1;
    if (f.classification === "corroborated_fact") {
      pair.corroboratedFacts += 1;
      pair.strongestClassification = "corroborated_fact";
    }
  }

  return [...pairs.values()]
    .map((p) => ({ ...p, findingIds: [...p.findingIds].sort() }))
    .sort((a, b) => {
      if (b.corroboratedFacts !== a.corroboratedFacts) return b.corroboratedFacts - a.corroboratedFacts;
      if (b.repeatedOverlaps !== a.repeatedOverlaps) return b.repeatedOverlaps - a.repeatedOverlaps;
      const total = (x: EntityPairOverlapView) => x.spatialFindings + x.temporalFindings + x.repeatedOverlaps + x.contradictions;
      if (total(b) !== total(a)) return total(b) - total(a);
      return a.entityAId < b.entityAId ? -1 : a.entityAId > b.entityAId ? 1 : a.entityBId < b.entityBId ? -1 : 1;
    });
}
