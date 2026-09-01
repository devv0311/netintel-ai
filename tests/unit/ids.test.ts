import { describe, expect, it } from "vitest";

import { makeContentId, makeOpaqueId, isIdOfKind } from "@/lib/domain/ids";

describe("makeContentId", () => {
  it("is deterministic — the same canonical input always yields the same ID", () => {
    const id1 = makeContentId("entity", ["person", "Fixture Suspect A"]);
    const id2 = makeContentId("entity", ["person", "Fixture Suspect A"]);
    expect(id1).toBe(id2);
  });

  it("is case- and whitespace-insensitive on canonical parts (same real-world identity)", () => {
    const id1 = makeContentId("entity", ["person", "Fixture Suspect A"]);
    const id2 = makeContentId("entity", ["person", "  fixture suspect a  "]);
    expect(id1).toBe(id2);
  });

  it("differs for genuinely different canonical input — enables duplicate detection by equality, not collision", () => {
    const id1 = makeContentId("entity", ["person", "Fixture Suspect A"]);
    const id2 = makeContentId("entity", ["person", "Fixture Suspect B"]);
    expect(id1).not.toBe(id2);
  });

  it("differs across kinds even with identical parts, preventing cross-kind ID collisions", () => {
    const entityId = makeContentId("entity", ["Fixture Suspect A"]);
    const aliasId = makeContentId("alias", ["Fixture Suspect A"]);
    expect(entityId).not.toBe(aliasId);
  });

  it("is prefixed with its kind, verifiable via isIdOfKind", () => {
    const id = makeContentId("entity", ["person", "Fixture Suspect A"]);
    expect(isIdOfKind(id, "entity")).toBe(true);
    expect(isIdOfKind(id, "alias")).toBe(false);
  });

  it("supports duplicate-processing detection: re-deriving an ID for the same input matches an existing record's ID", () => {
    // Simulates re-ingesting the same evidence twice: the second
    // derivation must equal the first, so an insert layer can detect
    // the collision (e.g. a primary-key conflict) instead of creating
    // a second, duplicate row.
    const seenIds = new Set<string>();
    const firstIngest = makeContentId("evidence_item", ["fir", "FIR-001", "batch-1"]);
    seenIds.add(firstIngest);

    const reIngest = makeContentId("evidence_item", ["fir", "FIR-001", "batch-1"]);
    expect(seenIds.has(reIngest)).toBe(true);
  });
});

describe("makeOpaqueId", () => {
  it("produces a unique ID on every call", () => {
    const id1 = makeOpaqueId("investigation");
    const id2 = makeOpaqueId("investigation");
    expect(id1).not.toBe(id2);
  });

  it("is prefixed with its kind", () => {
    const id = makeOpaqueId("investigation");
    expect(isIdOfKind(id, "investigation")).toBe(true);
  });
});
