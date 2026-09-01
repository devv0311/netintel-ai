import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

import {
  insertInvestigation,
  insertEntity,
  listEntities,
} from "@/lib/db/repository";
import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
import type { Provenance } from "@/lib/domain/provenance";

const TEST_DB_PATH = "./data/netintel-test.db";

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
  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    fs.rmSync(TEST_DB_PATH, { force: true });
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
  });

  it("migrates an empty database without an external service", () => {
    expect(() => {
      const db = drizzle({ connection: { path: TEST_DB_PATH } });
      migrate(db, { migrationsFolder: "./drizzle" });
    }).not.toThrow();
  });

  it("applies migrations deterministically — re-running against an already-migrated database is a safe no-op", () => {
    // Second, independent connection to the same already-migrated file.
    expect(() => {
      const db = drizzle({ connection: { path: TEST_DB_PATH } });
      migrate(db, { migrationsFolder: "./drizzle" });
    }).not.toThrow();
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
