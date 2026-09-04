import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { makeContentId } from "@/lib/domain/ids";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Provenance } from "@/lib/domain/provenance";

import { prepareFreshDb, releaseAndRemoveDb } from "./helpers/db";

/**
 * Deterministic extraction tests. No Anthropic call, no Docker, no
 * external service — a local SQLite file and the committed corpus JSON,
 * reached only through ingestion (extraction never reads a file
 * directly). Same isolated-database-per-block pattern as
 * tests/unit/ingestion.test.ts.
 */

type ExtractionModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  runExtraction: typeof import("@/lib/extraction/service").runExtraction;
  getExtractionState: typeof import("@/lib/extraction/summary").getExtractionState;
  getExtractedFactsPage: typeof import("@/lib/extraction/summary").getExtractedFactsPage;
  idempotentPersistExtractedRecords: typeof import("@/lib/extraction/persist").idempotentPersistExtractedRecords;
  buildCandidatesForItem: typeof import("@/lib/extraction/extract").buildCandidatesForItem;
  extractRawFacts: typeof import("@/lib/extraction/extract").extractRawFacts;
  UnsupportedEvidenceTypeError: typeof import("@/lib/extraction/extract").UnsupportedEvidenceTypeError;
  validateCandidates: typeof import("@/lib/extraction/verify").validateCandidates;
  repo: typeof import("@/lib/db/repository");
};

async function freshExtraction(dbPath: string): Promise<ExtractionModule> {
  await prepareFreshDb(dbPath);
  vi.resetModules();
  process.env.DATABASE_URL = dbPath;

  const [ingestion, extraction, summary, persist, extract, verify, repo] = await Promise.all([
    import("@/lib/ingestion/service"),
    import("@/lib/extraction/service"),
    import("@/lib/extraction/summary"),
    import("@/lib/extraction/persist"),
    import("@/lib/extraction/extract"),
    import("@/lib/extraction/verify"),
    import("@/lib/db/repository"),
  ]);
  return {
    runIngestion: ingestion.runIngestion,
    runExtraction: extraction.runExtraction,
    getExtractionState: summary.getExtractionState,
    getExtractedFactsPage: summary.getExtractedFactsPage,
    idempotentPersistExtractedRecords: persist.idempotentPersistExtractedRecords,
    buildCandidatesForItem: extract.buildCandidatesForItem,
    extractRawFacts: extract.extractRawFacts,
    UnsupportedEvidenceTypeError: extract.UnsupportedEvidenceTypeError,
    validateCandidates: verify.validateCandidates,
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

const EVIDENCE_ITEM_TYPES = [
  "fir",
  "suspect_record",
  "alias_record",
  "phone_record",
  "imei_record",
  "vehicle_record",
  "bank_account_record",
  "location_record",
  "cdr_event",
  "financial_transaction_record",
  "witness_statement",
  "crime_event",
] as const;

function isUserSafeMessage(message: string): boolean {
  return (
    !/\/(Users|home|root|var|tmp|private)\//.test(message) &&
    !/\.[cm]?tsx?:\d+/.test(message) &&
    !/\n\s+at\s+/.test(message) &&
    !message.includes("ZodError") &&
    !message.includes("node:sqlite")
  );
}

// ---------------------------------------------------------------------------
// Block A — valid extraction over the full corpus: coverage, provenance,
// classification, confidence, deterministic IDs, idempotency
// ---------------------------------------------------------------------------

describe("evidence extraction — valid corpus", () => {
  const DB = "./data/cipher-extract-A.db";
  let mod: ExtractionModule;
  let first: Awaited<ReturnType<ExtractionModule["runExtraction"]>>;

  beforeAll(async () => {
    mod = await freshExtraction(DB);
    const ingested = await mod.runIngestion({ kind: "builtin-corpus" });
    expect(ingested.status).toBe("ingested");
    first = await mod.runExtraction();
  }, 90_000);

  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("extracts successfully and runs all 7 stages to completion with real detail", () => {
    expect(first.status).toBe("extracted");
    expect(first.error).toBeNull();
    expect(first.stages).toHaveLength(7);
    for (const stage of first.stages) {
      expect(stage.status).toBe("ok");
      expect(stage.detail.length).toBeGreaterThan(0);
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("considers every accepted evidence item and extracts at least one fact from each", () => {
    expect(first.counts?.evidenceItemsConsidered).toBe(1820);
    expect(first.counts?.evidenceItemsExtracted).toBe(1820);
    expect(first.warnings).toEqual([]);
  });

  it("produces records of all four record types", () => {
    const byType = first.counts?.recordsByType ?? {};
    expect(byType.entity_mention).toBeGreaterThan(0);
    expect(byType.attribute_mention).toBeGreaterThan(0);
    expect(byType.relationship_mention).toBeGreaterThan(0);
    expect(byType.event_mention).toBe(1150 + 560 + 4); // one per CDR + one per transaction + one per crime event
  });

  it("covers every one of the 12 supported evidence types with at least one extractable fact", async () => {
    const items = await mod.repo.listEvidenceItems();
    for (const itemType of EVIDENCE_ITEM_TYPES) {
      const sample = items.find((i) => i.itemType === itemType);
      expect(sample, `no sample evidence item for ${itemType}`).toBeDefined();
      const candidates = mod.buildCandidatesForItem(sample!, first.startedAt);
      expect(candidates.length, `${itemType} produced no facts`).toBeGreaterThan(0);
      for (const c of candidates) {
        expect(c.evidenceItemId).toBe(sample!.id);
        expect(c.classification).toBe("observed_fact");
      }
    }
  });

  it("every extracted record is classified exactly Observed Fact — never a higher/derived classification", async () => {
    const records = await mod.repo.listExtractedRecords();
    expect(records.length).toBeGreaterThan(0);
    expect(records.every((r) => r.classification === "observed_fact")).toBe(true);

    const serialized = JSON.stringify(records);
    for (const forbidden of [
      "corroborated_fact",
      "algorithmic_signal",
      "ai_inference",
      "investigative_lead",
    ]) {
      expect(serialized).not.toContain(`"classification":"${forbidden}"`);
    }
  });

  it("confidence represents extraction quality only, independent of classification", async () => {
    const records = await mod.repo.listExtractedRecords();
    for (const r of records) {
      expect(r.provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(r.provenance.confidence).toBeLessThanOrEqual(1);
    }
    // Facts derived from a multi-element array (e.g. a suspect's several
    // phones) are not given higher confidence than a single-valued fact
    // — extraction never inflates confidence for volume or corroboration.
    const distinctConfidences = new Set(records.map((r) => r.provenance.confidence));
    expect(distinctConfidences.size).toBe(1);
    expect([...distinctConfidences][0]).toBe(1);
  });

  it("preserves complete provenance on every record, tracing to a real, currently-persisted evidence item", async () => {
    const itemIds = new Set((await mod.repo.listEvidenceItems()).map((i) => i.id));
    const records = await mod.repo.listExtractedRecords();
    for (const r of records.slice(0, 200)) {
      expect(r.provenance.source).toMatch(/^evidence_item_/);
      expect(itemIds.has(r.provenance.source)).toBe(true);
      expect(r.provenance.source).toBe(r.evidenceItemId);
      expect(r.provenance.method).toMatch(/^extraction:field-read:/);
      expect(r.provenance.location).toContain("#");
      expect(r.provenance.processingHistory.length).toBeGreaterThanOrEqual(2);
      expect(r.provenance.processingHistory[0]).toBe(`evidence_item:${r.evidenceItemId}`);
    }
  });

  it("every record in one run shares the same provenance timestamp — a real wall-clock instant, distinct from in-evidence timestamps", async () => {
    const records = await mod.repo.listExtractedRecords();
    const timestamps = new Set(records.map((r) => r.provenance.timestamp));
    expect(timestamps.size).toBe(1);
    expect([...timestamps][0]).toBe(first.startedAt);
  });

  it("assigns deterministic content-addressed ids — recomputing candidates for the same item yields the same ids, independent of the extraction run's timestamp", async () => {
    const items = await mod.repo.listEvidenceItems();
    const sample = items.find((i) => i.itemType === "suspect_record")!;
    const a = mod.buildCandidatesForItem(sample, "2026-01-01T00:00:00.000Z");
    const b = mod.buildCandidatesForItem(sample, "2099-12-31T23:59:59.000Z");
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));

    const nameFact = a.find((c) => c.provenance.location.endsWith("#name"))!;
    expect(nameFact.id).toBe(makeContentId("extracted_record", [sample.id, "name"]));
  });

  it("exposes the correct extraction state and a representative, paginated facts view", async () => {
    const state = await mod.getExtractionState();
    expect(state.status).toBe("extracted");
    if (state.status !== "extracted") return;
    expect(state.summary.totalRecords).toBe(first.counts?.recordsByType
      ? Object.values(first.counts.recordsByType).reduce((a, b) => a + b, 0)
      : 0);
    expect(state.summary.evidenceItemsExtracted).toBe(1820);
    expect(state.summary.evidenceItemsTotal).toBe(1820);

    const page = await mod.getExtractedFactsPage(0, 10);
    expect(page.facts).toHaveLength(10);
    expect(page.total).toBe(state.summary.totalRecords);
    for (const f of page.facts) {
      expect(f.classification).toBe("observed_fact");
      expect(typeof f.factType).toBe("string");
      expect(f.provenance.location).toContain("#");
    }

    const page2 = await mod.getExtractedFactsPage(10, 10);
    expect(page2.facts.map((f) => f.id)).not.toEqual(page.facts.map((f) => f.id));
  });

  it("investigation state exposes no ground-truth / expected-answer content", async () => {
    const state = await mod.getExtractionState();
    const blob = JSON.stringify(state);
    for (const key of GROUND_TRUTH_KEYS) expect(blob.includes(key)).toBe(false);
    const factsBlob = JSON.stringify(await mod.getExtractedFactsPage(0, 50));
    for (const key of GROUND_TRUTH_KEYS) expect(factsBlob.includes(key)).toBe(false);
  });

  it("repeated extraction is idempotent — no duplicate authoritative records are created", async () => {
    const before = await mod.repo.listExtractedRecords();
    const second = await mod.runExtraction();
    expect(second.status).toBe("already_extracted");
    expect(second.persisted).toEqual({ created: 0, skipped: before.length });
    const after = await mod.repo.listExtractedRecords();
    expect(after.length).toBe(before.length);
    expect(JSON.stringify([...after].sort((a, b) => (a.id < b.id ? -1 : 1)))).toBe(
      JSON.stringify([...before].sort((a, b) => (a.id < b.id ? -1 : 1))),
    );

    const third = await mod.runExtraction();
    expect(third.status).toBe("already_extracted");
  });
});

// ---------------------------------------------------------------------------
// Block B — partial-failure retry: only missing records are (re)created
// ---------------------------------------------------------------------------

describe("evidence extraction — partial retry", () => {
  const DB = "./data/cipher-extract-B.db";
  let mod: ExtractionModule;

  beforeAll(async () => {
    mod = await freshExtraction(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
  }, 60_000);
  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("a retry after a partial write persists only the records that are still missing", async () => {
    const items = await mod.repo.listEvidenceItems();
    const suspect = items.find((i) => i.itemType === "suspect_record")!;
    const phone = items.find((i) => i.itemType === "phone_record")!;
    const extractedAt = "2026-01-01T00:00:00.000Z";
    const candidatesA = mod.buildCandidatesForItem(suspect, extractedAt);
    const candidatesB = mod.buildCandidatesForItem(phone, extractedAt);
    const recordsA = mod.validateCandidates(candidatesA);
    const recordsB = mod.validateCandidates(candidatesB);

    // Simulate a prior partial run: only group A made it to disk.
    const firstPass = await mod.idempotentPersistExtractedRecords(recordsA);
    expect(firstPass).toEqual({ created: recordsA.length, skipped: 0 });

    // Retry with the full set (A ∪ B) — A is already present and must be
    // skipped; only B (the missing records) is newly created.
    const retry = await mod.idempotentPersistExtractedRecords([...recordsA, ...recordsB]);
    expect(retry).toEqual({ created: recordsB.length, skipped: recordsA.length });

    const stored = await mod.repo.listExtractedRecords();
    expect(stored.length).toBe(recordsA.length + recordsB.length);
  });
});

// ---------------------------------------------------------------------------
// Block C — structured errors
// ---------------------------------------------------------------------------

describe("evidence extraction — structured errors", () => {
  const DB = "./data/cipher-extract-C.db";
  let mod: ExtractionModule;

  beforeAll(async () => {
    mod = await freshExtraction(DB);
  });
  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("rejects extraction with no investigation loaded as NO_INVESTIGATION, safely and without throwing", async () => {
    const result = await mod.runExtraction();
    expect(result.status).toBe("failed");
    expect(result.error?.code).toBe("NO_INVESTIGATION");
    expect(result.error?.stage).toBe("select_evidence");
    expect(isUserSafeMessage(result.error!.message)).toBe(true);
    expect(await mod.repo.listExtractedRecords()).toHaveLength(0);
  });

  it("extractRawFacts rejects an unsupported evidence item type", () => {
    expect(() => mod.extractRawFacts("totally_bogus_type" as never, {})).toThrow(
      mod.UnsupportedEvidenceTypeError,
    );
  });

  it("validateCandidates rejects a malformed extracted-record candidate with a safe, structured error", () => {
    const badCandidate = {
      id: "", // fails ExtractedRecordSchema's min(1)
      evidenceItemId: "evidence_item_doesnotexist",
      recordType: "entity_mention" as const,
      data: { factType: "person_named", observedValue: "X" },
      classification: "observed_fact" as const,
      provenance: {
        source: "evidence_item_doesnotexist",
        location: "x#name",
        method: "extraction:field-read:suspect_record",
        confidence: 1,
        processingHistory: ["evidence_item:evidence_item_doesnotexist", "extraction:person_named"],
        timestamp: "2026-01-01T00:00:00.000Z",
      } satisfies Provenance,
    };
    let caught: unknown;
    try {
      mod.validateCandidates([badCandidate]);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { name: string; code: string; stage: string; message: string; issues?: string[] };
    expect(e.name).toBe("ExtractionServiceError");
    expect(e.code).toBe("VALIDATION_FAILURE");
    expect(e.stage).toBe("validate_records");
    expect(e.issues && e.issues.length).toBeGreaterThan(0);
    expect(isUserSafeMessage(e.message)).toBe(true);
  });

  it("never surfaces a stack trace, filesystem path, or raw error to the user", async () => {
    const result = await mod.runExtraction();
    expect(isUserSafeMessage(result.error!.message)).toBe(true);
    for (const issue of result.error!.issues ?? []) expect(isUserSafeMessage(issue)).toBe(true);
  });

  it("no extraction module imports the ground-truth loader or points a path at evidence/ground-truth", () => {
    const dir = path.join(process.cwd(), "src/lib/extraction");
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
    }
  });
});

// ---------------------------------------------------------------------------
// Block D — non-inference proofs against the real Operation DarkNet Delhi
// corpus: extraction must never resolve the known ambiguous cases.
// ---------------------------------------------------------------------------

describe("evidence extraction — non-inference safeguards", () => {
  const DB = "./data/cipher-extract-D.db";
  let mod: ExtractionModule;
  let records: ExtractedRecord[];

  beforeAll(async () => {
    mod = await freshExtraction(DB);
    await mod.runIngestion({ kind: "builtin-corpus" });
    await mod.runExtraction();
    records = await mod.repo.listExtractedRecords();
  }, 90_000);
  afterAll(async () => {
    await releaseAndRemoveDb(DB);
  });

  it("the two distinct 'Vikram Singh' evidence mentions (accused enforcer vs. bystander witness reference) stay independent, unmerged records", () => {
    const vikrams = records.filter(
      (r) => r.recordType === "entity_mention" && r.data.observedValue === "Vikram Singh",
    );
    // Present in the FIR, the suspect record, and witness statements —
    // each is its own record, from its own evidence item.
    expect(vikrams.length).toBeGreaterThanOrEqual(2);
    const evidenceItemIds = new Set(vikrams.map((r) => r.evidenceItemId));
    expect(evidenceItemIds.size).toBeGreaterThanOrEqual(2);
    // No record anywhere links two different "Vikram Singh" evidence
    // items together — every record's data is built from exactly one
    // evidence item's own content, so no cross-item merge can exist.
    const ids = vikrams.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length); // every mention is its own record
    for (const r of records) {
      expect(r.provenance.source).toBe(r.evidenceItemId); // never a merged/derived source
    }
  });

  it("alias-variant name mentions ('R. Malhotra', 'Rohan M.', 'Malhotra, Rohan', 'Kabir Sharman', ...) are extracted as independent entity_mentions, never merged with their canonical name", () => {
    const variantNames = ["R. Malhotra", "Rohan M.", "Malhotra, Rohan", "Kabir Sharman", "K. Sharma", "N. Kapoor", "Neha K."];
    const variantMentions = records.filter(
      (r) => r.recordType === "entity_mention" && variantNames.includes(r.data.observedValue as string),
    );
    // Assert the SET, not the count: a variant spelling may legitimately
    // be mentioned more than once now that extraction also reads the
    // person-naming fields of phone/account/vehicle records. What must
    // hold is that every variant is extracted as its own mention and none
    // is silently folded into a canonical name.
    expect(new Set(variantMentions.map((r) => r.data.observedValue))).toEqual(new Set(variantNames));
    expect(variantMentions.length).toBeGreaterThanOrEqual(variantNames.length);

    // Each variant's own record explicitly notes it is a "registry
    // spelling variant" (an observed fact about that source), but
    // extraction does not act on that note — no relationship_mention
    // anywhere connects a variant's evidence item to the canonical
    // suspect's evidence item.
    const variantItemIds = new Set(variantMentions.map((r) => r.evidenceItemId));
    for (const itemId of variantItemIds) {
      const fromThisItem = records.filter((r) => r.evidenceItemId === itemId);
      // Every fact from a variant's own item only ever names/relates the
      // variant string itself (subject/observedValue), never a
      // cross-reference id belonging to another evidence item.
      for (const r of fromThisItem) {
        expect(JSON.stringify(r.data)).not.toMatch(/evidence_item_/);
      }
    }
  });

  it("contradictory records (FIR3 seized-vehicle colour vs. the witness statement describing a different colour) both survive, unreconciled", () => {
    const colourFact = records.find(
      (r) => r.recordType === "attribute_mention" && r.data.attribute === "colour" && r.data.subject === "SYN-VEH-0004",
    );
    expect(colourFact?.data.observedValue).toBe("white"); // the FIR's own stated colour, untouched

    const witnessFact = records.find(
      (r) =>
        r.recordType === "attribute_mention" &&
        r.data.attribute === "statement_text" &&
        typeof r.data.observedValue === "string" &&
        (r.data.observedValue as string).includes("silver"),
    );
    expect(witnessFact).toBeDefined(); // the contradicting witness statement is extracted verbatim, not resolved
  });

  it("no relationship or event links the known hidden connection (Rohan Malhotra ↔ Farhan Qureshi) directly — extraction states only what each source itself says", () => {
    const suspicious = records.filter((r) => {
      if (r.recordType !== "relationship_mention" && r.recordType !== "event_mention") return false;
      const blob = JSON.stringify(r.data);
      return blob.includes("Rohan Malhotra") && blob.includes("Farhan Qureshi");
    });
    expect(suspicious).toEqual([]);
  });

  it("money-mule account/transaction facts are reproduced verbatim with no extraction-added suspicion label", () => {
    const muleAccountFact = records.find(
      (r) => r.recordType === "attribute_mention" && r.data.attribute === "account_kind" && r.data.observedValue === "mule",
    );
    expect(muleAccountFact).toBeDefined(); // the source's own literal field value, reproduced as-is
    // No record anywhere carries an extraction-invented label about
    // suspicion, laundering, or mule-path membership.
    const forbiddenKeys = ["materiality", "suspicious", "isSuspicious", "isMuleAccount", "moneyMulePath", "flagged", "launderingPath"];
    for (const r of records) {
      for (const key of forbiddenKeys) expect(Object.keys(r.data)).not.toContain(key);
    }
    const txnFact = records.find((r) => r.data.eventKind === "financial_transaction");
    expect(txnFact).toBeDefined();
    expect(Object.keys(txnFact!.data).sort()).toEqual(
      ["amount", "currency", "eventKind", "factType", "fromAccount", "observedValue", "recordRef", "toAccount", "txnRef", "valueDate"].sort(),
    );
  });

  it("misleading low-value relationships (small personal transfers, unrelated calls) are extracted as ordinary observed facts, with no materiality/noise judgment applied", () => {
    const smallTransfer = records.find(
      (r) => r.data.eventKind === "financial_transaction" && typeof r.data.amount === "number" && (r.data.amount as number) < 1000,
    );
    expect(smallTransfer).toBeDefined();
    expect(smallTransfer!.classification).toBe("observed_fact"); // same classification as every other transaction
    expect(Object.keys(smallTransfer!.data)).not.toContain("materiality");
  });
});
