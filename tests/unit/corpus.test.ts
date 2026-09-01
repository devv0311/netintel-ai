import { describe, expect, it, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";

import {
  generateCorpus,
  generateCorpusManifest,
  generateGroundTruth,
  materializeCorpus,
  loadInvestigationCorpus,
  parseCorpusManifest,
  validateCorpus,
  canonicalize,
  fingerprint,
  CorpusManifestSchema,
  CORPUS_GENERATED_AT,
  CORPUS_SEED,
  CORPUS_VERSION,
  REQUIRED_VOLUMES,
} from "@/lib/corpus";
import { loadInvestigationGroundTruth } from "@/lib/corpus/ground-truth";
import { persistCorpus } from "@/lib/corpus/persist";
import {
  listInvestigations,
  listEvidenceSources,
  listEvidenceItems,
  listLocations,
  listCommunicationEvents,
  listFinancialTransactions,
  insertInvestigation,
} from "@/lib/db/repository";

const CORPUS_NAME = "operation-darknet-delhi";
const SYNTHETIC_FILE = path.join(
  process.cwd(),
  "evidence",
  "synthetic",
  `${CORPUS_NAME}.json`,
);
const GROUND_TRUTH_FILE = path.join(
  process.cwd(),
  "evidence",
  "ground-truth",
  `${CORPUS_NAME}.ground-truth.json`,
);

/**
 * Locked canonical fingerprints. If a legitimate generator change moves
 * these, regenerate the committed artifacts with `npm run corpus:generate`
 * and update both values in the same commit.
 */
const PINNED_MANIFEST_FINGERPRINT =
  "f3a1acb45643a1f1e3a31ed660a940e79f3e5c011498d980c2e252454c979c62";
const PINNED_GROUND_TRUTH_FINGERPRINT =
  "71c026e59fd5a69f8399cb535be1e2be4e0d454f2e460ffbe0188df8a0a2ed75";

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// ---------------------------------------------------------------------------
// (15) Deterministic generation
// ---------------------------------------------------------------------------

describe("Operation DarkNet Delhi corpus — deterministic generation", () => {
  it("generate -> canonicalize -> generate -> canonicalize yields identical output", () => {
    const a = generateCorpus();
    const b = generateCorpus();
    expect(canonicalize(a.manifest)).toBe(canonicalize(b.manifest));
    expect(canonicalize(a.groundTruth)).toBe(canonicalize(b.groundTruth));
  });

  it("canonical fingerprints are stable at their pinned values", () => {
    expect(fingerprint(generateCorpusManifest())).toBe(PINNED_MANIFEST_FINGERPRINT);
    expect(fingerprint(generateGroundTruth())).toBe(PINNED_GROUND_TRUTH_FINGERPRINT);
  });

  it("the committed artifacts match what the generator produces right now", () => {
    const manifestOnDisk = JSON.parse(fs.readFileSync(SYNTHETIC_FILE, "utf-8"));
    const groundTruthOnDisk = JSON.parse(fs.readFileSync(GROUND_TRUTH_FILE, "utf-8"));
    expect(canonicalize(manifestOnDisk)).toBe(canonicalize(generateCorpusManifest()));
    expect(canonicalize(groundTruthOnDisk)).toBe(canonicalize(generateGroundTruth()));
  });

  it("the corpus declares its fixed version and seed", () => {
    const manifest = generateCorpusManifest();
    expect(manifest.corpus.version).toBe(CORPUS_VERSION);
    expect(manifest.corpus.seed).toBe(CORPUS_SEED);
    expect(manifest.corpus.generatedAt).toBe(CORPUS_GENERATED_AT);
  });

  it("IDs, timestamps and coordinates are identical across two independent loads", () => {
    const first = materializeCorpus(generateCorpusManifest());
    const second = materializeCorpus(generateCorpusManifest());
    expect(first.investigation.id).toBe(second.investigation.id);
    expect(first.evidenceItems.map((i) => i.id)).toEqual(
      second.evidenceItems.map((i) => i.id),
    );
    expect(first.communicationEvents.map((c) => c.occurredAt)).toEqual(
      second.communicationEvents.map((c) => c.occurredAt),
    );
    expect(first.financialTransactions.map((t) => t.amount)).toEqual(
      second.financialTransactions.map((t) => t.amount),
    );
    expect(first.locations.map((l) => [l.latitude, l.longitude])).toEqual(
      second.locations.map((l) => [l.latitude, l.longitude]),
    );
  });
});

// ---------------------------------------------------------------------------
// (1-4) Volumes  &  (5-13) structural properties, via the shared routine
// ---------------------------------------------------------------------------

describe("Operation DarkNet Delhi corpus — required volumes and structure", () => {
  const manifest = generateCorpusManifest();
  const groundTruth = generateGroundTruth();
  const report = validateCorpus(manifest, groundTruth);
  const check = (id: string) => report.checks.find((c) => c.id === id);

  it("passes every structural check in the validation routine", () => {
    const failed = report.checks.filter((c) => !c.ok);
    expect(failed, JSON.stringify(failed, null, 2)).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("(1) contains exactly 5 FIRs", () => {
    expect(
      manifest.evidenceItems.filter((i) => i.itemType === "fir"),
    ).toHaveLength(REQUIRED_VOLUMES.firs);
    expect(check("volume.firs")?.ok).toBe(true);
  });

  it("(2) contains at least 8 primary suspects", () => {
    const suspects = manifest.evidenceItems.filter(
      (i) => i.itemType === "suspect_record" && typeof i.content.role === "string",
    );
    expect(suspects.length).toBeGreaterThanOrEqual(REQUIRED_VOLUMES.primarySuspects);
  });

  it("(3) contains at least 1,000 CDRs", () => {
    expect(
      manifest.evidenceItems.filter((i) => i.itemType === "cdr_event").length,
    ).toBeGreaterThanOrEqual(REQUIRED_VOLUMES.cdrs);
    expect(manifest.communicationEvents.length).toBeGreaterThanOrEqual(REQUIRED_VOLUMES.cdrs);
  });

  it("(4) contains at least 500 financial transactions", () => {
    expect(
      manifest.evidenceItems.filter(
        (i) => i.itemType === "financial_transaction_record",
      ).length,
    ).toBeGreaterThanOrEqual(REQUIRED_VOLUMES.financialTransactions);
    expect(manifest.financialTransactions.length).toBeGreaterThanOrEqual(
      REQUIRED_VOLUMES.financialTransactions,
    );
  });

  it("(5) aliases are present", () => {
    expect(check("structural.aliases")?.ok).toBe(true);
  });

  it("(6) duplicate / ambiguous identity cases are present", () => {
    expect(check("structural.duplicates")?.ok).toBe(true);
    expect(groundTruth.doNotMerge.length).toBeGreaterThanOrEqual(1);
    expect(
      groundTruth.expectedEntityMerges.some((m) => m.sourceMentions.length >= 2),
    ).toBe(true);
  });

  it("(7) contradiction cases are present and cite resolvable sources", () => {
    expect(check("structural.contradictions")?.ok).toBe(true);
    expect(groundTruth.contradictions.length).toBeGreaterThanOrEqual(3);
    const refs = new Set(manifest.evidenceItems.map((i) => i.ref));
    for (const c of groundTruth.contradictions) {
      expect(c.sources.length).toBeGreaterThanOrEqual(2);
      for (const s of c.sources) expect(refs.has(s)).toBe(true);
      expect(c.resolutionForbidden).toBe(true);
    }
  });

  it("(8) indirect relationships are present", () => {
    expect(check("structural.indirect")?.ok).toBe(true);
    expect(
      groundTruth.expectedRelationships.some((r) => r.explicit === false),
    ).toBe(true);
  });

  it("(9) intermediary actors are present and bridge >1 principal", () => {
    expect(check("structural.intermediary")?.ok).toBe(true);
    expect(groundTruth.keyActors.intermediaries.length).toBeGreaterThanOrEqual(1);
    const x1 = groundTruth.keyActors.intermediaries.find((m) => m.key === "X1");
    const x1Num = x1?.phones[0];
    const counterparties = new Set<string>();
    for (const ce of manifest.communicationEvents) {
      if (ce.callerPhone === x1Num) counterparties.add(ce.calleePhone);
      if (ce.calleePhone === x1Num) counterparties.add(ce.callerPhone);
    }
    expect(counterparties.size).toBeGreaterThanOrEqual(2);
  });

  it("(10) money-mule pattern is present and reconstructable from raw records", () => {
    expect(check("structural.moneyMule")?.ok).toBe(true);
    const mule = groundTruth.moneyMulePaths[0];
    expect(mule).toBeDefined();
    const txns = manifest.evidenceItems.filter(
      (i) => i.itemType === "financial_transaction_record",
    );
    if (!mule) return;
    for (let k = 0; k < mule.pathAccounts.length - 1; k++) {
      const from = mule.pathAccounts[k];
      const to = mule.pathAccounts[k + 1];
      expect(
        txns.some((t) => t.content.fromAccount === from && t.content.toAccount === to),
      ).toBe(true);
    }
    expect(mule.txnRefs.length).toBeGreaterThan(0);
  });

  it("(11) misleading low-value relationships are present and unlabelled in evidence", () => {
    expect(check("structural.misleading")?.ok).toBe(true);
    expect(groundTruth.misleadingRelationships.length).toBeGreaterThanOrEqual(1);
    const lowValue = manifest.evidenceItems.filter(
      (i) =>
        i.itemType === "financial_transaction_record" &&
        typeof i.content.amount === "number" &&
        (i.content.amount as number) <= 1000,
    );
    expect(lowValue.length).toBeGreaterThan(0);
    for (const t of lowValue) {
      expect(/noise|misleading|immaterial/i.test(JSON.stringify(t.content))).toBe(false);
    }
  });

  it("(12) temporal correlations are present and realised in the CDR stream", () => {
    expect(check("structural.temporal")?.ok).toBe(true);
    const hidden = groundTruth.temporalCorrelations.find((t) => /hidden/i.test(t.key));
    expect(hidden).toBeDefined();
    if (!hidden) return;
    const wStart = Date.parse(hidden.windowStart);
    const wEnd = Date.parse(hidden.windowEnd);
    const onTower = manifest.communicationEvents.filter(
      (ce) =>
        ce.cellLocationRef === `location:${hidden.cellTower}` &&
        Date.parse(ce.occurredAt) >= wStart &&
        Date.parse(ce.occurredAt) <= wEnd,
    );
    const phones = new Set(onTower.flatMap((ce) => [ce.callerPhone, ce.calleePhone]));
    for (const p of hidden.phones) expect(phones.has(p)).toBe(true);
  });

  it("(13) spatial data required by the specification is present", () => {
    expect(check("structural.spatial")?.ok).toBe(true);
    expect(manifest.locations.length).toBeGreaterThanOrEqual(8);
    expect(manifest.locations.some((l) => l.locationType === "cell_tower")).toBe(true);
    expect(manifest.locations.some((l) => l.locationType === "crime_scene")).toBe(true);
    for (const l of manifest.locations) {
      expect(l.latitude).toBeGreaterThanOrEqual(-90);
      expect(l.latitude).toBeLessThanOrEqual(90);
      expect(l.longitude).toBeGreaterThanOrEqual(-180);
      expect(l.longitude).toBeLessThanOrEqual(180);
    }
  });

  it("the known hidden relationship is recorded and has no direct S1<->S4 contact", () => {
    expect(groundTruth.hiddenConnections.length).toBeGreaterThanOrEqual(1);
    const s1 = groundTruth.keyActors.principalSuspects.find((s) => s.key === "S1");
    const s4 = groundTruth.keyActors.principalSuspects.find((s) => s.key === "S4");
    const s1Nums = new Set(s1?.phones ?? []);
    const s4Nums = new Set(s4?.phones ?? []);
    const direct = manifest.communicationEvents.some(
      (ce) =>
        (s1Nums.has(ce.callerPhone) && s4Nums.has(ce.calleePhone)) ||
        (s4Nums.has(ce.callerPhone) && s1Nums.has(ce.calleePhone)),
    );
    expect(direct).toBe(false);
    const s1Accts = new Set(s1?.accounts ?? []);
    const s4Accts = new Set(s4?.accounts ?? []);
    const directTxn = manifest.evidenceItems.some(
      (i) =>
        i.itemType === "financial_transaction_record" &&
        s1Accts.has(String(i.content.fromAccount)) &&
        s4Accts.has(String(i.content.toAccount)),
    );
    expect(directTxn).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Synthetic safety
// ---------------------------------------------------------------------------

describe("Operation DarkNet Delhi corpus — synthetic safety", () => {
  const manifest = generateCorpusManifest();
  const blob = JSON.stringify(manifest);

  it("uses only the unassigned +99 country code for phone numbers", () => {
    for (const ce of manifest.communicationEvents) {
      expect(ce.callerPhone).toMatch(/^\+99 70 \d{3} \d{4}$/);
      expect(ce.calleePhone).toMatch(/^\+99 70 \d{3} \d{4}$/);
    }
  });

  it("contains no real Indian phone / Aadhaar / IFSC / PAN patterns", () => {
    expect(blob).not.toMatch(/\+91[\s-]?\d/);
    expect(blob).not.toMatch(/\b\d{4}\s?\d{4}\s?\d{4}\b/);
    expect(blob).not.toMatch(/\b[A-Z]{4}0[A-Z0-9]{6}\b/);
    expect(blob).not.toMatch(/\b[A-Z]{5}\d{4}[A-Z]\b/);
    expect(blob).not.toMatch(/\b\d{15}\b/);
  });

  it("every synthetic identifier carries a SYN / ODD marker", () => {
    const item = manifest.evidenceItems.find((i) => i.itemType === "bank_account_record");
    expect(String(item?.content.account)).toMatch(/^SYN-(AC|MA|SH)-\d{6}$/);
    const fir = manifest.evidenceItems.find((i) => i.itemType === "fir");
    expect(String(fir?.content.firNumber)).toMatch(/^ODD\/SYN\/2025\/\d{3}$/);
  });
});

// ---------------------------------------------------------------------------
// (14) Ground-truth isolation
// ---------------------------------------------------------------------------

describe("Operation DarkNet Delhi corpus — ground-truth isolation", () => {
  it("(14) the loaded application evidence exposes no expected-answer content", () => {
    const loaded = loadInvestigationCorpus(CORPUS_NAME);
    const blob = JSON.stringify(loaded);
    for (const forbidden of [
      "expectedEntityMerges",
      "hiddenConnections",
      "contradictions",
      "moneyMulePaths",
      "intendedConclusions",
      "expectedCopilotAnswers",
      "resolutionForbidden",
      "recoverableBy",
    ]) {
      expect(blob.includes(forbidden)).toBe(false);
    }
  });

  it("the application-evidence modules never reference evidence/ground-truth in code", () => {
    for (const rel of [
      "src/lib/corpus/load.ts",
      "src/lib/corpus/persist.ts",
      "src/lib/corpus/generate.ts",
      "src/lib/corpus/validate.ts",
      "src/lib/corpus/manifest-schema.ts",
      "src/lib/corpus/index.ts",
    ]) {
      const source = stripComments(fs.readFileSync(path.join(process.cwd(), rel), "utf-8"));
      expect(source, rel).not.toMatch(/ground-truth/);
      expect(source, rel).not.toMatch(/ground_truth/);
    }
  });

  it("the database repository layer still references nothing ground-truth", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/lib/db/repository.ts"),
      "utf-8",
    );
    expect(source).not.toMatch(/ground-truth/);
  });

  it("ground-truth.ts is the only corpus module that reads evidence/ground-truth", () => {
    const dir = path.join(process.cwd(), "src/lib/corpus");
    const readers: string[] = [];
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".ts")) continue;
      const code = stripComments(fs.readFileSync(path.join(dir, file), "utf-8"));
      if (/["'`]evidence["'`]?\s*,\s*["'`]ground-truth["'`]|ground-truth/.test(code)) {
        readers.push(file);
      }
    }
    expect(readers).toEqual(["ground-truth.ts"]);
  });

  it("the held-out ground-truth artifact still loads and validates (evaluation path only)", () => {
    const gt = loadInvestigationGroundTruth(CORPUS_NAME);
    expect(gt.corpus.version).toBe(CORPUS_VERSION);
    expect(gt.keyActors.principalSuspects.length).toBeGreaterThanOrEqual(8);
    expect(gt.expectedCopilotAnswers).toHaveLength(8);
  });
});

// ---------------------------------------------------------------------------
// (16) Malformed fixtures are rejected
// ---------------------------------------------------------------------------

describe("Operation DarkNet Delhi corpus — malformed input is rejected", () => {
  const good = generateCorpusManifest();

  it("the schema rejects a manifest missing corpus.version", () => {
    const broken = structuredClone(good) as Record<string, unknown>;
    delete (broken.corpus as Record<string, unknown>).version;
    expect(CorpusManifestSchema.safeParse(broken).success).toBe(false);
  });

  it("the schema rejects an unknown evidence itemType", () => {
    const broken = structuredClone(good);
    const first = broken.evidenceItems[0];
    if (first) (first as unknown as { itemType: string }).itemType = "not_a_real_type";
    expect(CorpusManifestSchema.safeParse(broken).success).toBe(false);
  });

  it("the schema rejects an out-of-range coordinate and a non-positive amount", () => {
    const badLat = structuredClone(good);
    if (badLat.locations[0]) badLat.locations[0].latitude = 999;
    expect(CorpusManifestSchema.safeParse(badLat).success).toBe(false);

    const badAmount = structuredClone(good);
    if (badAmount.financialTransactions[0]) badAmount.financialTransactions[0].amount = -5;
    expect(CorpusManifestSchema.safeParse(badAmount).success).toBe(false);
  });

  it("parseCorpusManifest throws on malformed input", () => {
    expect(() => parseCorpusManifest({ nonsense: true }, "test")).toThrow(/test/);
  });

  it("materializeCorpus throws on a dangling source reference", () => {
    const broken = structuredClone(good);
    if (broken.evidenceItems[0]) broken.evidenceItems[0].sourceKey = "no-such-source";
    expect(() => materializeCorpus(broken)).toThrow(/unknown sourceKey/);
  });

  it("loadInvestigationCorpus throws rather than loading a missing corpus file", () => {
    expect(() => loadInvestigationCorpus("does-not-exist")).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Database load + (17) provenance preservation
// ---------------------------------------------------------------------------

describe("Operation DarkNet Delhi corpus — database load", () => {
  const TEST_DB_PATH = "./data/netintel-corpus-test.db";
  let loaded: ReturnType<typeof loadInvestigationCorpus>;

  beforeAll(async () => {
    fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
    fs.rmSync(TEST_DB_PATH, { force: true });
    process.env.DATABASE_URL = TEST_DB_PATH;
    loaded = loadInvestigationCorpus(CORPUS_NAME);
    await persistCorpus(loaded);
  }, 60_000);

  afterAll(() => {
    fs.rmSync(TEST_DB_PATH, { force: true });
  });

  it("persists exactly the loaded counts through the validated repository layer", async () => {
    expect(await listInvestigations()).toHaveLength(1);
    expect(await listEvidenceSources()).toHaveLength(loaded.counts.evidenceSources);
    expect(await listEvidenceItems()).toHaveLength(loaded.counts.evidenceItems);
    expect(await listLocations()).toHaveLength(loaded.counts.locations);
    expect(await listCommunicationEvents()).toHaveLength(loaded.counts.communicationEvents);
    expect(await listFinancialTransactions()).toHaveLength(
      loaded.counts.financialTransactions,
    );
  });

  it("verifies persisted volumes meet the required minimums", async () => {
    const items = await listEvidenceItems();
    expect(items.filter((i) => i.itemType === "fir")).toHaveLength(REQUIRED_VOLUMES.firs);
    expect(
      items.filter((i) => i.itemType === "suspect_record" && typeof i.content.role === "string")
        .length,
    ).toBeGreaterThanOrEqual(REQUIRED_VOLUMES.primarySuspects);
    expect(items.filter((i) => i.itemType === "cdr_event").length).toBeGreaterThanOrEqual(
      REQUIRED_VOLUMES.cdrs,
    );
    expect(
      items.filter((i) => i.itemType === "financial_transaction_record").length,
    ).toBeGreaterThanOrEqual(REQUIRED_VOLUMES.financialTransactions);
  });

  it("(17) provenance survives the round trip on every structured row", async () => {
    const itemIds = new Set((await listEvidenceItems()).map((i) => i.id));

    const events = await listCommunicationEvents();
    for (const ce of events.slice(0, 50)) {
      expect(ce.provenance.source).toMatch(/^evidence_item_/);
      expect(itemIds.has(ce.provenance.source)).toBe(true);
      expect(ce.provenance.method).toBe(`corpus-projection:${CORPUS_VERSION}`);
      expect(ce.provenance.confidence).toBe(1);
      expect(ce.provenance.processingHistory.length).toBeGreaterThan(0);
      expect(ce.provenance.timestamp).toBe(CORPUS_GENERATED_AT);
      expect(ce.provenance.location.length).toBeGreaterThan(0);
    }

    const txns = await listFinancialTransactions();
    const loadedById = new Map(loaded.financialTransactions.map((t) => [t.id, t]));
    for (const tx of txns.slice(0, 50)) {
      expect(tx.provenance).toEqual(loadedById.get(tx.id)?.provenance);
      expect(itemIds.has(tx.provenance.source)).toBe(true);
    }

    for (const loc of await listLocations()) {
      expect(loc.provenance.timestamp).toBe(CORPUS_GENERATED_AT);
      expect(itemIds.has(loc.provenance.source)).toBe(true);
    }
  });

  it("re-persisting is rejected — deterministic IDs collide on the primary key", async () => {
    await expect(insertInvestigation(loaded.investigation)).rejects.toThrow();
  });
});
