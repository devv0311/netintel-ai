import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import { loadInvestigationCorpus } from "@/lib/corpus/load";
import { generateGroundTruth } from "@/lib/corpus/generate";
import { canonicalize } from "@/lib/corpus/canonicalize";
import { makeContentId, makeOpaqueId } from "@/lib/domain/ids";
import { CORPUS_NAME, CORPUS_VERSION, CORPUS_GENERATED_AT } from "@/lib/corpus/config";
import type { IngestionSourceInput } from "@/lib/ingestion/types";

/**
 * Deterministic ingestion tests. No Anthropic call, no Docker, no
 * external service — a local SQLite file and the committed corpus JSON.
 *
 * Each block gets an isolated database via `freshIngestion()`, which
 * resets the module registry so `src/lib/db/client.ts`'s singleton
 * rebinds to a block-specific DATABASE_URL (same pattern as env.test.ts).
 */

const EXPECTED_COUNTS = {
  evidenceSources: 6,
  evidenceItems: 1820,
  communications: 1150,
  financialTransactions: 560,
  locations: 14,
} as const;
const TOTAL_ROWS =
  1 +
  EXPECTED_COUNTS.evidenceSources +
  EXPECTED_COUNTS.evidenceItems +
  EXPECTED_COUNTS.locations +
  EXPECTED_COUNTS.communications +
  EXPECTED_COUNTS.financialTransactions; // 3551

type IngestionModule = {
  runIngestion: typeof import("@/lib/ingestion/service").runIngestion;
  getInvestigationState: typeof import("@/lib/ingestion/summary").getInvestigationState;
  idempotentPersist: typeof import("@/lib/ingestion/persist").idempotentPersist;
  repo: typeof import("@/lib/db/repository");
};

/**
 * Rebinds the whole ingestion stack to a block-specific SQLite file
 * (`src/lib/db/client.ts` holds a module singleton, so a module reset is
 * the way to switch databases — same pattern as env.test.ts).
 */
async function freshIngestion(dbPath: string): Promise<IngestionModule> {
  vi.resetModules();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  process.env.DATABASE_URL = dbPath;

  const [service, summary, persist, repo] = await Promise.all([
    import("@/lib/ingestion/service"),
    import("@/lib/ingestion/summary"),
    import("@/lib/ingestion/persist"),
    import("@/lib/db/repository"),
  ]);
  return {
    runIngestion: service.runIngestion,
    getInvestigationState: summary.getInvestigationState,
    idempotentPersist: persist.idempotentPersist,
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

// ---------------------------------------------------------------------------
// Block A — valid ingestion, deterministic IDs, provenance, idempotency
// ---------------------------------------------------------------------------

describe("evidence ingestion — valid corpus", () => {
  const DB = "./data/netintel-ingest-A.db";
  let mod: IngestionModule;
  let first: Awaited<ReturnType<IngestionModule["runIngestion"]>>;

  beforeAll(async () => {
    mod = await freshIngestion(DB);
    first = await mod.runIngestion({ kind: "builtin-corpus" });
  }, 60_000);

  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB + s, { force: true });
  });

  it("ingests the built-in corpus successfully", () => {
    expect(first.status).toBe("ingested");
    expect(first.error).toBeNull();
    expect(first.corpus).toEqual({
      name: CORPUS_NAME,
      version: CORPUS_VERSION,
      fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
  });

  it("runs all 8 pipeline stages to completion with real detail", () => {
    expect(first.stages).toHaveLength(8);
    for (const stage of first.stages) {
      expect(stage.status).toBe("ok");
      expect(typeof stage.detail).toBe("string");
      expect(stage.detail.length).toBeGreaterThan(0);
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("first ingestion creates every record (nothing skipped)", () => {
    expect(first.persisted).toEqual({ created: TOTAL_ROWS, skipped: 0 });
  });

  it("assigns a deterministic content-addressed investigation id", () => {
    expect(first.investigationId).toBe(
      makeContentId("investigation", [CORPUS_NAME, CORPUS_VERSION]),
    );
  });

  it("persists exactly the expected counts", async () => {
    expect(first.counts).toMatchObject(EXPECTED_COUNTS);
    const state = await mod.getInvestigationState();
    expect(state.status).toBe("loaded");
    if (state.status !== "loaded") return;
    expect(state.summary.counts).toMatchObject(EXPECTED_COUNTS);
    expect(state.summary.counts.evidenceItemsByType.fir).toBe(5);
    expect(state.summary.counts.evidenceItemsByType.cdr_event).toBe(1150);
    expect(typeof state.summary.ingestedAt).toBe("string");
  });

  it("normalization is deterministic — a second load produces identical ids and provenance", () => {
    const a = loadInvestigationCorpus();
    const b = loadInvestigationCorpus();
    const shape = (x: ReturnType<typeof loadInvestigationCorpus>) => ({
      investigation: x.investigation.id,
      items: x.evidenceItems.map((i) => i.id),
      comms: x.communicationEvents.map((c) => [c.id, c.provenance]),
      txns: x.financialTransactions.map((t) => [t.id, t.provenance]),
      locations: x.locations.map((l) => [l.id, l.provenance]),
    });
    expect(canonicalize(shape(a))).toBe(canonicalize(shape(b)));
  });

  it("preserves provenance on every structured row, tracing to a source evidence item", async () => {
    const itemIds = new Set((await mod.repo.listEvidenceItems()).map((i) => i.id));
    const comms = await mod.repo.listCommunicationEvents();
    const txns = await mod.repo.listFinancialTransactions();
    const locs = await mod.repo.listLocations();

    for (const row of [...comms.slice(0, 25), ...txns.slice(0, 25), ...locs]) {
      expect(row.provenance.source).toMatch(/^evidence_item_/);
      expect(itemIds.has(row.provenance.source)).toBe(true);
      expect(row.provenance.method).toMatch(/^corpus-projection:/);
      expect(row.provenance.confidence).toBeGreaterThanOrEqual(0);
      expect(row.provenance.confidence).toBeLessThanOrEqual(1);
      expect(row.provenance.processingHistory.length).toBeGreaterThan(0);
      expect(row.provenance.timestamp).toBe(CORPUS_GENERATED_AT);
    }
  });

  it("keeps source evidence as accepted and never labels ingestion output as AI inference", async () => {
    const items = await mod.repo.listEvidenceItems();
    expect(items.every((i) => i.validationStatus === "accepted")).toBe(true);

    expect(await mod.repo.listRelationships()).toHaveLength(0);
    expect(await mod.repo.listAnalyticalSignals()).toHaveLength(0);
    expect(await mod.repo.listAIInferences()).toHaveLength(0);
    expect(await mod.repo.listInvestigativeLeads()).toHaveLength(0);

    const structured = JSON.stringify([
      await mod.repo.listCommunicationEvents(),
      await mod.repo.listFinancialTransactions(),
      await mod.repo.listLocations(),
    ]);
    expect(structured).not.toContain('"classification":"ai_inference"');
    expect(structured).not.toContain('"classification":"algorithmic_signal"');
  });

  it("investigation state exposes no ground-truth / expected-answer content", async () => {
    const state = await mod.getInvestigationState();
    const blob = JSON.stringify(state);
    for (const key of GROUND_TRUTH_KEYS) expect(blob.includes(key)).toBe(false);
  });

  it("repeated ingestion is idempotent — recognized as already ingested, nothing written", async () => {
    const second = await mod.runIngestion({ kind: "builtin-corpus" });
    expect(second.status).toBe("already_ingested");
    const persistStage = second.stages.find((s) => s.stage === "persistence");
    expect(persistStage?.status).toBe("skipped");
    expect(second.counts).toMatchObject(EXPECTED_COUNTS);

    const third = await mod.runIngestion({ kind: "builtin-corpus" });
    expect(third.status).toBe("already_ingested");
  });

  it("row-level idempotency holds independently of the completion marker", async () => {
    const before = await mod.getInvestigationState();
    const outcome = await mod.idempotentPersist(loadInvestigationCorpus());
    expect(outcome).toEqual({ created: 0, skipped: TOTAL_ROWS });
    const after = await mod.getInvestigationState();
    expect(JSON.stringify(after)).toBe(JSON.stringify(before));
  });
});

// ---------------------------------------------------------------------------
// Block B — structured errors & ground-truth isolation
// ---------------------------------------------------------------------------

describe("evidence ingestion — structured errors", () => {
  const DB = "./data/netintel-ingest-B.db";
  let mod: IngestionModule;

  beforeAll(async () => {
    mod = await freshIngestion(DB);
  });
  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB + s, { force: true });
  });

  const fail = async (source: IngestionSourceInput) => {
    const result = await mod.runIngestion(source);
    expect(result.status).toBe("failed");
    expect(result.error).not.toBeNull();
    return result.error!;
  };

  it("rejects a non-object payload as INVALID_FIXTURE", async () => {
    const err = await fail({ kind: "uploaded", contents: "not a corpus" });
    expect(err.code).toBe("INVALID_FIXTURE");
  });

  it("rejects an array payload as INVALID_FIXTURE", async () => {
    const err = await fail({ kind: "uploaded", contents: [1, 2, 3] });
    expect(err.code).toBe("INVALID_FIXTURE");
  });

  it("rejects a held-out ground-truth answer key as GROUND_TRUTH_REJECTED", async () => {
    const err = await fail({ kind: "uploaded", contents: generateGroundTruth() });
    expect(err.code).toBe("GROUND_TRUTH_REJECTED");
    expect(err.stage).toBe("file_validation");
    expect((err.issues ?? []).join(" ")).toMatch(/ground-truth-only field/);
    expect(await mod.repo.listInvestigations()).toHaveLength(0);
  });

  it("rejects a schema-invalid corpus as MALFORMED_EVIDENCE with issues", async () => {
    const err = await fail({
      kind: "uploaded",
      contents: {
        corpus: {
          name: "operation-darknet-delhi",
          version: "1.0.0",
          seed: 1,
          generatedAt: "2026-01-01T00:00:00.000Z",
          description: "x",
        },
        investigation: { name: "x", status: "in_progress" },
        evidenceSources: [{ key: "s", sourceType: "document", label: "l" }],
        evidenceItems: [],
        locations: [],
        communicationEvents: [],
        financialTransactions: [],
      },
    });
    expect(err.code).toBe("MALFORMED_EVIDENCE");
    expect(err.issues && err.issues.length).toBeGreaterThan(0);
  });

  it("rejects an unknown evidence item type as UNSUPPORTED_EVIDENCE_TYPE", async () => {
    const manifest = JSON.parse(
      fs.readFileSync(
        path.join(process.cwd(), "evidence", "synthetic", `${CORPUS_NAME}.json`),
        "utf-8",
      ),
    ) as { evidenceItems: { itemType: string }[] };
    manifest.evidenceItems[0]!.itemType = "totally_bogus_type";
    const err = await fail({ kind: "uploaded", contents: manifest });
    expect(err.code).toBe("UNSUPPORTED_EVIDENCE_TYPE");
    expect((err.issues ?? []).join(" ")).toMatch(/itemType/);
  });

  it("never surfaces a stack trace, filesystem path, or raw error to the user", async () => {
    for (const source of [
      { kind: "uploaded", contents: "x" } as const,
      { kind: "uploaded", contents: generateGroundTruth() } as const,
      { kind: "uploaded", contents: { corpus: {}, evidenceItems: 5 } } as const,
    ]) {
      const err = await fail(source);
      expect(isUserSafeMessage(err.message)).toBe(true);
      for (const issue of err.issues ?? []) expect(isUserSafeMessage(issue)).toBe(true);
    }
  });

  it("leaves the database untouched after every rejected ingestion", async () => {
    expect(await mod.repo.listInvestigations()).toHaveLength(0);
    expect(await mod.repo.listEvidenceItems()).toHaveLength(0);
    const state = await mod.getInvestigationState();
    expect(state.status).toBe("empty");
  });

  it("no ingestion module imports the ground-truth loader or points a path at evidence/ground-truth", () => {
    const dir = path.join(process.cwd(), "src/lib/ingestion");
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      // Strip comments — a doc comment that *explains* the boundary is
      // fine, and the word "ground-truth" also legitimately appears in
      // the GROUND_TRUTH_REJECTED user message. What must never appear
      // in actual code: an import of the ground-truth loader, or a path
      // segment addressing the held-out directory.
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

  it("the built-in corpus path points into evidence/synthetic, never ground-truth", async () => {
    const { BUILTIN_CORPUS_RELATIVE_PATH } = await import("@/lib/ingestion/source");
    expect(BUILTIN_CORPUS_RELATIVE_PATH).toContain(path.join("evidence", "synthetic"));
    expect(BUILTIN_CORPUS_RELATIVE_PATH).not.toContain("ground-truth");
  });
});

// ---------------------------------------------------------------------------
// Block C — persistence errors are structured, safe, and non-throwing
// ---------------------------------------------------------------------------

describe("evidence ingestion — persistence errors are structured and safe", () => {
  const DB = "./data/netintel-ingest-C.db";
  let mod: IngestionModule;

  beforeAll(async () => {
    mod = await freshIngestion(DB);
  });
  afterAll(() => {
    for (const s of ["", "-wal", "-shm"]) fs.rmSync(DB + s, { force: true });
  });

  /** A LoadedCorpus with one row the repository's Zod guard will reject. */
  function corpusWithABadRow() {
    const loaded = loadInvestigationCorpus();
    const firstLocation = loaded.locations[0]!;
    return {
      investigation: { ...loaded.investigation, id: makeOpaqueId("investigation") },
      evidenceSources: [] as typeof loaded.evidenceSources,
      evidenceItems: [] as typeof loaded.evidenceItems,
      communicationEvents: [] as typeof loaded.communicationEvents,
      financialTransactions: [] as typeof loaded.financialTransactions,
      // latitude outside [-90, 90] → LocationSchema rejects it mid-persist.
      locations: [{ ...firstLocation, latitude: 999 }],
      counts: loaded.counts,
    };
  }

  it("idempotentPersist wraps a rejected row insert as a safe PERSISTENCE_FAILURE", async () => {
    let caught: unknown;
    try {
      await mod.idempotentPersist(corpusWithABadRow());
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const e = caught as { name: string; code: string; stage: string; message: string; issues?: unknown };
    expect(e.name).toBe("IngestionServiceError");
    expect(e.code).toBe("PERSISTENCE_FAILURE");
    expect(e.stage).toBe("persistence");
    expect(e.issues).toBeUndefined();
    expect(e.message.startsWith("Writing evidence")).toBe(true);
    expect(isUserSafeMessage(e.message)).toBe(true);
  });

  it("runIngestion always resolves — an internal failure never throws to the caller", async () => {
    await expect(
      mod.runIngestion({ kind: "uploaded", contents: 123 }),
    ).resolves.toMatchObject({ status: "failed", error: { code: "INVALID_FIXTURE" } });
  });
});
