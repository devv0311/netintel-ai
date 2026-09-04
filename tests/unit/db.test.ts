import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

import {
  insertInvestigation,
  insertEntity,
  listEntities,
  insertRelationship,
  listRelationships,
  listRelationshipsForEntity,
} from "@/lib/db/repository";
import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
import type { Provenance } from "@/lib/domain/provenance";

import { prepareFreshDb, releaseAndRemoveDb } from "./helpers/db";

const TEST_DB_PATH = "./data/cipher-test.db";

function freshProvenance(overrides: Partial<Provenance> = {}): Provenance {
  return {
    source: "fixture:foundation-smoke",
    location: "record[0]",
    method: "fixture-loader",
    confidence: 0.9,
    processingHistory: ["loaded-from-fixture"],
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe("database foundation", () => {
  beforeAll(async () => {
    await prepareFreshDb(TEST_DB_PATH);
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(async () => {
    await releaseAndRemoveDb(TEST_DB_PATH);
  });

  it("migrates an empty database without an external service", () => {
    let db: ReturnType<typeof drizzle> | undefined;
    expect(() => {
      db = drizzle({ connection: { path: TEST_DB_PATH } });
      migrate(db, { migrationsFolder: "./drizzle" });
    }).not.toThrow();
    // These two tests open their connections directly rather than through
    // getDb(), so closeAllDbConnections() cannot reach them — close here,
    // or the handle keeps the file open and teardown's removal fails on
    // Windows.
    db?.$client.close();
  });

  it("applies migrations deterministically — re-running against an already-migrated database is a safe no-op", () => {
    // Second, independent connection to the same already-migrated file.
    let db: ReturnType<typeof drizzle> | undefined;
    expect(() => {
      db = drizzle({ connection: { path: TEST_DB_PATH } });
      migrate(db, { migrationsFolder: "./drizzle" });
    }).not.toThrow();
    db?.$client.close();
  });

  it("inserts and selects a record, with provenance surviving the round trip", async () => {
    const investigationId = makeOpaqueId("investigation");
    await insertInvestigation({
      id: investigationId,
      name: "Foundation Smoke Test",
      status: "in_progress",
      createdAt: new Date().toISOString(),
    });

    const provenance = freshProvenance();
    const entityId = makeContentId("entity", ["person", "Fixture Suspect A"]);
    await insertEntity({
      id: entityId,
      investigationId,
      kind: "person",
      canonicalLabel: "Fixture Suspect A",
      attributes: { note: "clearly fictional, foundation test only" },
      provenance,
    });

    const entities = await listEntities();
    const roundTripped = entities.find((e) => e.id === entityId);

    expect(roundTripped).toBeDefined();
    expect(roundTripped?.provenance).toEqual(provenance);
    expect(roundTripped?.canonicalLabel).toBe("Fixture Suspect A");
  });

  it("rejects an invalid record rather than silently persisting it", async () => {
    await expect(
      insertEntity({
        id: makeOpaqueId("entity"),
        investigationId: makeOpaqueId("investigation"),
        kind: "not_a_real_kind", // invalid — must fail EntityKindSchema
        canonicalLabel: "Should Not Persist",
        attributes: {},
        provenance: freshProvenance(),
      }),
    ).rejects.toThrow(/insertEntity/);

    const entities = await listEntities();
    expect(entities.some((e) => e.canonicalLabel === "Should Not Persist")).toBe(false);
  });

  it("round-trips a Relationship with attributes/conflicts/evidenceItemIds/extractedRecordIds intact", async () => {
    const investigationId = makeOpaqueId("investigation");
    await insertInvestigation({
      id: investigationId,
      name: "Relationship Round-Trip Test",
      status: "in_progress",
      createdAt: new Date().toISOString(),
    });
    const sourceId = makeContentId("entity", ["person", "Fixture Source"]);
    const targetId = makeContentId("entity", ["phone", "+91-000-000"]);
    await insertEntity({
      id: sourceId,
      investigationId,
      kind: "person",
      canonicalLabel: "Fixture Source",
      attributes: {},
      provenance: freshProvenance(),
    });
    await insertEntity({
      id: targetId,
      investigationId,
      kind: "phone",
      canonicalLabel: "+91-000-000",
      attributes: {},
      provenance: freshProvenance(),
    });

    const relationshipId = makeContentId("relationship", ["ownership", sourceId, targetId]);
    await insertRelationship({
      id: relationshipId,
      investigationId,
      sourceEntityId: sourceId,
      targetEntityId: targetId,
      relationshipType: "ownership",
      directed: true,
      evidenceItemIds: ["item_1", "item_2"],
      extractedRecordIds: ["extracted_record_1"],
      conflicts: ["example conflict"],
      attributes: { eventCount: 2 },
      classification: "corroborated_fact",
      provenance: freshProvenance(),
    });

    const all = await listRelationships();
    const roundTripped = all.find((r) => r.id === relationshipId);
    expect(roundTripped).toBeDefined();
    expect(roundTripped?.directed).toBe(true);
    expect(roundTripped?.evidenceItemIds).toEqual(["item_1", "item_2"]);
    expect(roundTripped?.extractedRecordIds).toEqual(["extracted_record_1"]);
    expect(roundTripped?.conflicts).toEqual(["example conflict"]);
    expect(roundTripped?.attributes).toEqual({ eventCount: 2 });

    const forEntity = await listRelationshipsForEntity(sourceId);
    expect(forEntity.some((r) => r.id === relationshipId)).toBe(true);
  });

  it("rejects a record with a malformed provenance confidence value", async () => {
    await expect(
      insertEntity({
        id: makeOpaqueId("entity"),
        investigationId: makeOpaqueId("investigation"),
        kind: "person",
        canonicalLabel: "Bad Confidence",
        attributes: {},
        provenance: freshProvenance({ confidence: 1.5 }), // out of [0,1] range
      }),
    ).rejects.toThrow();
  });
});
