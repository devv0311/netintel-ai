import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { loadSyntheticFixture } from "@/lib/fixtures/synthetic-loader";
import { loadGroundTruthFixture } from "@/lib/fixtures/ground-truth-loader";
import {
  insertInvestigation,
  insertEvidenceSource,
  insertEvidenceItem,
  insertEntity,
  insertAlias,
  insertRelationship,
  listAliasesForEntity,
} from "@/lib/db/repository";

const TEST_DB_PATH = "./data/netintel-fixtures-test.db";

describe("synthetic fixture loader", () => {
  it("loads and validates the foundation-smoke fixture deterministically", () => {
    const loaded = loadSyntheticFixture("foundation-smoke");

    expect(loaded.entities).toHaveLength(2);
    expect(loaded.evidenceItems).toHaveLength(3);
    expect(loaded.aliases).toHaveLength(1);
    expect(loaded.relationships).toHaveLength(1);
    expect(loaded.investigation.name).toContain("not a real investigation");
  });

  it("assigns stable, content-addressed IDs across repeated loads (excluding the investigation, which is opaque per load)", () => {
    const first = loadSyntheticFixture("foundation-smoke");
    const second = loadSyntheticFixture("foundation-smoke");

    expect(first.entities.map((e) => e.id)).toEqual(second.entities.map((e) => e.id));
    expect(first.aliases.map((a) => a.id)).toEqual(second.aliases.map((a) => a.id));
    expect(first.relationships.map((r) => r.id)).toEqual(second.relationships.map((r) => r.id));
    // The investigation ID is intentionally opaque (see src/lib/domain/ids.ts) —
    // each load starts a new investigation, so these must differ.
    expect(first.investigation.id).not.toBe(second.investigation.id);
  });

  it("throws rather than silently loading a nonexistent fixture", () => {
    expect(() => loadSyntheticFixture("does-not-exist")).toThrow();
  });
});

describe("ground-truth fixture loader and isolation", () => {
  it("loads and validates the matching ground-truth fixture", () => {
    const groundTruth = loadGroundTruthFixture("foundation-smoke");

    expect(groundTruth.expectedEntityMerges).toHaveLength(2);
    const suspectA = groundTruth.expectedEntityMerges.find(
      (m) => m.canonicalLabel === "Fixture Suspect A",
    );
    expect(suspectA?.aliases).toEqual(["The Ghost"]);
  });

  /**
   * Strips /* block *\/ and // line comments so the isolation check
   * below only looks at actual code (imports, path construction), not
   * documentation prose that legitimately discusses the boundary.
   */
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
  }

  it("the synthetic loader's code never references evidence/ground-truth (only its doc comment does, to explain the boundary)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/fixtures/synthetic-loader.ts"),
      "utf-8",
    );
    expect(stripComments(source)).not.toMatch(/ground-truth/);
  });

  it("the database repository layer never references evidence/ground-truth or the ground-truth loader, in code or comments", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/db/repository.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/ground-truth/);
  });
});

describe("fixture -> database round trip", () => {
  beforeAll(() => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    fs.rmSync(TEST_DB_PATH, { force: true });
    process.env.DATABASE_URL = TEST_DB_PATH;
  });

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
  });

  it("persists an entire loaded fixture through the validated repository layer", async () => {
    const loaded = loadSyntheticFixture("foundation-smoke");

    await insertInvestigation(loaded.investigation);
    await insertEvidenceSource(loaded.evidenceSource);
    for (const item of loaded.evidenceItems) await insertEvidenceItem(item);
    for (const entity of loaded.entities) await insertEntity(entity);
    for (const alias of loaded.aliases) await insertAlias(alias);
    for (const relationship of loaded.relationships) await insertRelationship(relationship);

    const suspectA = loaded.entities.find((e) => e.canonicalLabel === "Fixture Suspect A");
    const persistedAliases = await listAliasesForEntity(suspectA!.id);

    expect(persistedAliases).toHaveLength(1);
    expect(persistedAliases[0]?.aliasValue).toBe("The Ghost");
    expect(persistedAliases[0]?.provenance.source).toBe("fixture:foundation-smoke");
  });
});
