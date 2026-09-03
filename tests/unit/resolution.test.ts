import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { makeContentId } from "@/lib/domain/ids";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Entity } from "@/lib/domain/entity";
import type { ResolutionDecision } from "@/lib/domain/resolution";

import { prepareFreshDb, releaseAndRemoveDb } from "./helpers/db";

/**
 * Deterministic entity-resolution tests. No Anthropic call, no Docker,
 * no external service — a local SQLite file reached only through
 * ingestion + extraction (resolution never reads a file directly).
 * Same isolated-database-per-block pattern as
 * tests/unit/extraction.test.ts.
 */

type ResolutionModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  runExtraction: typeof import("@/lib/extraction/service").runExtraction;
  runResolution: typeof import("@/lib/resolution/service").runResolution;
  getResolutionState: typeof import("@/lib/resolution/summary").getResolutionState;
  getResolvedEntitiesPage: typeof import("@/lib/resolution/summary").getResolvedEntitiesPage;
  getEntityDetail: typeof import("@/lib/resolution/summary").getEntityDetail;
  idempotentPersistResolution: typeof import("@/lib/resolution/persist").idempotentPersistResolution;
  resolveEntities: typeof import("@/lib/resolution/resolve").resolveEntities;
  validateOutputs: typeof import("@/lib/resolution/verify").validateOutputs;
  assertProvenance: typeof import("@/lib/resolution/verify").assertProvenance;
  repo: typeof import("@/lib/db/repository");
};

async function freshResolution(dbPath: string): Promise<ResolutionModule> {
  await prepareFreshDb(dbPath);
  vi.resetModules();
  process.env.DATABASE_URL = dbPath;

  const [ingestion, extraction, resolution, summary, persist, resolve, verify, repo] =
    await Promise.all([
      import("@/lib/ingestion/service"),
      import("@/lib/extraction/service"),
      import("@/lib/resolution/service"),
      import("@/lib/resolution/summary"),
      import("@/lib/resolution/persist"),
      import("@/lib/resolution/resolve"),
      import("@/lib/resolution/verify"),
      import("@/lib/db/repository"),
    ]);
  return {
    runIngestion: ingestion.runIngestion,
    runExtraction: extraction.runExtraction,
    runResolution: resolution.runResolution,
    getResolutionState: summary.getResolutionState,
    getResolvedEntitiesPage: summary.getResolvedEntitiesPage,
    getEntityDetail: summary.getEntityDetail,
    idempotentPersistResolution: persist.idempotentPersistResolution,
    resolveEntities: resolve.resolveEntities,
    validateOutputs: verify.validateOutputs,
    assertProvenance: verify.assertProvenance,
    repo,
  };
}

const GROUND_TRUTH_KEYS = [
  "expectedEntityMerges",
  "hiddenConnections",
  "moneyMulePaths",
  "intendedConclusions",
  "expectedCopilotAnswers",
  "resolutionForbidden",
  "recoverableBy",
  "aliasMap",
];

function isUserSafeMessage(message: string): boolean {
  return (
    !/\/(Users|home|root|var|tmp|private)\//.test(message) &&
    !/\.[cm]?tsx?:\d+/.test(message) &&
    !/\n\s+at\s+/.test(message) &&
    !message.includes("ZodError") &&
    !message.includes("node:sqlite")
  );
}

/** Builds a minimal, schema-valid ExtractedRecord fixture for adversarial resolve() tests. */
function fixtureRecord(opts: {
  evidenceItemId: string;
  recordType: ExtractedRecord["recordType"];
  data: Record<string, unknown>;
  fieldPath: string;
}): ExtractedRecord {
  return {
    id: makeContentId("extracted_record", [opts.evidenceItemId, opts.fieldPath]),
    evidenceItemId: opts.evidenceItemId,
    recordType: opts.recordType,
    data: opts.data,
    classification: "observed_fact",
    provenance: {
      source: opts.evidenceItemId,
      location: `fixture:${opts.evidenceItemId}#${opts.fieldPath}`,
      method: "extraction:field-read:fixture",
      confidence: 1,
      processingHistory: [`evidence_item:${opts.evidenceItemId}`, "extraction:fixture"],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  };
}

// ---------------------------------------------------------------------------
// Block A — valid resolution over the full corpus
// ---------------------------------------------------------------------------

describe("entity resolution — valid corpus", () => {
  const DB = "./data/netintel-resolve-A.db";
  let mod: ResolutionModule;
  let first: Awaited<ReturnType<ResolutionModule["runResolution"]>>;

  beforeAll(async () => {
    mod = await freshResolution(DB);
    expect((await mod.runIngestion({ kind: "builtin-corpus" })).status).toBe("ingested");
    expect((await mod.runExtraction()).status).toBe("extracted");
    first = await mod.runResolution();
  }, 120_000);

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("resolves successfully and runs all 8 stages to completion with real detail", () => {
    expect(first.status).toBe("resolved");
    expect(first.error).toBeNull();
    expect(first.stages).toHaveLength(8);
    for (const stage of first.stages) {
      expect(stage.status).toBe("ok");
      expect(stage.detail.length).toBeGreaterThan(0);
    }
  });

  it("canonicalizes an entity per distinct identifier value and per distinct person cluster", () => {
    const byKind = first.counts?.entitiesByKind ?? {};
    expect(byKind.phone).toBe(14);
    expect(byKind.imei).toBe(14);
    expect(byKind.vehicle).toBe(4);
    expect(byKind.bank_account).toBe(12);
    // 8 canonical suspects + Rahul Mehta (communication intermediary) +
    // the "W6" self-referential witness placeholder (a corpus artifact,
    // not a real second identity — resolution correctly does not invent
    // structure the source never stated).
    // 17, not 10: extraction now emits a person entity_mention from every
    // field that NAMES a person (a phone's subscriber, an account's holder,
    // a vehicle's registrant, an alias's primary name), so people who never
    // had a suspect_record of their own — the money mules above all — now
    // exist. See src/lib/extraction/extract.ts personMention().
    expect(byKind.person).toBe(17);
  });

  it("produces zero ambiguous decisions over the real corpus (no genuine identifier-anchored name collision exists)", () => {
    expect(first.counts?.ambiguousDecisions).toBe(0);
    expect(first.warnings).toEqual([]);
  });

  it("every resolution decision is classified exactly ai_inference — never observed_fact, corroborated_fact, algorithmic_signal, or investigative_lead", async () => {
    const decisions = await mod.repo.listResolutionDecisions();
    expect(decisions.length).toBeGreaterThan(0);
    expect(decisions.every((d) => d.classification === "ai_inference")).toBe(true);
    const serialized = JSON.stringify(decisions);
    for (const forbidden of ["observed_fact", "corroborated_fact", "algorithmic_signal", "investigative_lead"]) {
      expect(serialized).not.toContain(`"classification":"${forbidden}"`);
    }
  });

  it("confidence is separate from classification and never inflated by mention volume", async () => {
    const decisions = await mod.repo.listResolutionDecisions();
    for (const d of decisions) {
      expect(d.provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(d.provenance.confidence).toBeLessThanOrEqual(1);
    }
    // A shared-identifier merge across many mentions still carries the
    // SAME confidence as a merge across two — volume does not inflate it.
    const sharedMerges = decisions.filter((d) => d.resolutionType === "shared_identifier_merge");
    const distinctConfidences = new Set(sharedMerges.map((d) => d.provenance.confidence));
    expect(distinctConfidences.size).toBe(1);
  });

  it("preserves complete provenance tracing every decision to a real extracted record, appending to its processing history", async () => {
    const extractedIds = new Set((await mod.repo.listExtractedRecords()).map((r) => r.id));
    const decisions = await mod.repo.listResolutionDecisions();
    for (const d of decisions.slice(0, 100)) {
      expect(d.extractedRecordIds.length).toBeGreaterThan(0);
      for (const recId of d.extractedRecordIds) expect(extractedIds.has(recId)).toBe(true);
      expect(d.provenance.source).toBe(d.extractedRecordIds[0]);
      expect(d.provenance.processingHistory.length).toBeGreaterThanOrEqual(3); // evidence_item -> extraction -> resolution
      expect(d.provenance.processingHistory[d.provenance.processingHistory.length - 1]).toMatch(/^resolution:/);
      expect(d.provenance.method).toMatch(/^resolution:/);
    }
  });

  it("every alias and entity resolves to a real, currently-persisted entity", async () => {
    const entities = await mod.repo.listEntities();
    const entityIds = new Set(entities.map((e) => e.id));
    const aliases = await mod.repo.listAliases();
    for (const a of aliases) expect(entityIds.has(a.entityId)).toBe(true);
    const decisions = await mod.repo.listResolutionDecisions();
    for (const d of decisions) expect(entityIds.has(d.canonicalEntityId)).toBe(true);
  });

  it("assigns deterministic content-addressed ids for entities, aliases, and decisions", async () => {
    const entities = await mod.repo.listEntities();
    const kabir = entities.find((e) => e.canonicalLabel === "Kabir Sharma");
    expect(kabir).toBeDefined();
    // Recomputing resolution from the same extracted records yields the identical entity id.
    const records = await mod.repo.listExtractedRecords();
    const output = mod.resolveEntities(records, "investigation_whatever", "2099-01-01T00:00:00.000Z");
    const kabirAgain = output.entities.find((e) => e.canonicalLabel === "Kabir Sharma");
    expect(kabirAgain?.id).toBe(kabir!.id); // stable across investigationId/timestamp — id depends only on evidence content
  });

  it("exposes the correct resolution state and a representative, paginated entities view", async () => {
    const state = await mod.getResolutionState();
    expect(state.status).toBe("resolved");
    if (state.status !== "resolved") return;
    expect(state.summary.totalEntities).toBe(61);
    expect(state.summary.totalAliases).toBeGreaterThan(0);

    const page = await mod.getResolvedEntitiesPage(0, 10);
    expect(page.entities).toHaveLength(10);
    expect(page.total).toBe(61);
    for (const e of page.entities) {
      expect(e.confidence).toBeGreaterThanOrEqual(0);
      expect(e.confidence).toBeLessThanOrEqual(1);
    }

    const kabir = page.entities.find((e) => e.canonicalLabel === "Kabir Sharma") ?? (await mod.getResolvedEntitiesPage(0, 54)).entities.find((e) => e.canonicalLabel === "Kabir Sharma");
    expect(kabir).toBeDefined();
    const detail = await mod.getEntityDetail(kabir!.id);
    expect(detail).not.toBeNull();
    expect(detail!.decisions.length).toBeGreaterThan(1);
    for (const d of detail!.decisions) {
      expect(d.classification).toBe("ai_inference");
      expect(d.extractedRecordIds.length).toBeGreaterThan(0);
    }
  });

  it("resolution state exposes no ground-truth / expected-answer content", async () => {
    const state = await mod.getResolutionState();
    const blob = JSON.stringify(state);
    for (const key of GROUND_TRUTH_KEYS) expect(blob.includes(key)).toBe(false);
    const page = await mod.getResolvedEntitiesPage(0, 54);
    const pageBlob = JSON.stringify(page);
    for (const key of GROUND_TRUTH_KEYS) expect(pageBlob.includes(key)).toBe(false);
  });

  it("repeated resolution is idempotent — no duplicate authoritative rows are created", async () => {
    const beforeEntities = await mod.repo.listEntities();
    const beforeAliases = await mod.repo.listAliases();
    const beforeDecisions = await mod.repo.listResolutionDecisions();

    const second = await mod.runResolution();
    expect(second.status).toBe("already_resolved");
    expect(second.persisted).toEqual({
      entitiesCreated: 0,
      entitiesSkipped: beforeEntities.length,
      aliasesCreated: 0,
      aliasesSkipped: beforeAliases.length,
      decisionsCreated: 0,
      decisionsSkipped: beforeDecisions.length,
    });

    const afterEntities = await mod.repo.listEntities();
    expect(afterEntities.length).toBe(beforeEntities.length);

    const third = await mod.runResolution();
    expect(third.status).toBe("already_resolved");
  });
});

// ---------------------------------------------------------------------------
// Block B — partial-failure retry
// ---------------------------------------------------------------------------

describe("entity resolution — partial retry", () => {
  const DB = "./data/netintel-resolve-B.db";
  let mod: ResolutionModule;

  beforeAll(async () => {
    mod = await freshResolution(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
  }, 90_000);
  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("a retry after a partial write persists only what is still missing", async () => {
    const [investigation] = await mod.repo.listInvestigations();
    const records = await mod.repo.listExtractedRecords();
    const resolvedAt = "2026-01-01T00:00:00.000Z";
    const output = mod.resolveEntities(records, investigation!.id, resolvedAt);
    const validated = mod.validateOutputs(output.entities, output.aliases, output.decisions);

    // Simulate a prior partial run: only the first half of entities made it to disk.
    const half = Math.floor(validated.entities.length / 2);
    const firstPass = await mod.idempotentPersistResolution(
      validated.entities.slice(0, half),
      [],
      [],
    );
    expect(firstPass.entitiesCreated).toBe(half);

    const retry = await mod.idempotentPersistResolution(validated.entities, validated.aliases, validated.decisions);
    expect(retry.entitiesCreated).toBe(validated.entities.length - half);
    expect(retry.entitiesSkipped).toBe(half);
    expect(retry.aliasesCreated).toBe(validated.aliases.length);
    expect(retry.decisionsCreated).toBe(validated.decisions.length);

    const stored = await mod.repo.listEntities();
    expect(stored.length).toBe(validated.entities.length);
  });
});

// ---------------------------------------------------------------------------
// Block C — structured errors
// ---------------------------------------------------------------------------

describe("entity resolution — structured errors", () => {
  const DB = "./data/netintel-resolve-C.db";
  let mod: ResolutionModule;

  beforeAll(async () => {
    mod = await freshResolution(DB);
  });
  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("rejects resolution with no investigation loaded as NO_INVESTIGATION, safely and without throwing", async () => {
    const result = await mod.runResolution();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_INVESTIGATION");
    expect(result.error?.stage).toBe("select_records");
    expect(isUserSafeMessage(result.error!.message)).toBe(true);
    expect(await mod.repo.listEntities()).toHaveLength(0);
  });

  it("rejects resolution before extraction has run as NO_EXTRACTED_RECORDS", async () => {
    await mod.runIngestion({ kind: "builtin-corpus" });
    const result = await mod.runResolution();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_EXTRACTED_RECORDS");
    expect(result.error?.stage).toBe("select_records");
    expect(await mod.repo.listEntities()).toHaveLength(0);
    // Ingests the whole corpus before the assertion — far beyond vitest's
    // 5s default, like the full-corpus hooks above.
  }, 120_000);

  it("validateOutputs rejects a malformed entity candidate with a safe, structured error", () => {
    const badEntity = {
      id: "", // fails EntitySchema's min(1)
      investigationId: "investigation_x",
      kind: "person" as const,
      canonicalLabel: "X",
      attributes: {},
      provenance: {
        source: "extracted_record_x",
        location: "x#name",
        method: "resolution:new_entity",
        confidence: 1,
        processingHistory: ["evidence_item:x", "resolution:new_entity"],
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    };
    let caught: unknown;
    try {
      mod.validateOutputs([badEntity], [], []);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { name: string; code: string; stage: string; message: string; issues?: string[] };
    expect(e.name).toBe("ResolutionServiceError");
    expect(e.code).toBe("VALIDATION_FAILURE");
    expect(e.stage).toBe("validate_decisions");
    expect(e.issues && e.issues.length).toBeGreaterThan(0);
    expect(isUserSafeMessage(e.message)).toBe(true);
  });

  it("assertProvenance rejects a decision whose canonicalEntityId does not resolve to a created entity", () => {
    const entity: Entity = {
      id: "entity_real",
      investigationId: "investigation_x",
      kind: "person",
      canonicalLabel: "Real Person",
      attributes: {},
      provenance: {
        source: "extracted_record_x",
        location: "x#name",
        method: "resolution:new_entity",
        confidence: 1,
        processingHistory: ["evidence_item:x", "resolution:new_entity"],
        timestamp: "2026-01-01T00:00:00.000Z",
      },
    };
    const decision: ResolutionDecision = {
      id: "resolution_decision_x",
      investigationId: "investigation_x",
      canonicalEntityId: "entity_does_not_exist",
      extractedRecordIds: ["extracted_record_x"],
      resolutionType: "new_entity",
      status: "resolved",
      candidateEntityIds: [],
      conflicts: [],
      reason: "test",
      classification: "ai_inference",
      provenance: entity.provenance,
    };
    let caught: unknown;
    try {
      mod.assertProvenance([entity], [], [decision], new Set(["extracted_record_x"]));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { code: string; stage: string };
    expect(e.code).toBe("VALIDATION_FAILURE");
    expect(e.stage).toBe("attach_provenance");
  });

  it("never surfaces a stack trace, filesystem path, or raw error to the user", async () => {
    const result = await mod.runResolution();
    // still no extraction run in this block's continued state — NO_EXTRACTED_RECORDS again
    expect(isUserSafeMessage(result.error!.message)).toBe(true);
    for (const issue of result.error!.issues ?? []) expect(isUserSafeMessage(issue)).toBe(true);
  });

  it("no resolution module imports the ground-truth loader or points a path at evidence/ground-truth", () => {
    const dir = path.join(process.cwd(), "src/lib/resolution");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const code = fs
        .readFileSync(path.join(dir, file), "utf-8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(code, file).not.toMatch(/from\s+["'][^"']*ground-truth[^"']*["']/);
      expect(code, file).not.toMatch(/import\(\s*["'][^"']*ground-truth/);
      expect(code, file).not.toMatch(/["']ground-truth["']/);
      expect(code, file).not.toMatch(/evidence\/ground-truth/);
      expect(code, file).not.toMatch(/loadInvestigationGroundTruth|loadGroundTruthFixture/);
      expect(code, file).not.toMatch(/expectedEntityMerges|hiddenConnections|intendedConclusions|expectedCopilotAnswers|moneyMulePaths|resolutionForbidden/);
    }
  });
});

// ---------------------------------------------------------------------------
// Block D — non-inference proofs against the real Operation DarkNet Delhi
// corpus, plus an adversarial synthetic ambiguity case.
// ---------------------------------------------------------------------------

describe("entity resolution — non-inference safeguards", () => {
  const DB = "./data/netintel-resolve-D.db";
  let mod: ResolutionModule;
  let entities: Entity[];
  let decisions: ResolutionDecision[];

  beforeAll(async () => {
    mod = await freshResolution(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
    await mod.runResolution();
    entities = await mod.repo.listEntities();
    decisions = await mod.repo.listResolutionDecisions();
  }, 120_000);
  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("the accused 'Vikram Singh' resolves to exactly one canonical entity — no phantom second identity is invented", () => {
    const vikrams = entities.filter((e) => e.kind === "person" && e.canonicalLabel === "Vikram Singh");
    expect(vikrams).toHaveLength(1);
    const vikramDecisions = decisions.filter((d) => d.canonicalEntityId === vikrams[0]!.id);
    // FIR accused mention, suspect record, and 3 witness aboutNames
    // mentions — plus the 5 person mentions extraction now emits from the
    // fields that name him as a phone subscriber, account holder and
    // vehicle registrant. All ten land on the SAME canonical entity via
    // Tier-A shared-identifier merges, which is the point of this test:
    // more mentions must not become more identities.
    expect(vikramDecisions.length).toBe(10);
    expect(vikramDecisions.every((d) => d.status === "resolved")).toBe(true);
  });

  it("resolution never scans witness-statement free text for names — only structured aboutNames/name/accused fields feed identity clustering", async () => {
    // Strip comments first: the module's own doc comments legitimately
    // *explain* this boundary (mentioning "statement_text" by name) —
    // what must never appear is actual code reading that field.
    const code = fs
      .readFileSync(path.join(process.cwd(), "src/lib/resolution/resolve.ts"), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/statement_text/);
    expect(code).not.toMatch(/data\.text\b/);
    expect(code).not.toMatch(/"text"/);
  });

  it("Rohan Malhotra's spelling variants and nicknames all merge into one entity via shared identifiers", () => {
    const rohan = entities.find((e) => e.canonicalLabel === "Rohan Malhotra");
    expect(rohan).toBeDefined();
    const aliases = decisions
      .filter((d) => d.canonicalEntityId === rohan!.id && d.resolutionType === "shared_identifier_merge")
      .length;
    expect(aliases).toBeGreaterThan(0); // R. Malhotra / Rohan M. / Malhotra, Rohan merged via shared phone
  });

  it("Kabir Sharma / Kabir Sharman spelling variant merges with supporting evidence and a preserved justification", () => {
    const kabir = entities.find((e) => e.canonicalLabel === "Kabir Sharma");
    expect(kabir).toBeDefined();
    const sharmanDecision = decisions.find(
      (d) => d.canonicalEntityId === kabir!.id && d.resolutionType === "shared_identifier_merge",
    );
    expect(sharmanDecision).toBeDefined();
    expect(sharmanDecision!.reason.length).toBeGreaterThan(0);
    expect(sharmanDecision!.provenance.confidence).toBeLessThan(1); // merged, not a lone identifier-backed entity
  });

  it("contradictory records survive unreconciled — resolution never touches attribute_mention content", async () => {
    const records = await mod.repo.listExtractedRecords();
    const colourFact = records.find(
      (r) => r.recordType === "attribute_mention" && r.data.attribute === "colour" && r.data.subject === "SYN-VEH-0004",
    );
    expect(colourFact?.data.observedValue).toBe("white"); // untouched by resolution
    const witnessFact = records.find(
      (r) =>
        r.recordType === "attribute_mention" &&
        typeof r.data.observedValue === "string" &&
        (r.data.observedValue as string).includes("silver"),
    );
    expect(witnessFact).toBeDefined(); // the contradicting statement is still there, unmodified
  });

  it("indirect relationships are never converted into identity merges or direct edges — resolution creates no relationship rows and no entity references another entity", async () => {
    expect(await mod.repo.listRelationships()).toHaveLength(0);
    for (const e of entities) {
      expect(JSON.stringify(e.attributes)).not.toMatch(/entity_/); // no entity attribute references another entity
    }
  });

  it("cross-evidence identity support: the same vehicle plate stated in both a FIR seizure record and a separate vehicle_record canonicalizes to one entity", async () => {
    const records = await mod.repo.listExtractedRecords();
    const plateMentions = records.filter(
      (r) => r.recordType === "entity_mention" && r.data.mentionKind === "vehicle" && r.data.observedValue === "SYN-VEH-0004",
    );
    expect(plateMentions.length).toBe(2); // fir:003#seizedVehicle.plate + vehicle:SYN-VEH-0004#plate
    const vehicleEntities = entities.filter((e) => e.kind === "vehicle" && e.canonicalLabel === "SYN-VEH-0004");
    expect(vehicleEntities).toHaveLength(1);
    const vehicleDecisions = decisions.filter((d) => d.canonicalEntityId === vehicleEntities[0]!.id);
    expect(vehicleDecisions).toHaveLength(2);
  });

  it("an ambiguous name conflict (adversarial, constructed) is left unmerged, produces its own entity, and is flagged — never silently resolved", () => {
    // Two distinct identifier-anchored clusters that happen to share an
    // exact name string, plus a third, identifier-less mention of that
    // same name — this exact shape does not occur in the real corpus
    // (by design), so it is constructed here to prove the safeguard.
    const itemA = "evidence_item_fixtureA";
    const itemB = "evidence_item_fixtureB";
    const itemC = "evidence_item_fixtureC";
    const records: ExtractedRecord[] = [
      fixtureRecord({ evidenceItemId: itemA, recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Test Person" } }),
      fixtureRecord({ evidenceItemId: itemA, recordType: "relationship_mention", fieldPath: "phones[0]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Test Person", observedValue: "+99 00 000 0001" } }),
      fixtureRecord({ evidenceItemId: itemB, recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Test Person" } }),
      fixtureRecord({ evidenceItemId: itemB, recordType: "relationship_mention", fieldPath: "phones[0]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Test Person", observedValue: "+99 00 000 0002" } }),
      fixtureRecord({ evidenceItemId: itemC, recordType: "entity_mention", fieldPath: "accused[0]", data: { factType: "person_named", mentionKind: "person", observedValue: "Test Person" } }),
    ];
    const output = mod.resolveEntities(records, "investigation_fixture", "2026-01-01T00:00:00.000Z");

    const personEntities = output.entities.filter((e) => e.kind === "person");
    expect(personEntities).toHaveLength(3); // clusterA, clusterB, and the ambiguous standalone

    const ambiguousDecision = output.decisions.find((d) => d.status === "ambiguous");
    expect(ambiguousDecision).toBeDefined();
    expect(ambiguousDecision!.resolutionType).toBe("ambiguous_name_conflict");
    expect(ambiguousDecision!.candidateEntityIds).toHaveLength(2);
    expect(ambiguousDecision!.conflicts.length).toBeGreaterThan(0);
    expect(ambiguousDecision!.provenance.confidence).toBeLessThan(0.5); // below the merge-confidence floor — never auto-applied as a merge
    // The ambiguous mention is its own entity, distinct from both candidates it matched.
    expect(ambiguousDecision!.candidateEntityIds).not.toContain(ambiguousDecision!.canonicalEntityId);
    expect(output.warnings.some((w) => w.includes("Test Person"))).toBe(true);
  });
});

/**
 * Tier-A identifier-authority policy (P6.15).
 *
 * Specification tests for the approved policy. These replace the P6.15
 * characterization tests, which pinned the pre-policy behaviour precisely
 * so that adopting a policy would have to be a deliberate act by a test
 * author rather than a silent change. Case (b) below is the one that used
 * to assert a false merge; it now asserts the flag.
 *
 * Policy, in full:
 *   - Only schemes in MERGEABLE_IDENTIFIER_SCHEMES (currently LEI alone)
 *     may establish identity in Tier A.
 *   - A record asserting two or more distinct values of one such scheme is
 *     flagged `ambiguous_identifier_conflict` and merged on NONE of them.
 *   - A Wikidata QID is source-local identity and context; it never merges.
 *   - Phone / account / vehicle identifiers are untouched by all of this.
 *
 * No fuzzy matching, no embeddings, no adjudication, no ML: nothing here
 * reads a name.
 */
describe("entity resolution — Tier-A identifier authority (P6.15)", () => {
  const dbPath = "./data/test-resolution-identifier-authority.db";
  let mod: ResolutionModule;

  beforeAll(async () => {
    mod = await freshResolution(dbPath);
  });
  afterAll(async () => {
    await releaseAndRemoveDb(dbPath);
  });

  const LEI_A = "LEI:AAAAAAAAAAAAAAAAAAAA";
  const LEI_B = "LEI:BBBBBBBBBBBBBBBBBBBB";

  /** An organisation mention plus the registry identifiers its record states. */
  function org(
    evidenceItemId: string,
    name: string,
    identifiers: string[],
    registry: string,
  ): ExtractedRecord[] {
    return [
      fixtureRecord({
        evidenceItemId,
        recordType: "entity_mention",
        fieldPath: "name",
        data: { factType: "organisation_named", mentionKind: "organisation", observedValue: name, registry },
      }),
      ...identifiers.map((qualified, i) =>
        fixtureRecord({
          evidenceItemId,
          recordType: "relationship_mention",
          fieldPath: `identifiers[${i}]`,
          data: {
            factType: "subject_has_identifier",
            relationshipType: "has_identifier",
            subject: name,
            observedValue: qualified,
            scheme: qualified.slice(0, qualified.indexOf(":")),
          },
        }),
      ),
    ];
  }

  const resolve = (records: ExtractedRecord[]) =>
    mod.resolveEntities(records, "investigation_authority", "2026-01-01T00:00:00.000Z");

  // (a) valid shared LEI — the case that must keep working
  it("(a) merges two records from different sources that state the same LEI", () => {
    const output = resolve([
      ...org("evidence_item_a_gleif", "AIR INDIA LIMITED", [LEI_A], "gleif"),
      ...org("evidence_item_a_wikidata", "Air India", ["WIKIDATA:Q1", LEI_A], "wikidata"),
    ]);
    const orgs = output.entities.filter((e) => e.kind === "organisation");
    expect(orgs).toHaveLength(1);
    expect(output.decisions.every((d) => d.status === "resolved")).toBe(true);
    expect(output.decisions.some((d) => d.resolutionType === "shared_identifier_merge")).toBe(true);
    // The differing names (suffix + case) are irrelevant: Tier A never read them.
    expect(output.aliases.map((a) => a.aliasValue)).toContain("Air India");
  });

  // (b) same-record conflicting LEIs — the Q188087 failure
  it("(b) never bridges two entities through one record asserting two LEIs", () => {
    const output = resolve([
      ...org("evidence_item_b_gleif_a", "PJSC UNIPRO", [LEI_A], "gleif"),
      ...org("evidence_item_b_gleif_b", "UNIPRO", [LEI_B], "gleif"),
      ...org("evidence_item_b_wikidata", "Unipro", ["WIKIDATA:Q188087", LEI_A, LEI_B], "wikidata"),
    ]);
    const orgs = output.entities.filter((e) => e.kind === "organisation");
    // Three entities: the two distinct GLEIF legal entities, plus the
    // conflicted Wikidata record standing alone. Previously: one.
    expect(orgs).toHaveLength(3);

    const gleifA = output.decisions.find((d) => d.extractedRecordIds.some((id) =>
      output.entities.some((e) => e.id === d.canonicalEntityId && e.canonicalLabel === "PJSC UNIPRO")));
    const gleifB = output.decisions.find((d) => d.extractedRecordIds.some((id) =>
      output.entities.some((e) => e.id === d.canonicalEntityId && e.canonicalLabel === "UNIPRO")));
    expect(gleifA!.canonicalEntityId).not.toBe(gleifB!.canonicalEntityId);
  });

  // (g) flag / no-merge behaviour, on the same fixture as (b)
  it("(g) flags the conflicted record as ambiguous_identifier_conflict, below merge confidence", () => {
    const output = resolve([
      ...org("evidence_item_b_gleif_a", "PJSC UNIPRO", [LEI_A], "gleif"),
      ...org("evidence_item_b_gleif_b", "UNIPRO", [LEI_B], "gleif"),
      ...org("evidence_item_b_wikidata", "Unipro", ["WIKIDATA:Q188087", LEI_A, LEI_B], "wikidata"),
    ]);
    const flagged = output.decisions.find((d) => d.resolutionType === "ambiguous_identifier_conflict");
    expect(flagged).toBeDefined();
    expect(flagged!.status).toBe("ambiguous");
    // Same treatment Tier B already gives an ambiguous name.
    expect(flagged!.provenance.confidence).toBeLessThan(0.5);
    expect(flagged!.conflicts.length).toBeGreaterThan(0);
    expect(flagged!.conflicts[0]).toContain("LEI");
    // Both entities it would have merged into are recorded, and it is in neither.
    expect(flagged!.candidateEntityIds).toHaveLength(2);
    expect(flagged!.candidateEntityIds).not.toContain(flagged!.canonicalEntityId);
    // The conflict is surfaced through the existing warning path.
    expect(output.warnings.some((w) => w.includes("Unipro") && w.includes("LEI"))).toBe(true);
  });

  it("(g) withholds a conflicted record from Tier B as well, so the bridge cannot return by name", () => {
    // The Wikidata record's name is byte-identical to the GLEIF one here.
    // Without the Tier-B exclusion it would merge on the name instead and
    // rebuild the same wrong link through a lower-confidence door.
    const output = resolve([
      ...org("evidence_item_tb_gleif_a", "UNIPRO", [LEI_A], "gleif"),
      ...org("evidence_item_tb_gleif_b", "UNIPRO LLC", [LEI_B], "gleif"),
      ...org("evidence_item_tb_wikidata", "UNIPRO", [LEI_A, LEI_B], "wikidata"),
    ]);
    const flagged = output.decisions.find((d) => d.resolutionType === "ambiguous_identifier_conflict");
    expect(flagged).toBeDefined();
    expect(output.decisions.some((d) => d.resolutionType === "exact_name_match")).toBe(false);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(3);
  });

  // (c) conflicting LEIs across sources
  it("(c) does not merge two records that state different LEIs, whatever else they share", () => {
    const output = resolve([
      ...org("evidence_item_c_gleif", "SOME COMPANY LIMITED", [LEI_A], "gleif"),
      ...org("evidence_item_c_wikidata", "Some Company", ["WIKIDATA:Q7", LEI_B], "wikidata"),
    ]);
    // Distinct LEIs are distinct legal entities. The shared QID scheme is
    // not a merge key, and neither is the similar name.
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(2);
    expect(output.decisions.some((d) => d.resolutionType === "shared_identifier_merge")).toBe(false);
  });

  // (d) authoritative vs non-authoritative
  it("(d) lets a non-authoritative cross-reference corroborate, but never establish a second identity", () => {
    // GLEIF issues LEI. Wikidata restating one is corroboration and joins.
    // Wikidata's own QID, restated by a second Wikidata record with a
    // DIFFERENT LEI, must not drag that second record in.
    const output = resolve([
      ...org("evidence_item_d_gleif", "AUTHORITATIVE LIMITED", [LEI_A], "gleif"),
      ...org("evidence_item_d_wd1", "Authoritative", ["WIKIDATA:Q9", LEI_A], "wikidata"),
      ...org("evidence_item_d_wd2", "Authoritative Sibling", ["WIKIDATA:Q9", LEI_B], "wikidata"),
    ]);
    const orgs = output.entities.filter((e) => e.kind === "organisation");
    // GLEIF+wd1 merged on the authoritative LEI; wd2 stands apart on its
    // own LEI. The shared QID connects nothing.
    expect(orgs).toHaveLength(2);
    const merged = output.decisions.filter((d) => d.resolutionType === "shared_identifier_merge");
    expect(merged).toHaveLength(2);
    expect(new Set(merged.map((d) => d.canonicalEntityId)).size).toBe(1);
  });

  // (f) QID behaviour
  it("(f) never merges on a Wikidata QID alone", () => {
    const output = resolve([
      ...org("evidence_item_f_1", "Item One", ["WIKIDATA:Q42"], "wikidata"),
      ...org("evidence_item_f_2", "Item Two", ["WIKIDATA:Q42"], "wikidata"),
    ]);
    // A QID identifies a Wikidata ITEM, not necessarily one legal entity.
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(2);
    expect(output.decisions.some((d) => d.resolutionType === "shared_identifier_merge")).toBe(false);
    // Not a conflict either — one value of a non-mergeable scheme is fine.
    expect(output.decisions.some((d) => d.resolutionType === "ambiguous_identifier_conflict")).toBe(false);
  });

  it("(f) does not flag a record carrying one QID and one LEI — that is the normal cross-source shape", () => {
    const output = resolve([
      ...org("evidence_item_f3_gleif", "NORMAL LIMITED", [LEI_A], "gleif"),
      ...org("evidence_item_f3_wd", "Normal", ["WIKIDATA:Q5", LEI_A], "wikidata"),
    ]);
    expect(output.decisions.some((d) => d.resolutionType === "ambiguous_identifier_conflict")).toBe(false);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(1);
  });

  // (e) cross-scheme collision
  it("(e) keeps schemes apart when an LEI and a QID share the same characters", () => {
    const collide = "Z0000000000000000000";
    const output = resolve([
      ...org("evidence_item_e_1", "Org One", [`LEI:${collide}`], "gleif"),
      ...org("evidence_item_e_2", "Org Two", [`WIKIDATA:${collide}`], "wikidata"),
    ]);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(2);
  });

  it("does not merge organisations into persons, whatever identifiers they share", () => {
    const records: ExtractedRecord[] = [
      ...org("evidence_item_kind_a", "Shared Name", [LEI_A], "gleif"),
      fixtureRecord({ evidenceItemId: "evidence_item_kind_b", recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Shared Name" } }),
      fixtureRecord({ evidenceItemId: "evidence_item_kind_b", recordType: "relationship_mention", fieldPath: "identifiers[0]", data: { factType: "subject_has_identifier", relationshipType: "has_identifier", subject: "Shared Name", observedValue: LEI_A, scheme: "LEI" } }),
    ];
    const output = resolve(records);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(1);
    expect(output.entities.filter((e) => e.kind === "person")).toHaveLength(1);
  });

  it("leaves phone / account / vehicle identifiers entirely outside the policy", () => {
    // The policy governs `has_identifier` only. Every non-public evidence
    // type depends on these, and the DarkNet Delhi evaluation is the proof
    // that they still behave identically — but assert it here too, so a
    // future widening of the policy fails fast and locally.
    const itemA = "evidence_item_legacy_a";
    const itemB = "evidence_item_legacy_b";
    const records: ExtractedRecord[] = [
      fixtureRecord({ evidenceItemId: itemA, recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Legacy Person" } }),
      fixtureRecord({ evidenceItemId: itemA, recordType: "relationship_mention", fieldPath: "phones[0]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Legacy Person", observedValue: "+99 00 000 5555" } }),
      fixtureRecord({ evidenceItemId: itemB, recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Legacy Person Alt" } }),
      fixtureRecord({ evidenceItemId: itemB, recordType: "relationship_mention", fieldPath: "phones[0]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Legacy Person Alt", observedValue: "+99 00 000 5555" } }),
    ];
    const output = resolve(records);
    expect(output.entities.filter((e) => e.kind === "person")).toHaveLength(1);
    expect(output.decisions.some((d) => d.resolutionType === "shared_identifier_merge")).toBe(true);
  });

  it("still merges a person on TWO different phones, which is not a conflict", () => {
    // Multi-valued is only a contradiction for a scheme where one value
    // denotes one subject. A person legitimately holds two phones, and
    // that bridging is the resolver's whole point on the synthetic corpus.
    const itemA = "evidence_item_twophone_a";
    const itemB = "evidence_item_twophone_b";
    const records: ExtractedRecord[] = [
      fixtureRecord({ evidenceItemId: itemA, recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Two Phones" } }),
      fixtureRecord({ evidenceItemId: itemA, recordType: "relationship_mention", fieldPath: "phones[0]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Two Phones", observedValue: "+99 00 000 7001" } }),
      fixtureRecord({ evidenceItemId: itemA, recordType: "relationship_mention", fieldPath: "phones[1]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Two Phones", observedValue: "+99 00 000 7002" } }),
      fixtureRecord({ evidenceItemId: itemB, recordType: "entity_mention", fieldPath: "name", data: { factType: "person_named", mentionKind: "person", observedValue: "Second Sighting" } }),
      fixtureRecord({ evidenceItemId: itemB, recordType: "relationship_mention", fieldPath: "phones[0]", data: { factType: "has_phone", relationshipType: "has_phone", subject: "Second Sighting", observedValue: "+99 00 000 7002" } }),
    ];
    const output = resolve(records);
    expect(output.entities.filter((e) => e.kind === "person")).toHaveLength(1);
    expect(output.decisions.some((d) => d.resolutionType === "ambiguous_identifier_conflict")).toBe(false);
  });
});
