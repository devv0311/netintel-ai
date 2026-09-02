import type { CommunicationEvent } from "@/lib/domain/events";
import type { Entity } from "@/lib/domain/entity";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import { makeContentId } from "@/lib/domain/ids";
import type { Location } from "@/lib/domain/location";
import type { Provenance } from "@/lib/domain/provenance";
import type { Relationship } from "@/lib/domain/relationship";
import type {
  CorroborationClassification,
  CorroborationFindingType,
  CorroborationKind,
} from "@/lib/domain/corroboration";

import { haversineMeters, SPATIAL_PROXIMITY_METERS } from "./spatial";
import {
  impliedSpeedMps,
  MAX_PLAUSIBLE_SPEED_MPS,
  REPEATED_OCCURRENCE_MIN,
  secondsBetween,
  TEMPORAL_WINDOW_SECONDS,
  utcDay,
  withinWindow,
} from "./temporal";

/**
 * Spatial/temporal corroboration core: deterministic computation over
 * the P5.2 persisted communication events, P5.3 extracted event
 * mentions, P5.4 resolved entities, P5.5 synthesized graph, and P5.2
 * persisted locations. Every function here is pure — given the same
 * inputs it produces byte-identical output, every time. No randomness,
 * no wall-clock read (the run timestamp is passed in), no invented
 * coordinate or timestamp.
 *
 * The observable data this reads, and why:
 *
 *   - `communication_events` — the authoritative per-call record
 *     (P5.2). Each row carries the caller/callee phone numbers, the
 *     instant, the resolved `cellLocationId` (a real `locations.id`),
 *     and full provenance whose `source` is the originating evidence
 *     item. This is the primary spatiotemporal source.
 *   - extracted `event_mention` records of kind `financial_transaction`
 *     (P5.3) — the ONLY place a transaction's account linkage survives
 *     (the `financial_transactions` table itself stores no account
 *     ids). Contributes timing-only activity (no location on a wire
 *     transfer).
 *   - `relationships` of type `ownership` (P5.5) — rolls a phone/
 *     account identifier entity up to the person who owns it, so a
 *     finding can be about people, not only handsets.
 *   - `locations` (P5.2) — latitude/longitude for the haversine
 *     distance the stack contract prescribes.
 *
 * Classification (docs/requirements.md §7): a finding is a
 * `corroborated_fact` only when the spatial/temporal co-occurrence is
 * independently attested by TWO OR MORE distinct evidence items;
 * otherwise it is an `algorithmic_signal`. A `spatial_proximity`
 * signal and every `spatiotemporal_contradiction` are ALWAYS
 * `algorithmic_signal` — proximity between two distinct locations is
 * never "they were together", and a flagged conflict is never itself a
 * fact.
 */

// --- shared helpers --------------------------------------------------

function byId<T extends { id: string }>(a: T, b: T): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function uniqSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function round(n: number, digits = 3): number {
  if (!Number.isFinite(n)) return n;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function windowOf(times: string[]): { start: string; end?: string } | null {
  if (times.length === 0) return null;
  const sorted = [...times].sort();
  const start = sorted[0]!;
  const end = sorted[sorted.length - 1]!;
  return end !== start ? { start, end } : { start };
}

// --- activity index -------------------------------------------------

export interface ActivityEvent {
  /** The subject entity id — the owning person entity when resolvable, otherwise the identifier (phone/account) entity id. */
  subjectId: string;
  /** The identifier entity id the raw record actually names. */
  identifierEntityId: string;
  /** A real `locations.id`, or null for a location-less activity (a wire transfer). */
  locationId: string | null;
  /** ISO-8601 instant the activity occurred (from the persisted record — never invented). */
  at: string;
  channel: "communication" | "financial";
  /** The originating evidence item id. */
  evidenceItemId: string;
  /** The persisted observable record: a `communication_events.id` or an `extracted_records.id`. */
  recordId: string;
}

export interface ActivityIndex {
  events: ActivityEvent[];
  warnings: string[];
  entitiesConsidered: number;
  locationsConsidered: number;
}

export function buildActivityIndex(
  entities: Entity[],
  locations: Location[],
  relationships: Relationship[],
  communicationEvents: CommunicationEvent[],
  records: ExtractedRecord[],
): ActivityIndex {
  const warnings: string[] = [];
  const entityById = new Map(entities.map((e) => [e.id, e]));
  const locationIds = new Set(locations.map((l) => l.id));

  // "<kind>:<value>" -> identifier entity id (identifier entities' canonicalLabel IS the raw value, per P5.4).
  const identifierEntityId = new Map<string, string>();
  for (const e of [...entities].sort(byId)) {
    if (e.kind !== "person") identifierEntityId.set(`${e.kind}:${e.canonicalLabel}`, e.id);
  }

  // identifier entity id -> owning person entity id (first ownership edge by id wins — mirrors src/lib/graph/build.ts).
  const ownerOf = new Map<string, string>();
  for (const r of [...relationships].sort(byId)) {
    if (r.relationshipType !== "ownership") continue;
    const src = entityById.get(r.sourceEntityId);
    if (!src || src.kind !== "person") continue;
    if (!ownerOf.has(r.targetEntityId)) ownerOf.set(r.targetEntityId, r.sourceEntityId);
  }
  const subjectOf = (identifier: string): string => ownerOf.get(identifier) ?? identifier;

  const events: ActivityEvent[] = [];

  // Communication activity — the authoritative persisted CDR rows.
  for (const ce of [...communicationEvents].sort(byId)) {
    const callerId = identifierEntityId.get(`phone:${ce.callerPhone}`);
    const calleeId = identifierEntityId.get(`phone:${ce.calleePhone}`);
    if (!callerId && !calleeId) {
      warnings.push(`communication event ${ce.id}: neither phone was canonicalized; no activity recorded.`);
      continue;
    }
    const locId = ce.cellLocationId && locationIds.has(ce.cellLocationId) ? ce.cellLocationId : null;
    for (const identifier of [callerId, calleeId]) {
      if (!identifier) continue;
      events.push({
        subjectId: subjectOf(identifier),
        identifierEntityId: identifier,
        locationId: locId,
        at: ce.occurredAt,
        channel: "communication",
        evidenceItemId: ce.provenance.source,
        recordId: ce.id,
      });
    }
  }

  // Financial activity — extracted event mentions (the only surviving account linkage).
  for (const r of [...records].sort(byId)) {
    if (r.recordType !== "event_mention" || str(r.data, "eventKind") !== "financial_transaction") continue;
    const at = str(r.data, "valueDate");
    if (!at) continue;
    const fromAccount = str(r.data, "fromAccount");
    const toAccount = str(r.data, "toAccount");
    const fromId = fromAccount ? identifierEntityId.get(`bank_account:${fromAccount}`) : undefined;
    const toId = toAccount ? identifierEntityId.get(`bank_account:${toAccount}`) : undefined;
    if (!fromId && !toId) continue;
    for (const identifier of [fromId, toId]) {
      if (!identifier) continue;
      events.push({
        subjectId: subjectOf(identifier),
        identifierEntityId: identifier,
        locationId: null,
        at,
        channel: "financial",
        evidenceItemId: r.evidenceItemId,
        recordId: r.id,
      });
    }
  }

  events.sort((a, b) =>
    a.at !== b.at
      ? a.at < b.at
        ? -1
        : 1
      : a.subjectId !== b.subjectId
        ? a.subjectId < b.subjectId
          ? -1
          : 1
        : a.recordId !== b.recordId
          ? a.recordId < b.recordId
            ? -1
            : 1
          : a.channel < b.channel
            ? -1
            : a.channel > b.channel
              ? 1
              : 0,
  );

  return {
    events,
    warnings,
    entitiesConsidered: new Set(events.map((e) => e.subjectId)).size,
    locationsConsidered: new Set(events.filter((e) => e.locationId).map((e) => e.locationId as string)).size,
  };
}

// --- raw findings (pre-id, pre-provenance) --------------------------

export interface RawFinding {
  findingType: CorroborationFindingType;
  kind: CorroborationKind;
  entityIds: string[];
  locationIds: string[];
  window: { start: string; end?: string } | null;
  value: Record<string, unknown>;
  method: string;
  explanation: string;
  classification: CorroborationClassification;
  evidenceItemIds: string[];
  supportingRecordIds: string[];
}

type LabelFn = (id: string) => string;

/** ≥2 distinct subjects each with recorded activity at the SAME persisted location. */
export function computeSpatialCoLocations(events: ActivityEvent[], label: LabelFn): RawFinding[] {
  const withLoc = events.filter((e) => e.locationId);
  const byLoc = groupBy(withLoc, (e) => e.locationId as string);
  const out: RawFinding[] = [];

  for (const locId of [...byLoc.keys()].sort()) {
    const bySubject = groupBy(byLoc.get(locId)!, (e) => e.subjectId);
    const subjects = [...bySubject.keys()].sort();
    if (subjects.length < 2) continue;

    for (let i = 0; i < subjects.length; i++) {
      for (let j = i + 1; j < subjects.length; j++) {
        const a = subjects[i]!;
        const b = subjects[j]!;
        const aEvs = bySubject.get(a)!;
        const bEvs = bySubject.get(b)!;
        const contrib = [...aEvs, ...bEvs];
        const evidenceItemIds = uniqSorted(contrib.map((e) => e.evidenceItemId));
        const supportingRecordIds = uniqSorted(contrib.map((e) => e.recordId));
        const window = windowOf(contrib.map((e) => e.at));
        const classification: CorroborationClassification =
          evidenceItemIds.length >= 2 ? "corroborated_fact" : "algorithmic_signal";
        const attest =
          classification === "corroborated_fact"
            ? `attested by ${evidenceItemIds.length} independent evidence items`
            : `from a single evidence item — not independently corroborated`;
        out.push({
          findingType: "spatial_co_location",
          kind: "spatial",
          entityIds: [a, b].sort(),
          locationIds: [locId],
          window,
          value: {
            locationId: locId,
            subjectAActivityCount: aEvs.length,
            subjectBActivityCount: bEvs.length,
            distinctEvidenceItemCount: evidenceItemIds.length,
            spanSeconds: window?.end ? secondsBetween(window.start, window.end) : 0,
          },
          method: "corroboration:spatial_co_location",
          classification,
          explanation: `${label(a)} and ${label(b)} both had recorded activity at ${label(locId)} (${attest}). A spatial co-occurrence at a shared location — not a claim that the two were physically together.`,
          evidenceItemIds,
          supportingRecordIds,
        });
      }
    }
  }
  return out;
}

/** Two DISTINCT persisted locations within the distance threshold, each with entity activity. Always an algorithmic signal. */
export function computeSpatialProximities(events: ActivityEvent[], locations: Location[], label: LabelFn): RawFinding[] {
  const locById = new Map(locations.map((l) => [l.id, l]));
  const eventsByLoc = groupBy(
    events.filter((e) => e.locationId && locById.has(e.locationId)),
    (e) => e.locationId as string,
  );
  const activeLocIds = [...eventsByLoc.keys()].sort();
  const out: RawFinding[] = [];

  for (let i = 0; i < activeLocIds.length; i++) {
    for (let j = i + 1; j < activeLocIds.length; j++) {
      const la = locById.get(activeLocIds[i]!)!;
      const lb = locById.get(activeLocIds[j]!)!;
      const distanceMeters = haversineMeters(la.latitude, la.longitude, lb.latitude, lb.longitude);
      if (!(distanceMeters > 0 && distanceMeters <= SPATIAL_PROXIMITY_METERS)) continue;

      const aEvs = eventsByLoc.get(la.id)!;
      const bEvs = eventsByLoc.get(lb.id)!;
      const contrib = [...aEvs, ...bEvs];
      const evidenceItemIds = uniqSorted(contrib.map((e) => e.evidenceItemId));
      const supportingRecordIds = uniqSorted(contrib.map((e) => e.recordId));
      out.push({
        findingType: "spatial_proximity",
        kind: "spatial",
        entityIds: [],
        locationIds: [la.id, lb.id].sort(),
        window: null,
        value: {
          distanceMeters,
          thresholdMeters: SPATIAL_PROXIMITY_METERS,
          locationAActivityCount: aEvs.length,
          locationBActivityCount: bEvs.length,
          distinctEvidenceItemCount: evidenceItemIds.length,
        },
        method: "corroboration:haversine_proximity",
        classification: "algorithmic_signal",
        explanation: `${label(la.id)} and ${label(lb.id)} are ${distanceMeters} m apart — within the ${SPATIAL_PROXIMITY_METERS} m proximity threshold — and both have recorded entity activity. An algorithmic proximity signal about the locations; it does not assert that any entity was at both, or that any two entities were together.`,
        evidenceItemIds,
        supportingRecordIds,
      });
    }
  }
  return out;
}

/** ≥2 distinct subjects active within the same time window, contributed by ≥2 distinct evidence items. */
export function computeTemporalCoOccurrences(events: ActivityEvent[], label: LabelFn): RawFinding[] {
  const bySubject = groupBy(events, (e) => e.subjectId);
  const subjects = [...bySubject.keys()].sort();
  const windowMs = TEMPORAL_WINDOW_SECONDS * 1000;
  const out: RawFinding[] = [];

  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const a = subjects[i]!;
      const b = subjects[j]!;
      const aEvs = [...bySubject.get(a)!].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
      const bEvs = [...bySubject.get(b)!].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));

      const instances: { a: ActivityEvent; b: ActivityEvent; gap: number }[] = [];
      let lo = 0;
      for (const ae of aEvs) {
        const aMs = Date.parse(ae.at);
        while (lo < bEvs.length && Date.parse(bEvs[lo]!.at) < aMs - windowMs) lo++;
        for (let k = lo; k < bEvs.length && Date.parse(bEvs[k]!.at) <= aMs + windowMs; k++) {
          instances.push({ a: ae, b: bEvs[k]!, gap: secondsBetween(ae.at, bEvs[k]!.at) });
        }
      }
      if (instances.length === 0) continue;

      const contrib = instances.flatMap((x) => [x.a, x.b]);
      const evidenceItemIds = uniqSorted(contrib.map((e) => e.evidenceItemId));
      // A "co-occurrence" carried by a single evidence item is just that one
      // record (e.g. the two ends of one call) — never a corroboration signal.
      if (evidenceItemIds.length < 2) continue;

      const supportingRecordIds = uniqSorted(contrib.map((e) => e.recordId));
      const window = windowOf(contrib.map((e) => e.at));
      const occurrenceCount = new Set(instances.map((x) => `${x.a.recordId}|${x.b.recordId}`)).size;
      const distinctDayCount = new Set(contrib.map((e) => utcDay(e.at))).size;
      const channels = uniqSorted(contrib.map((e) => e.channel));
      const minGapSeconds = Math.min(...instances.map((x) => x.gap));
      const classification: CorroborationClassification =
        occurrenceCount >= REPEATED_OCCURRENCE_MIN ? "corroborated_fact" : "algorithmic_signal";

      out.push({
        findingType: "temporal_co_occurrence",
        kind: "temporal",
        entityIds: [a, b].sort(),
        locationIds: [],
        window,
        value: {
          occurrenceCount,
          windowSeconds: TEMPORAL_WINDOW_SECONDS,
          minGapSeconds,
          distinctDayCount,
          distinctEvidenceItemCount: evidenceItemIds.length,
          channels,
        },
        method: "corroboration:temporal_window",
        classification,
        explanation: `${label(a)} and ${label(b)} were each active within ${TEMPORAL_WINDOW_SECONDS / 60} minutes on ${occurrenceCount} occasion(s) across ${distinctDayCount} day(s), attested by ${evidenceItemIds.length} distinct evidence items${
          classification === "corroborated_fact"
            ? ""
            : " (a single joint occurrence — reported as an algorithmic signal, not a corroborated pattern)"
        }. A timing correlation only — never a claim of causation or contact.`,
        evidenceItemIds,
        supportingRecordIds,
      });
    }
  }
  return out;
}

/** A subject pair active at the SAME location within the window on ≥REPEATED_OCCURRENCE_MIN separate occasions. */
export function computeRepeatedOverlaps(events: ActivityEvent[], label: LabelFn): RawFinding[] {
  const bySubject = groupBy(
    events.filter((e) => e.locationId),
    (e) => e.subjectId,
  );
  const subjects = [...bySubject.keys()].sort();
  const out: RawFinding[] = [];

  for (let i = 0; i < subjects.length; i++) {
    for (let j = i + 1; j < subjects.length; j++) {
      const a = subjects[i]!;
      const b = subjects[j]!;
      const aByLoc = groupBy(bySubject.get(a)!, (e) => e.locationId as string);
      const bByLoc = groupBy(bySubject.get(b)!, (e) => e.locationId as string);
      const sharedLocs = [...aByLoc.keys()].filter((l) => bByLoc.has(l)).sort();

      for (const locId of sharedLocs) {
        const pairs = new Map<string, { a: ActivityEvent; b: ActivityEvent }>();
        for (const ae of aByLoc.get(locId)!) {
          for (const be of bByLoc.get(locId)!) {
            if (!withinWindow(ae.at, be.at)) continue;
            pairs.set(`${ae.recordId}|${be.recordId}`, { a: ae, b: be });
          }
        }
        if (pairs.size < REPEATED_OCCURRENCE_MIN) continue;

        const instances = [...pairs.values()];
        const contrib = instances.flatMap((x) => [x.a, x.b]);
        const evidenceItemIds = uniqSorted(contrib.map((e) => e.evidenceItemId));
        const supportingRecordIds = uniqSorted(contrib.map((e) => e.recordId));
        const window = windowOf(contrib.map((e) => e.at));
        const distinctDayCount = new Set(contrib.map((e) => utcDay(e.at))).size;
        const classification: CorroborationClassification =
          evidenceItemIds.length >= 2 ? "corroborated_fact" : "algorithmic_signal";

        out.push({
          findingType: "repeated_spatiotemporal_overlap",
          kind: "spatiotemporal",
          entityIds: [a, b].sort(),
          locationIds: [locId],
          window,
          value: {
            locationId: locId,
            overlapCount: instances.length,
            windowSeconds: TEMPORAL_WINDOW_SECONDS,
            distinctDayCount,
            distinctEvidenceItemCount: evidenceItemIds.length,
          },
          method: "corroboration:repeated_spatiotemporal_overlap",
          classification,
          explanation: `${label(a)} and ${label(b)} were active at ${label(locId)} within ${TEMPORAL_WINDOW_SECONDS / 60} minutes of each other on ${instances.length} separate occasions (${distinctDayCount} day(s))${
            classification === "corroborated_fact"
              ? `, attested by ${evidenceItemIds.length} independent evidence items`
              : ` from a single evidence item`
          }. Repeated spatial/temporal overlap — a corroboration signal for the investigator, not a proof of association.`,
          evidenceItemIds,
          supportingRecordIds,
        });
      }
    }
  }
  return out;
}

/** One subject placed at two locations whose separation implies an impossible travel speed. Always an algorithmic signal. */
export function computeContradictions(events: ActivityEvent[], locations: Location[], label: LabelFn): RawFinding[] {
  const locById = new Map(locations.map((l) => [l.id, l]));
  const bySubject = groupBy(
    events.filter((e) => e.locationId && locById.has(e.locationId)),
    (e) => e.subjectId,
  );
  const out: RawFinding[] = [];

  for (const subjectId of [...bySubject.keys()].sort()) {
    const evs = [...bySubject.get(subjectId)!].sort((x, y) =>
      x.at !== y.at ? (x.at < y.at ? -1 : 1) : x.recordId < y.recordId ? -1 : x.recordId > y.recordId ? 1 : 0,
    );
    const bestByLocPair = new Map<string, { finding: RawFinding; speed: number }>();

    for (let k = 0; k + 1 < evs.length; k++) {
      const e1 = evs[k]!;
      const e2 = evs[k + 1]!;
      if (e1.locationId === e2.locationId) continue;
      const l1 = locById.get(e1.locationId as string)!;
      const l2 = locById.get(e2.locationId as string)!;
      const distanceMeters = haversineMeters(l1.latitude, l1.longitude, l2.latitude, l2.longitude);
      const elapsedSeconds = secondsBetween(e1.at, e2.at);
      const speed = impliedSpeedMps(distanceMeters, elapsedSeconds);
      if (speed <= MAX_PLAUSIBLE_SPEED_MPS) continue;

      const pair = [e1.locationId as string, e2.locationId as string].sort();
      const key = pair.join("|");
      const prev = bestByLocPair.get(key);
      if (prev && prev.speed >= speed) continue;

      const window = windowOf([e1.at, e2.at])!;
      const speedText = Number.isFinite(speed)
        ? `an implied travel speed of ${round(speed)} m/s`
        : `an instantaneous jump (0 s elapsed)`;
      bestByLocPair.set(key, {
        speed,
        finding: {
          findingType: "spatiotemporal_contradiction",
          kind: "spatiotemporal",
          entityIds: [subjectId],
          locationIds: pair,
          window,
          value: {
            impliedSpeedMps: Number.isFinite(speed) ? round(speed) : null,
            maxPlausibleSpeedMps: MAX_PLAUSIBLE_SPEED_MPS,
            distanceMeters,
            elapsedSeconds,
            locationAId: pair[0],
            locationBId: pair[1],
          },
          method: "corroboration:travel_speed_contradiction",
          classification: "algorithmic_signal",
          explanation: `${label(subjectId)} is placed at ${label(e1.locationId as string)} and then ${label(e2.locationId as string)} (${distanceMeters} m apart) only ${elapsedSeconds} s apart — ${speedText}, above the ${MAX_PLAUSIBLE_SPEED_MPS} m/s plausibility threshold. Flagged as a spatiotemporal inconsistency; both source records are cited and neither is presumed correct.`,
          evidenceItemIds: uniqSorted([e1.evidenceItemId, e2.evidenceItemId]),
          supportingRecordIds: uniqSorted([e1.recordId, e2.recordId]),
        },
      });
    }

    for (const key of [...bestByLocPair.keys()].sort()) out.push(bestByLocPair.get(key)!.finding);
  }
  return out;
}

// --- assembling CorroborationFinding candidates ---------------------

export interface CorroborationFindingCandidate {
  id: string;
  investigationId: string;
  graphVersion: string;
  findingType: CorroborationFindingType;
  kind: CorroborationKind;
  entityIds: string[];
  locationIds: string[];
  window: { start: string; end?: string } | null;
  value: Record<string, unknown>;
  method: string;
  explanation: string;
  classification: CorroborationClassification;
  evidenceItemIds: string[];
  supportingRecordIds: string[];
  provenance: Provenance;
}

export interface CorroborationBuildOutput {
  findings: CorroborationFindingCandidate[];
  warnings: string[];
  stats: {
    entitiesConsidered: number;
    locationsConsidered: number;
    activityEvents: number;
  };
}

export function synthesizeCorroboration(
  entities: Entity[],
  locations: Location[],
  relationships: Relationship[],
  communicationEvents: CommunicationEvent[],
  records: ExtractedRecord[],
  investigationId: string,
  graphVersion: string,
  analyzedAt: string,
): CorroborationBuildOutput {
  const index = buildActivityIndex(entities, locations, relationships, communicationEvents, records);

  const labelById = new Map<string, string>();
  for (const e of entities) labelById.set(e.id, e.canonicalLabel);
  for (const l of locations) labelById.set(l.id, l.label);
  const label: LabelFn = (id) => labelById.get(id) ?? id;

  const raws: RawFinding[] = [
    ...computeSpatialCoLocations(index.events, label),
    ...computeSpatialProximities(index.events, locations, label),
    ...computeTemporalCoOccurrences(index.events, label),
    ...computeRepeatedOverlaps(index.events, label),
    ...computeContradictions(index.events, locations, label),
  ];

  const candidates: CorroborationFindingCandidate[] = raws.map((r) => {
    const entityIds = [...r.entityIds].sort();
    const locationIds = [...r.locationIds].sort();
    const id = makeContentId("corroboration_finding", [
      r.findingType,
      ...entityIds,
      ...locationIds,
      r.window?.start ?? "",
      r.window?.end ?? "",
      graphVersion,
    ]);
    const source = r.evidenceItemIds[0] ?? entityIds[0] ?? locationIds[0] ?? id;
    return {
      id,
      investigationId,
      graphVersion,
      findingType: r.findingType,
      kind: r.kind,
      entityIds,
      locationIds,
      window: r.window,
      value: r.value,
      method: r.method,
      explanation: r.explanation,
      classification: r.classification,
      evidenceItemIds: r.evidenceItemIds,
      supportingRecordIds: r.supportingRecordIds,
      provenance: {
        source,
        location: `graph_version:${graphVersion}`,
        method: r.method,
        confidence: 1,
        processingHistory: [`graph:synthesized:${graphVersion}`, r.method],
        timestamp: analyzedAt,
      },
    };
  });

  const seen = new Set<string>();
  const findings = candidates
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)));

  return {
    findings,
    warnings: index.warnings,
    stats: {
      entitiesConsidered: index.entitiesConsidered,
      locationsConsidered: index.locationsConsidered,
      activityEvents: index.events.length,
    },
  };
}
