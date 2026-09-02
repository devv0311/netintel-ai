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

  it("is true just inside the threshold and false just outside", () => {
    const base = { latitude: 28.6, longitude: 77.2 };
    // ~111 m away — well inside 500 m
    expect(isNearby(base, { latitude: 28.601, longitude: 77.2 })).toBe(true);
    // ~1112 m away — outside 500 m
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
  it("flags two subjects with activity at the same location", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000009", "2025-07-01T18:00:00.000Z", "item_2", T1.id),
      ],
      [],
    ).events;
    const findings = computeSpatialCoLocations(events, label);
    expect(findings).toHaveLength(1);
    expect(findings[0]!.findingType).toBe("spatial_co_location");
    expect(findings[0]!.entityIds).toEqual([ALICE.id, BOB.id].sort());
    expect(findings[0]!.locationIds).toEqual([T1.id]);
  });

  it("classifies as corroborated_fact only when >= 2 distinct evidence items place the pair there", () => {
    // one shared CDR names both A and B at T1 -> single evidence item -> algorithmic_signal
    const single = computeSpatialCoLocations(
      buildActivityIndex(ENTITIES, LOCATIONS, OWN, [cdr("c1", PH_A.canonicalLabel, PH_B.canonicalLabel, "2025-07-01T10:00:00.000Z", "item_1", T1.id)], []).events,
      label,
    );
    expect(single).toHaveLength(1);
    expect(single[0]!.classification).toBe("algorithmic_signal");
    expect(single[0]!.evidenceItemIds).toHaveLength(1);

    // two independent CDRs (different evidence items) -> corroborated_fact
    const corrob = computeSpatialCoLocations(
      buildActivityIndex(
        ENTITIES,
        LOCATIONS,
        OWN,
        [
          cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
          cdr("c2", PH_B.canonicalLabel, "+900000009", "2025-07-01T12:00:00.000Z", "item_2", T1.id),
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

  it("does NOT flag far-apart locations (adversarial)", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [
        cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id),
        cdr("c2", PH_B.canonicalLabel, "+900000009", "2025-07-02T10:00:00.000Z", "item_2", T3.id),
      ],
      [],
    ).events;
    expect(computeSpatialProximities(events, LOCATIONS, label)).toEqual([]);
  });

  it("requires activity at BOTH locations", () => {
    const events = buildActivityIndex(
      ENTITIES,
      LOCATIONS,
      OWN,
      [cdr("c1", PH_A.canonicalLabel, "+900000009", "2025-07-01T10:00:00.000Z", "item_1", T1.id)],
      [],
    ).events;
    expect(computeSpatialProximities(events, LOCATIONS, label)).toEqual([]);
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
  const TEST_DB_PATH = "./data/netintel-corroboration-persist-test.db";

  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(TEST_DB_PATH + s, { force: true });
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(TEST_DB_PATH + s, { force: true });
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
