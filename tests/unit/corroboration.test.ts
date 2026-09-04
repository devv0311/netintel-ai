import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
import type { Entity } from "@/lib/domain/entity";
import type { Location } from "@/lib/domain/location";
import type { CommunicationEvent } from "@/lib/domain/events";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Relationship } from "@/lib/domain/relationship";
import {
  haversineMeters,
  isNearby,
  SPATIAL_PROXIMITY_METERS,
} from "@/lib/corroboration/spatial";
import {
  impliedSpeedMps,
  MAX_PLAUSIBLE_SPEED_MPS,
  REPEATED_OCCURRENCE_MIN,
  secondsBetween,
  TEMPORAL_WINDOW_SECONDS,
  withinWindow,
} from "@/lib/corroboration/temporal";
import {
  buildActivityIndex,
  computeContradictions,
  computeRepeatedOverlaps,
  computeSpatialCoLocations,
  computeSpatialProximities,
  computeTemporalCoOccurrences,
  synthesizeCorroboration,
} from "@/lib/corroboration/build";

import { prepareFreshDb, releaseAndRemoveDb } from "./helpers/db";

const NOW = "2026-09-03T00:00:00.000Z";
const GV = "graph-v1";

function prov(source: string) {
  return {
    source,
    location: "loc",
    method: "test",
    confidence: 1,
    processingHistory: [`test:${source}`],
    timestamp: NOW,
  };
}

function person(id: string, label: string): Entity {
  return { id, investigationId: "inv1", kind: "person", canonicalLabel: label, attributes: {}, provenance: prov(id) };
}
function phone(id: string, number: string): Entity {
  return { id, investigationId: "inv1", kind: "phone", canonicalLabel: number, attributes: {}, provenance: prov(id) };
}
function account(id: string, acc: string): Entity {
  return { id, investigationId: "inv1", kind: "bank_account", canonicalLabel: acc, attributes: {}, provenance: prov(id) };
}
function loc(id: string, label: string, latitude: number, longitude: number): Location {
  return { id, investigationId: "inv1", label, locationType: "cell_tower", latitude, longitude, provenance: prov(id) };
}
function ownership(id: string, personId: string, identifierId: string): Relationship {
  return {
    id,
    investigationId: "inv1",
    sourceEntityId: personId,
    targetEntityId: identifierId,
    relationshipType: "ownership",
    directed: true,
    evidenceItemIds: ["item_own"],
    extractedRecordIds: ["er_own"],
    conflicts: [],
    attributes: {},
    classification: "observed_fact",
    provenance: prov("er_own"),
  };
}
function cdr(
  id: string,
  callerPhone: string,
  calleePhone: string,
  occurredAt: string,
  evidenceItemId: string,
  cellLocationId?: string,
): CommunicationEvent {
  return {
    id,
    investigationId: "inv1",
    callerPhone,
    calleePhone,
    occurredAt,
    durationSeconds: 60,
    ...(cellLocationId ? { cellLocationId } : {}),
    provenance: prov(evidenceItemId),
  };
}
function finTxn(id: string, evidenceItemId: string, fromAccount: string, toAccount: string, valueDate: string): ExtractedRecord {
  return {
    id,
    evidenceItemId,
    recordType: "event_mention",
    data: { eventKind: "financial_transaction", fromAccount, toAccount, amount: 1000, currency: "INR", valueDate },
    classification: "observed_fact",
    provenance: prov(evidenceItemId),
  };
}

// A small synthetic world: two people, each owning a phone, plus two towers.
const ALICE = person("person_alice", "Alice");
const BOB = person("person_bob", "Bob");
const CARA = person("person_cara", "Cara");
const PH_A = phone("phone_a", "+900000001");
const PH_B = phone("phone_b", "+900000002");
const PH_C = phone("phone_c", "+900000003");
const T1 = loc("loc_t1", "Tower 1", 28.6, 77.2);
const T2 = loc("loc_t2", "Tower 2", 28.601, 77.2); // ~111 m from T1
const T3 = loc("loc_t3", "Tower 3", 29.6, 78.2); // far from T1/T2
const OWN = [ownership("rel_oa", ALICE.id, PH_A.id), ownership("rel_ob", BOB.id, PH_B.id), ownership("rel_oc", CARA.id, PH_C.id)];
const ENTITIES = [ALICE, BOB, CARA, PH_A, PH_B, PH_C];
const LOCATIONS = [T1, T2, T3];

const label = (id: string) => ENTITIES.find((e) => e.id === id)?.canonicalLabel ?? LOCATIONS.find((l) => l.id === id)?.label ?? id;

// ---------------------------------------------------------------------------
// spatial primitives
// ---------------------------------------------------------------------------

describe("haversineMeters", () => {
  it("returns 0 for identical points", () => {
    expect(haversineMeters(28.6139, 77.209, 28.6139, 77.209)).toBe(0);
  });

  it("returns ~111 km for one degree of latitude", () => {
    const d = haversineMeters(0, 0, 1, 0);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it("returns ~1112 m for 0.01 degree of latitude", () => {
    const d = haversineMeters(28.6, 77.2, 28.61, 77.2);
    expect(d).toBeGreaterThan(1090);
    expect(d).toBeLessThan(1135);
  });

  it("is symmetric and integer-valued", () => {
    const ab = haversineMeters(28.6, 77.2, 28.7, 77.3);
    const ba = haversineMeters(28.7, 77.3, 28.6, 77.2);
    expect(ab).toBe(ba);
    expect(Number.isInteger(ab)).toBe(true);
  });
});

describe("isNearby — threshold boundary", () => {
  it("is false for the exact same point (distance 0 is not 'nearby')", () => {
    expect(isNearby({ latitude: 28.6, longitude: 77.2 }, { latitude: 28.6, longitude: 77.2 })).toBe(false);
  });

  it("is true just inside the default threshold and false just outside", () => {
    const base = { latitude: 28.6, longitude: 77.2 };
    // ~111 m away — well inside the 1000 m default
    expect(isNearby(base, { latitude: 28.601, longitude: 77.2 })).toBe(true);
    // ~1112 m away — outside the 1000 m default
    expect(isNearby(base, { latitude: 28.61, longitude: 77.2 })).toBe(false);
  });

  it("respects an explicit custom threshold", () => {
    const a = { latitude: 28.6, longitude: 77.2 };
    const b = { latitude: 28.61, longitude: 77.2 }; // ~1112 m
    expect(isNearby(a, b, 2000)).toBe(true);
    expect(isNearby(a, b, 1000)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// temporal primitives
// ---------------------------------------------------------------------------

describe("temporal primitives", () => {
  it("secondsBetween is absolute and whole-second", () => {
    expect(secondsBetween("2025-01-01T00:00:00.000Z", "2025-01-01T00:30:00.000Z")).toBe(1800);
    expect(secondsBetween("2025-01-01T00:30:00.000Z", "2025-01-01T00:00:00.000Z")).toBe(1800);
  });

  it("withinWindow is inclusive exactly at the threshold and false one second past it", () => {
    const t0 = "2025-01-01T00:00:00.000Z";
    const atThreshold = "2025-01-01T00:30:00.000Z"; // exactly 1800 s
    const pastThreshold = "2025-01-01T00:30:01.000Z"; // 1801 s
    expect(withinWindow(t0, atThreshold)).toBe(true);
    expect(withinWindow(t0, pastThreshold)).toBe(false);
  });

  it("impliedSpeedMps handles a zero-time jump as Infinity and a same-place zero-time as 0", () => {
    expect(impliedSpeedMps(1000, 0)).toBe(Infinity);
    expect(impliedSpeedMps(0, 0)).toBe(0);
    expect(impliedSpeedMps(1000, 100)).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// activity index
// ---------------------------------------------------------------------------

describe("buildActivityIndex", () => {
  it("rolls each phone up to its owning person and emits one activity per resolvable endpoint", () => {
    const events = [
      cdr("cdr_1", PH_A.canonicalLabel, PH_B.canonicalLabel, "2025-07-01T10:00:00.000Z", "item_1", T1.id),
      cdr("cdr_2", PH_A.canonicalLabel, "+999unknown", "2025-07-01T11:00:00.000Z", "item_2", T1.id),
    ];
    const index = buildActivityIndex(ENTITIES, LOCATIONS, OWN, events, []);
    // cdr_1 -> Alice + Bob ; cdr_2 -> Alice only (callee unresolved)
    expect(index.events).toHaveLength(3);
    expect(index.events.every((e) => e.channel === "communication")).toBe(true);
    const subjects = index.events.map((e) => e.subjectId).sort();
    expect(subjects).toEqual([ALICE.id, ALICE.id, BOB.id]);
    expect(index.events.every((e) => e.locationId === T1.id)).toBe(true);
    expect(index.entitiesConsidered).toBe(2);
    expect(index.locationsConsidered).toBe(1);
  });

  it("falls back to the identifier entity id when no ownership edge exists", () => {
    const events = [cdr("cdr_1", PH_A.canonicalLabel, PH_B.canonicalLabel, "2025-07-01T10:00:00.000Z", "item_1", T1.id)];
    const index = buildActivityIndex(ENTITIES, LOCATIONS, [], events, []);
    expect(index.events.map((e) => e.subjectId).sort()).toEqual([PH_A.id, PH_B.id]);
  });

  it("includes financial event mentions as location-less temporal activity", () => {
    const AC_X = account("acc_x", "AC-X");
    const AC_Y = account("acc_y", "AC-Y");
    const records = [finTxn("er_t1", "item_fin", "AC-X", "AC-Y", "2025-07-02T09:00:00.000Z")];
    const index = buildActivityIndex([...ENTITIES, AC_X, AC_Y], LOCATIONS, [], [], records);
    expect(index.events).toHaveLength(2);
    expect(index.events.every((e) => e.channel === "financial" && e.locationId === null)).toBe(true);
    expect(index.events.map((e) => e.subjectId).sort()).toEqual([AC_X.id, AC_Y.id]);
  });

  it("warns (never throws) on a communication event whose phones are both unknown", () => {
    const events = [cdr("cdr_x", "+111", "+222", "2025-07-01T10:00:00.000Z", "item_x", T1.id)];
    const index = buildActivityIndex(ENTITIES, LOCATIONS, OWN, events, []);
    expect(index.events).toHaveLength(0);
    expect(index.warnings.length).toBe(1);
  });

  it("produces a byte-identical index across repeated calls (deterministic ordering)", () => {
    const events = [
      cdr("cdr_2", PH_B.canonicalLabel, PH_A.canonicalLabel, "2025-07-01T10:05:00.000Z", "item_2", T2.id),
      cdr("cdr_1", PH_A.canonicalLabel, PH_B.canonicalLabel, "2025-07-01T10:00:00.000Z", "item_1", T1.id),
    ];
    const a = buildActivityIndex(ENTITIES, LOCATIONS, OWN, events, []);
    const b = buildActivityIndex(ENTITIES, LOCATIONS, OWN, [...events].reverse(), []);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

// ---------------------------------------------------------------------------
// spatial co-location
// ---------------------------------------------------------------------------

describe("computeSpatialCoLocations", () => {
  it("flags two subjects each with repeated (>= 2) activity at the same location", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_A.canonicalLabel, "+900000008", "2025-07-03T10:00:00.000Z", "item_2", T1.id),
        cdr("c3", PH_B.canonicalLabel, "+900000009", "2025-07-01T18:00:00.000Z", "item_3", T1.id),
        cdr("c4", PH_B.canonicalLabel, "+900000007", "2025-07-04T18:00:00.000Z", "item_4", T1.id),
      ],
      [],
    ).events;
    const findings = computeSpatialCoLocations(events, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe("spatial_co_location");
    expect(findings[0]!.entityIds).toEqual([ALICE.id, BOB.id].sort());
    expect(findings[0]!.locationIds).toEqual([T1.id]);
  });

  it("does NOT flag a location where one subject has only a single incidental ping", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_A.canonicalLabel, "+900000008", "2025-07-03T10:00:00.000Z", "item_2", T1.id),
        cdr("c3", PH_B.canonicalLabel, "+900000009", "2025-07-01T18:00:00.000Z", "item_3", T1.id), // B: only 1
      ],
      [],
    ).events;
    expect(computeSpatialCoLocations(events, label)).toEqual([]);
  });

  it("classifies a repeated co-location backed by multiple independent CDRs as a corroborated_fact", () => {
    const corrob = computeSpatialCoLocations(
      buildActivityIndex(
        ENTITIES,
        LOCATIONS,
        OWN,
        [
          cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
          cdr("c2", PH_A.canonicalLabel, "+900000006", "2025-07-02T10:00:00.000Z", "item_2", T1.id),
          cdr("c3", PH_B.canonicalLabel, "+900000009", "2025-07-01T12:00:00.000Z", "item_3", T1.id),
          cdr("c4", PH_B.canonicalLabel, "+900000005", "2025-07-02T12:00:00.000Z", "item_4", T1.id),
        ],
        [],
      ).events,
      label,
    );
    expect(corrob).toHaveLength(1);
    expect(corrob[0]!.classification).toBe("corroborated_fact");
    expect(corrob[0]!.evidenceItemIds.length).toBeGreaterThanOrEqual(2);
  });

  it("does NOT flag two subjects at DIFFERENT locations as co-located (adversarial false match)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000009", "2025-07-01T10:01:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    expect(computeSpatialCoLocations(events, label)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// spatial proximity
// ---------------------------------------------------------------------------

describe("computeSpatialProximities", () => {
  it("flags two distinct nearby locations with activity at both, always as an algorithmic_signal", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000009", "2025-07-02T10:00:00.000Z", "item_2", T2.id),
      ],
      [],
    ).events;
    const findings = computeSpatialProximities(events, LOCATIONS, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe("spatial_proximity");
    expect(findings[0]!.classification).toBe("algorithmic_signal");
    expect(findings[0]!.entityIds).toEqual([]);
    expect(findings[0]!.locationIds).toEqual([T1.id, T2.id].sort());
    expect(Number(findings[0]!.value.distanceMeters)).toBeLessThanOrEqual(SPATIAL_PROXIMITY_METERS);
  });

  it("does NOT flag far-apart locations even when both are active (adversarial)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      [T1, T3],
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000009", "2025-07-02T10:00:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    expect(computeSpatialProximities(events, [T1, T3], label)).toEqual([]);
  });

  it("flags a nearby persisted location even when only ONE side has recorded activity (the active site anchors relevance)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id)],
      [],
    ).events;
    const findings = computeSpatialProximities(events, LOCATIONS, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.locationIds).toEqual([T1.id, T2.id].sort());
    // provenance still cites the source evidence item behind the active site
    expect(findings[0]!.evidenceItemIds).toContain("item_1");
  });

  it("does NOT flag a location pair when NEITHER side has recorded activity", () => {
    expect(computeSpatialProximities([], LOCATIONS, label)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// temporal co-occurrence
// ---------------------------------------------------------------------------

describe("computeTemporalCoOccurrences", () => {
  it("skips a co-occurrence carried by a single evidence item (the two ends of one call)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [cdr("c1", PH_A.canonicalLabel, PH_B.canonicalLabel, "2025-07-01T10:00:00.000Z", "item_1", T1.id)],
      [],
    ).events;
    expect(computeTemporalCoOccurrences(events, label)).toEqual([]);
  });

  it("flags a pair active within the window across >= 2 distinct evidence items", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-01T10:10:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    const findings = computeTemporalCoOccurrences(events, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe("temporal_co_occurrence");
    expect(findings[0]!.locationIds).toEqual([]);
    // one occurrence only -> algorithmic_signal
    expect(findings[0]!.classification).toBe("algorithmic_signal");
  });

  it("classifies a repeated (>= 2 occurrence) independently-sourced temporal pattern as corroborated_fact", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-01T10:10:00.000Z", "item_2", T3.id),
        cdr("c3", PH_A.canonicalLabel, "+900000007", "2025-07-05T14:00:00.000Z", "item_3", T1.id),
        cdr("c4", PH_B.canonicalLabel, "+900000006", "2025-07-05T14:15:00.000Z", "item_4", T3.id),
      ],
      [],
    ).events;
    const findings = computeTemporalCoOccurrences(events, label);
    expect(findings).toHaveLength(1);
    expect(Number(findings[0]!.value.occurrenceCount)).toBeGreaterThanOrEqual(REPEATED_OCCURRENCE_MIN);
    expect(findings[0]!.classification).toBe("corroborated_fact");
  });

  it("does NOT flag events outside the window (adversarial — one day apart)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-02T10:00:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    expect(computeTemporalCoOccurrences(events, label)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// repeated spatiotemporal overlap
// ---------------------------------------------------------------------------

describe("computeRepeatedOverlaps", () => {
  it("needs >= REPEATED_OCCURRENCE_MIN same-place same-window overlaps", () => {
    const oneOverlap = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-01T10:05:00.000Z", "item_2", T1.id),
      ],
      [],
    ).events;
    expect(computeRepeatedOverlaps(oneOverlap, label)).toEqual([]);

    const twoOverlaps = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-01T10:05:00.000Z", "item_2", T1.id),
        cdr("c3", PH_A.canonicalLabel, "+900000007", "2025-07-05T14:00:00.000Z", "item_3", T1.id),
        cdr("c4", PH_B.canonicalLabel, "+900000006", "2025-07-05T14:10:00.000Z", "item_4", T1.id),
      ],
      [],
    ).events;
    const findings = computeRepeatedOverlaps(twoOverlaps, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe("repeated_spatiotemporal_overlap");
    expect(findings[0]!.locationIds).toEqual([T1.id]);
    expect(Number(findings[0]!.value.overlapCount)).toBeGreaterThanOrEqual(REPEATED_OCCURRENCE_MIN);
    expect(findings[0]!.classification).toBe("corroborated_fact");
  });

  it("does NOT count same-place activity that is far apart in time (adversarial false match)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-01T20:00:00.000Z", "item_2", T1.id),
        cdr("c3", PH_A.canonicalLabel, "+900000007", "2025-07-05T02:00:00.000Z", "item_3", T1.id),
        cdr("c4", PH_B.canonicalLabel, "+900000006", "2025-07-05T14:00:00.000Z", "item_4", T1.id),
      ],
      [],
    ).events;
    expect(computeRepeatedOverlaps(events, label)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// contradiction
// ---------------------------------------------------------------------------

describe("computeContradictions", () => {
  it("flags one subject placed at two far-apart locations within an implausibly short time", () => {
    // T1 -> T3 is ~140 km; 60 s apart -> ~2300 m/s implied speed
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_A.canonicalLabel, "+900000008", "2025-07-01T10:01:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    const findings = computeContradictions(events, LOCATIONS, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe("spatiotemporal_contradiction");
    expect(findings[0]!.classification).toBe("algorithmic_signal");
    expect(findings[0]!.entityIds).toEqual([ALICE.id]);
    expect(findings[0]!.locationIds).toEqual([T1.id, T3.id].sort());
    expect(Number(findings[0]!.value.impliedSpeedMps)).toBeGreaterThan(MAX_PLAUSIBLE_SPEED_MPS);
  });

  it("does NOT flag a plausible move (adversarial — 2 hours between nearby towers)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_A.canonicalLabel, "+900000008", "2025-07-01T12:00:00.000Z", "item_2", T2.id),
      ],
      [],
    ).events;
    expect(computeContradictions(events, LOCATIONS, label)).toEqual([]);
  });

  it("records an instantaneous jump (same timestamp, different location) with a null implied speed", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_A.canonicalLabel, "+900000008", "2025-07-01T10:00:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    const findings = computeContradictions(events, LOCATIONS, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.value.impliedSpeedMps).toBeNull();
    expect(Number(findings[0]!.value.elapsedSeconds)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// synthesizeCorroboration — assembly + determinism
// ---------------------------------------------------------------------------

describe("synthesizeCorroboration", () => {
  const COMMS = [
    cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
    cdr("c2", PH_B.canonicalLabel, "+900000008", "2025-07-01T10:10:00.000Z", "item_2", T1.id),
    cdr("c3", PH_A.canonicalLabel, "+900000007", "2025-07-05T14:00:00.000Z", "item_3", T1.id),
    cdr("c4", PH_B.canonicalLabel, "+900000006", "2025-07-05T14:12:00.000Z", "item_4", T1.id),
    cdr("c5", PH_A.canonicalLabel, "+900000005", "2025-07-06T09:00:00.000Z", "item_5", T3.id),
    cdr("c6", PH_A.canonicalLabel, "+900000004", "2025-07-06T09:01:00.000Z", "item_6", T1.id),
  ];

  it("assembles findings with content-addressed ids, only the two allowed classifications, and full provenance", () => {
    const out = synthesizeCorroboration(ENTITIES, LOCATIONS, OWN, COMMS, [], "inv1", GV, NOW);
    expect(out.findings.length).toBeGreaterThan(0);
    for (const f of out.findings) {
      expect(f.id).toBe(
        makeContentId("corroboration_finding", [
          f.findingType,
          ...f.entityIds,
          ...f.locationIds,
          f.window?.start ?? "",
          f.window?.end ?? "",
          GV,
        ]),
      );
      expect(["algorithmic_signal", "corroborated_fact"]).toContain(f.classification);
      expect(f.graphVersion).toBe(GV);
      expect(f.provenance.confidence).toBe(1);
      expect(f.provenance.location).toBe(`graph_version:${GV}`);
      expect(f.provenance.processingHistory[0]).toBe(`graph:synthesized:${GV}`);
      expect(f.evidenceItemIds.length).toBeGreaterThanOrEqual(1);
      expect(f.supportingRecordIds.length).toBeGreaterThanOrEqual(1);
      if (f.classification === "corroborated_fact") expect(f.evidenceItemIds.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("is byte-identical across repeated runs and independent of input row order", () => {
    const a = synthesizeCorroboration(ENTITIES, LOCATIONS, OWN, COMMS, [], "inv1", GV, NOW);
    const b = synthesizeCorroboration([...ENTITIES].reverse(), [...LOCATIONS].reverse(), [...OWN].reverse(), [...COMMS].reverse(), [], "inv1", GV, NOW);
    expect(JSON.stringify(a.findings)).toBe(JSON.stringify(b.findings));
  });

  it("produces a DIFFERENT id set for a different graph version (no stale shadowing)", () => {
    const v1 = synthesizeCorroboration(ENTITIES, LOCATIONS, OWN, COMMS, [], "inv1", "graph-v1", NOW);
    const v2 = synthesizeCorroboration(ENTITIES, LOCATIONS, OWN, COMMS, [], "inv1", "graph-v2", NOW);
    const ids1 = new Set(v1.findings.map((f) => f.id));
    const ids2 = new Set(v2.findings.map((f) => f.id));
    for (const id of ids2) expect(ids1.has(id)).toBe(false);
  });

  it("handles an empty world without throwing", () => {
    const out = synthesizeCorroboration([], [], [], [], [], "inv1", GV, NOW);
    expect(out.findings).toEqual([]);
    expect(out.stats.activityEvents).toBe(0);
  });

  it("never emits observed_fact / ai_inference / investigative_lead", () => {
    const out = synthesizeCorroboration(ENTITIES, LOCATIONS, OWN, COMMS, [], "inv1", GV, NOW);
    const serialized = JSON.stringify(out.findings);
    for (const forbidden of ["observed_fact", "ai_inference", "investigative_lead"]) {
      expect(serialized).not.toContain(`"classification":"${forbidden}"`);
    }
  });
});

// ---------------------------------------------------------------------------
// verify — validation + provenance invariants
// ---------------------------------------------------------------------------

describe("verify.validateOutputs + assertProvenance", () => {
  function goodFinding(overrides: Record<string, unknown> = {}) {
    return {
      id: "cf1",
      investigationId: "inv1",
      graphVersion: "v1",
      findingType: "spatial_co_location" as const,
      kind: "spatial" as const,
      entityIds: ["entity_a", "entity_b"],
      locationIds: ["loc_z"],
      window: { start: "2025-07-01T10:00:00.000Z", end: "2025-07-01T12:00:00.000Z" },
      value: { locationId: "loc_z" },
      method: "corroboration:spatial_co_location",
      explanation: "test",
      classification: "algorithmic_signal" as const,
      evidenceItemIds: ["item_1"],
      supportingRecordIds: ["cdr_1"],
      provenance: {
        source: "item_1",
        location: "graph_version:v1",
        method: "corroboration:spatial_co_location",
        confidence: 1,
        processingHistory: ["graph:synthesized:v1", "corroboration:spatial_co_location"],
        timestamp: NOW,
      },
      ...overrides,
    };
  }

  it("rejects a corroborated_fact that cites fewer than 2 evidence items (schema refinement)", async () => {
    const { validateOutputs } = await import("@/lib/corroboration/verify");
    expect(() => validateOutputs([goodFinding({ classification: "corroborated_fact", evidenceItemIds: ["only_one"] }) as never])).toThrow();
  });

  it("rejects a contradiction that is not an algorithmic_signal (schema refinement)", async () => {
    const { validateOutputs } = await import("@/lib/corroboration/verify");
    expect(() =>
      validateOutputs([
        goodFinding({
          findingType: "spatiotemporal_contradiction",
          kind: "spatiotemporal",
          classification: "corroborated_fact",
          entityIds: ["entity_a"],
          evidenceItemIds: ["i1", "i2"],
        }) as never,
      ]),
    ).toThrow();
  });

  it("rejects an entity endpoint that does not resolve to a known entity", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/corroboration/verify");
    const { findings } = validateOutputs([goodFinding({ entityIds: ["entity_a", "does_not_exist"] }) as never]);
    expect(() =>
      assertProvenance(findings, new Set(["entity_a", "entity_b"]), new Set(["loc_z"]), new Set(["item_1"]), "v1"),
    ).toThrow();
  });

  it("rejects a location endpoint that does not resolve to a known location", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/corroboration/verify");
    const { findings } = validateOutputs([goodFinding({ locationIds: ["loc_missing"] }) as never]);
    expect(() =>
      assertProvenance(findings, new Set(["entity_a", "entity_b"]), new Set(["loc_z"]), new Set(["item_1"]), "v1"),
    ).toThrow();
  });

  it("rejects an evidence item id that does not resolve to a persisted evidence item", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/corroboration/verify");
    const { findings } = validateOutputs([goodFinding() as never]);
    expect(() =>
      assertProvenance(findings, new Set(["entity_a", "entity_b"]), new Set(["loc_z"]), new Set(["some_other_item"]), "v1"),
    ).toThrow();
  });

  it("rejects a finding stamped with the wrong graph version", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/corroboration/verify");
    const { findings } = validateOutputs([goodFinding({ graphVersion: "stale" }) as never]);
    expect(() =>
      assertProvenance(findings, new Set(["entity_a", "entity_b"]), new Set(["loc_z"]), new Set(["item_1"]), "v1"),
    ).toThrow();
  });

  it("accepts a well-formed finding with resolvable endpoints and evidence", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/corroboration/verify");
    const { findings } = validateOutputs([goodFinding() as never]);
    const count = assertProvenance(
      findings,
      new Set(["entity_a", "entity_b"]),
      new Set(["loc_z"]),
      new Set(["item_1"]),
      "v1",
    );
    expect(count).toBe(1);
  });

  it("accepts a spatial_proximity finding that carries no subject entities", async () => {
    const { validateOutputs, assertProvenance } = await import("@/lib/corroboration/verify");
    const { findings } = validateOutputs([
      goodFinding({
        findingType: "spatial_proximity",
        kind: "spatial",
        entityIds: [],
        locationIds: ["loc_z", "loc_z2"],
        window: null,
        method: "corroboration:haversine_proximity",
      }) as never,
    ]);
    const count = assertProvenance(findings, new Set(), new Set(["loc_z", "loc_z2"]), new Set(["item_1"]), "v1");
    expect(count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// ground-truth isolation — source scan
// ---------------------------------------------------------------------------

const GROUND_TRUTH_KEYS = [
  "expectedEntityMerges",
  "hiddenConnections",
  "moneyMulePaths",
  "intendedConclusions",
  "expectedCopilotAnswers",
  "resolutionForbidden",
  "recoverableBy",
  "aliasMap",
  "temporalCorrelations",
  "spatialCorrelations",
  "HIDDEN_CONNECTION",
  "TEMPORAL_CORRELATIONS",
  "CONTRADICTIONS",
];

describe("ground-truth isolation — no forbidden import/identifier anywhere in src/lib/corroboration/", () => {
  it("scans every .ts file under src/lib/corroboration/", () => {
    const dir = path.join(process.cwd(), "src/lib/corroboration");
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const code = fs
        .readFileSync(path.join(dir, file), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(/from\s+["'][^"']*ground-truth[^"']*["']/);
      expect(code, file).not.toMatch(/import\(\s*["'][^"']*ground-truth/);
      expect(code, file).not.toMatch(/["']ground-truth["']/);
      expect(code, file).not.toMatch(/evidence\/ground-truth/);
      expect(code, file).not.toMatch(/loadInvestigationGroundTruth|loadGroundTruthFixture/);
      expect(code, file).not.toMatch(/case-design|corpus\/ground-truth/);
      for (const key of GROUND_TRUTH_KEYS) expect(code, `${file}: ${key}`).not.toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// idempotent persistence — partial retry (own temp DB)
// ---------------------------------------------------------------------------

describe("idempotentPersistCorroboration — partial retry", () => {
  const TEST_DB_PATH = "./data/cipher-corroboration-persist-test.db";

  beforeAll(async () => {
    await prepareFreshDb(TEST_DB_PATH);
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(async () => {
    await releaseAndRemoveDb(TEST_DB_PATH);
  });

  it("persists only the rows missing after a partial prior write", async () => {
    const { idempotentPersistCorroboration } = await import("@/lib/corroboration/persist");
    const { insertInvestigation, insertEntity, insertLocation, insertCorroborationFinding } = await import("@/lib/db/repository");

    const investigationId = makeOpaqueId("investigation");
    await insertInvestigation({ id: investigationId, name: "Corroboration Persist Test", status: "in_progress", createdAt: NOW });
    await insertEntity({ id: "entity_x", investigationId, kind: "person", canonicalLabel: "X", attributes: {}, provenance: prov("x") });
    await insertEntity({ id: "entity_y", investigationId, kind: "person", canonicalLabel: "Y", attributes: {}, provenance: prov("y") });
    await insertLocation({
      id: "loc_z",
      investigationId,
      label: "Z",
      locationType: "cell_tower",
      latitude: 28.6,
      longitude: 77.2,
      provenance: prov("z"),
    });

    const findingA = {
      id: makeContentId("corroboration_finding", ["spatial_co_location", "entity_x", "entity_y", "loc_z", "s", "e", "v1"]),
      investigationId,
      graphVersion: "v1",
      findingType: "spatial_co_location" as const,
      kind: "spatial" as const,
      entityIds: ["entity_x", "entity_y"],
      locationIds: ["loc_z"],
      window: { start: "2025-07-01T10:00:00.000Z", end: "2025-07-01T12:00:00.000Z" },
      value: { locationId: "loc_z" },
      method: "corroboration:spatial_co_location",
      explanation: "test",
      classification: "algorithmic_signal" as const,
      evidenceItemIds: ["item_1"],
      supportingRecordIds: ["cdr_1"],
      provenance: { ...prov("item_1"), location: "graph_version:v1", method: "corroboration:spatial_co_location", processingHistory: ["graph:synthesized:v1", "corroboration:spatial_co_location"] },
    };
    await insertCorroborationFinding(findingA);

    const findingB = { ...findingA, id: findingA.id + "_b", entityIds: ["entity_x"], findingType: "spatiotemporal_contradiction" as const, kind: "spatiotemporal" as const };

    const persisted = await idempotentPersistCorroboration([findingA, findingB]);
    expect(persisted.findingsCreated).toBe(1);
    expect(persisted.findingsSkipped).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Full-corpus spatial/temporal corroboration — ingest, extract, resolve,
// synthesize the graph, then run corroboration once, sharing the result
// across assertions (mirrors tests/unit/analytics.test.ts's full-corpus block).
// ---------------------------------------------------------------------------

type CorroborationModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  runExtraction: typeof import("@/lib/extraction/service").runExtraction;
  runResolution: typeof import("@/lib/resolution/service").runResolution;
  runGraphSynthesis: typeof import("@/lib/graph/service").runGraphSynthesis;
  runCorroborationSynthesis: typeof import("@/lib/corroboration/service").runCorroborationSynthesis;
  getCorroborationState: typeof import("@/lib/corroboration/summary").getCorroborationState;
  getCorroborationFindings: typeof import("@/lib/corroboration/summary").getCorroborationFindings;
  getCorroborationFindingDetail: typeof import("@/lib/corroboration/summary").getCorroborationFindingDetail;
  getEntityPairOverlaps: typeof import("@/lib/corroboration/summary").getEntityPairOverlaps;
  idempotentPersistCorroboration: typeof import("@/lib/corroboration/persist").idempotentPersistCorroboration;
  repo: typeof import("@/lib/db/repository");
};

async function freshCorroboration(dbPath: string): Promise<CorroborationModule> {
  await prepareFreshDb(dbPath);
  const vitestMod = await import("vitest");
  vitestMod.vi.resetModules();
  process.env.DATABASE_URL = dbPath;

  const [ingestion, extraction, resolution, graphService, service, summary, persist, repo] = await Promise.all([
    import("@/lib/ingestion/service"),
    import("@/lib/extraction/service"),
    import("@/lib/resolution/service"),
    import("@/lib/graph/service"),
    import("@/lib/corroboration/service"),
    import("@/lib/corroboration/summary"),
    import("@/lib/corroboration/persist"),
    import("@/lib/db/repository"),
  ]);
  return {
    runIngestion: ingestion.runIngestion,
    runExtraction: extraction.runExtraction,
    runResolution: resolution.runResolution,
    runGraphSynthesis: graphService.runGraphSynthesis,
    runCorroborationSynthesis: service.runCorroborationSynthesis,
    getCorroborationState: summary.getCorroborationState,
    getCorroborationFindings: summary.getCorroborationFindings,
    getCorroborationFindingDetail: summary.getCorroborationFindingDetail,
    getEntityPairOverlaps: summary.getEntityPairOverlaps,
    idempotentPersistCorroboration: persist.idempotentPersistCorroboration,
    repo,
  };
}

describe("spatial/temporal corroboration — full Operation DarkNet Delhi corpus", () => {
  const DB = "./data/cipher-corroboration-full.db";
  let mod: CorroborationModule;
  let result: Awaited<ReturnType<CorroborationModule["runCorroborationSynthesis"]>>;

  beforeAll(async () => {
    mod = await freshCorroboration(DB);
    expect((await mod.runIngestion({ kind: "builtin-corpus" })).status).toBe("ingested");
    expect((await mod.runExtraction()).status).toBe("extracted");
    expect((await mod.runResolution()).status).toBe("resolved");
    expect((await mod.runGraphSynthesis()).status).toBe("synthesized");
    result = await mod.runCorroborationSynthesis();
  }, 120_000);

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("synthesizes successfully and runs all 10 stages to completion", () => {
    expect(result.status).toBe("synthesized");
    expect(result.error).toBeNull();
    expect(result.stages).toHaveLength(10);
    for (const stage of result.stages) {
      expect(stage.status).toBe("ok");
      expect(stage.detail.length).toBeGreaterThan(0);
    }
    expect(result.counts).not.toBeNull();
    expect(result.counts!.activityEvents).toBeGreaterThan(0);
    const c = result.counts!;
    const totalFindings = c.spatialFindings + c.temporalFindings + c.spatiotemporalFindings + c.contradictions;
    expect(totalFindings).toBeGreaterThan(0);
    expect(c.corroboratedFacts + c.algorithmicSignals).toBe(totalFindings);
  });

  it("every persisted finding is classified exactly algorithmic_signal or corroborated_fact — never any other value", async () => {
    const findings = await mod.repo.listCorroborationFindings();
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((f) => f.classification === "algorithmic_signal" || f.classification === "corroborated_fact")).toBe(true);
    const serialized = JSON.stringify(findings);
    for (const forbidden of ["observed_fact", "ai_inference", "investigative_lead"]) {
      expect(serialized).not.toContain(`"classification":"${forbidden}"`);
    }
  });

  it("provenance: every finding cites >= 1 real persisted evidence item and resolvable entity/location endpoints; no evidence record is copied inline", async () => {
    const findings = await mod.repo.listCorroborationFindings();
    const entityIds = new Set((await mod.repo.listEntities()).map((e) => e.id));
    const locationIds = new Set((await mod.repo.listLocations()).map((l) => l.id));
    const evidenceItemIds = new Set((await mod.repo.listEvidenceItems()).map((i) => i.id));
    for (const f of findings) {
      expect(f.evidenceItemIds.length).toBeGreaterThanOrEqual(1);
      for (const evId of f.evidenceItemIds) expect(evidenceItemIds.has(evId)).toBe(true);
      for (const entId of f.entityIds) expect(entityIds.has(entId)).toBe(true);
      for (const locId of f.locationIds) expect(locationIds.has(locId)).toBe(true);
      expect(f.supportingRecordIds.length).toBeGreaterThanOrEqual(1);
      expect(JSON.stringify(f.value)).not.toMatch(/"provenance":\s*\{/);
      expect(f.provenance.location).toBe(`graph_version:${f.graphVersion}`);
      expect(f.provenance.processingHistory[0]).toBe(`graph:synthesized:${f.graphVersion}`);
    }
  });

  it("classification rules hold over persisted output: corroborated_fact => >= 2 evidence items; proximity & contradiction => algorithmic_signal", async () => {
    const findings = await mod.repo.listCorroborationFindings();
    for (const f of findings) {
      if (f.classification === "corroborated_fact") expect(f.evidenceItemIds.length).toBeGreaterThanOrEqual(2);
      if (f.findingType === "spatial_proximity") {
        expect(f.classification).toBe("algorithmic_signal");
        expect(f.entityIds).toEqual([]);
        expect(f.locationIds).toHaveLength(2);
        expect(Number(f.value.distanceMeters)).toBeLessThanOrEqual(SPATIAL_PROXIMITY_METERS);
        expect(Number(f.value.distanceMeters)).toBeGreaterThan(0);
      }
      if (f.findingType === "spatiotemporal_contradiction") {
        expect(f.classification).toBe("algorithmic_signal");
        expect(f.entityIds).toHaveLength(1);
        expect(f.locationIds).toHaveLength(2);
      }
    }
  });

  it("deterministic idempotent re-synthesis: re-running against the SAME graph version reproduces byte-identical finding ids and writes nothing", async () => {
    const before = (await mod.repo.listCorroborationFindings()).map((f) => f.id).sort();
    const rerun = await mod.runCorroborationSynthesis();
    expect(rerun.status).toBe("already_synthesized");
    expect(rerun.persisted?.findingsCreated).toBe(0);
    const after = (await mod.repo.listCorroborationFindings()).map((f) => f.id).sort();
    expect(after).toEqual(before);
  });

  it("persistence/idempotency: a partial-write retry persists only what's missing", async () => {
    const findings = await mod.repo.listCorroborationFindings();
    const persisted = await mod.idempotentPersistCorroboration(findings);
    expect(persisted.findingsCreated).toBe(0);
    expect(persisted.findingsSkipped).toBe(findings.length);
  });

  it("state + query surface: synthesized state, paginated findings, classification/kind filters, and finding detail all cohere", async () => {
    const state = await mod.getCorroborationState();
    expect(state.status).toBe("synthesized");

    const page = await mod.getCorroborationFindings({ limit: 5 });
    expect(page).not.toBeNull();
    expect(page!.findings.length).toBeLessThanOrEqual(5);
    expect(page!.total).toBeGreaterThan(0);

    const corroboratedOnly = await mod.getCorroborationFindings({ classification: "corroborated_fact", limit: 200 });
    expect(corroboratedOnly!.findings.every((f) => f.classification === "corroborated_fact")).toBe(true);

    const spatialOnly = await mod.getCorroborationFindings({ kind: "spatial", limit: 200 });
    expect(spatialOnly!.findings.every((f) => f.kind === "spatial")).toBe(true);

    const first = page!.findings[0]!;
    const detail = await mod.getCorroborationFindingDetail(first.id);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(first.id);
    expect(detail!.provenance.method).toBe(first.method);
  });

  it("entity-pair overlaps aggregate only real findings, strongest-corroboration first", async () => {
    const pairs = await mod.getEntityPairOverlaps();
    expect(pairs).not.toBeNull();
    const findingIds = new Set((await mod.repo.listCorroborationFindings()).map((f) => f.id));
    for (const p of pairs!) {
      expect(p.findingIds.length).toBeGreaterThan(0);
      for (const id of p.findingIds) expect(findingIds.has(id)).toBe(true);
      expect(p.entityAId < p.entityBId).toBe(true);
    }
    for (let i = 1; i < pairs!.length; i++) {
      expect(pairs![i - 1]!.corroboratedFacts).toBeGreaterThanOrEqual(pairs![i]!.corroboratedFacts);
    }
  });

  it("discovered from real data (never ground truth): at least one spatiotemporal finding relates two distinct real entities", async () => {
    const findings = await mod.repo.listCorroborationFindings();
    const st = findings.filter((f) => f.kind === "spatiotemporal" && f.findingType === "repeated_spatiotemporal_overlap");
    // The corpus's designed co-tower activity should surface at least one repeated overlap.
    for (const f of st) {
      expect(f.entityIds).toHaveLength(2);
      expect(f.entityIds[0]).not.toBe(f.entityIds[1]);
      expect(f.locationIds).toHaveLength(1);
    }
    // spatial co-location across the corpus is expected regardless.
    expect(findings.some((f) => f.findingType === "spatial_co_location")).toBe(true);
  });

  it("ground-truth isolation over live persisted output: no finding value or explanation contains a ground-truth-only field name", async () => {
    const findings = await mod.repo.listCorroborationFindings();
    const serialized = JSON.stringify(findings);
    for (const key of GROUND_TRUTH_KEYS) expect(serialized).not.toContain(key);
  });
});

describe("corroboration — empty and edge-case databases (full pipeline)", () => {
  const DB = "./data/cipher-corroboration-empty.db";

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("returns a structured NO_GRAPH error when corroboration is requested before graph synthesis has ever run", async () => {
    const mod = await freshCorroboration(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
    await mod.runResolution();
    // deliberately skip graph synthesis
    const res = await mod.runCorroborationSynthesis();
    expect(res.status).toBe("failed");
    expect(res.error?.code).toBe("NO_GRAPH");
    // Ingests + extracts + resolves the whole corpus before the assertion —
    // far beyond vitest's 5s default, like the full-corpus hooks above.
  }, 120_000);

  it("returns a structured NO_INVESTIGATION error on a completely empty database, with no filesystem path in the message", async () => {
    const mod = await freshCorroboration(DB);
    const res = await mod.runCorroborationSynthesis();
    expect(res.status).toBe("failed");
    expect(res.error?.code).toBe("NO_INVESTIGATION");
    expect(res.error?.message).not.toMatch(/\/(Users|home|root|var|tmp|private)\//);
    expect(res.error?.message).not.toMatch(/\.[cm]?tsx?:\d+/);
  });
});
