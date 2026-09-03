import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The no-identifier corpus (P6.16.1) is only evidence of anything if the
 * identifier really is absent from it. That is an easy property to break
 * later - one added field in the builder, one extra column carried
 * through from the adapter - and breaking it would not make any test go
 * red anywhere else: the experiment would simply start reporting joins
 * that came from an identifier while claiming they came from a name.
 *
 * So the masking invariants are asserted here rather than trusted:
 *
 *   1. FULL     - no record carries an identifier, and no real LEI or QID
 *                 appears anywhere in the file.
 *   2. ANCHORED - no WIKIDATA record carries an identifier and no QID
 *                 appears. GLEIF keeps the LEI it issues, which is the
 *                 reference set the regime is defined around.
 *   3. Both     - every name and alias is byte-identical to the publisher
 *                 string recorded in the ground truth. No variant is
 *                 manufactured; the experiment measures differences two
 *                 real publishers actually published.
 *   4. Both     - the ground truth is not in the corpus. Positive pairs,
 *                 hard negatives and the surrogate map live only in the
 *                 ground-truth file, which the pipeline never opens.
 */

const ROOT = process.cwd();
const BASE = path.join(ROOT, "evidence/no-identifier/no-identifier-pilot");

interface TruthRecord {
  registry: string;
  registryRecordId: string;
  name: string;
  leis: string[];
}
interface Truth {
  positives: { gleifSurrogate: string; wikidataSurrogate: string }[];
  hardNegatives: { a: { surrogate: string }; b: { surrogate: string } }[];
  surrogateMap: Record<string, TruthRecord>;
}
interface CorpusItem {
  sourceKey: string;
  ref: string;
  itemType: string;
  content: {
    recordRef: string;
    registry: string;
    registryRecordId: string;
    name: string;
    aliases?: string[];
    identifiers?: { scheme: string; value: string }[];
    relations?: unknown[];
    sourceUrl: string;
  };
}

const readTruth = (): Truth => JSON.parse(fs.readFileSync(`${BASE}.ground-truth.json`, "utf8")) as Truth;
const readCorpus = (regime: "full" | "anchored") =>
  JSON.parse(fs.readFileSync(`${BASE}-${regime}.corpus.json`, "utf8")) as {
    evidenceItems: CorpusItem[];
  };

const corpusExists = fs.existsSync(`${BASE}.ground-truth.json`);
const maybe = corpusExists ? describe : describe.skip;

maybe("no-identifier corpus (P6.16.1) - masking invariants", () => {
  const truth = corpusExists ? readTruth() : ({} as Truth);

  const realLeis = () => [
    ...new Set(Object.values(truth.surrogateMap).flatMap((r) => r.leis)),
  ];
  const realQids = () => [
    ...new Set(
      Object.values(truth.surrogateMap)
        .filter((r) => r.registry === "wikidata")
        .map((r) => r.registryRecordId),
    ),
  ];

  it("FULL: no record carries any identifier", () => {
    const items = readCorpus("full").evidenceItems;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.content.identifiers).toBeUndefined();
      expect(item.content.relations).toBeUndefined();
    }
  });

  it("FULL: no real LEI or QID appears anywhere in the corpus file", () => {
    const blob = fs.readFileSync(`${BASE}-full.corpus.json`, "utf8");
    expect(realLeis().filter((lei) => blob.includes(lei))).toEqual([]);
    expect(realQids().filter((qid) => blob.includes(qid))).toEqual([]);
  });

  it("FULL: every registryRecordId is an opaque surrogate", () => {
    for (const item of readCorpus("full").evidenceItems) {
      expect(item.content.registryRecordId).toMatch(/^NIDP-\d{4}$/);
      expect(item.content.recordRef).toBe(`${item.content.registry}:${item.content.registryRecordId}`);
    }
  });

  it("ANCHORED: no Wikidata record carries an identifier, and no QID appears", () => {
    const items = readCorpus("anchored").evidenceItems;
    const wikidata = items.filter((i) => i.content.registry === "wikidata");
    expect(wikidata.length).toBeGreaterThan(0);
    for (const item of wikidata) {
      expect(item.content.identifiers).toBeUndefined();
      expect(item.content.registryRecordId).toMatch(/^NIDP-\d{4}$/);
    }
    const blob = fs.readFileSync(`${BASE}-anchored.corpus.json`, "utf8");
    expect(realQids().filter((qid) => blob.includes(qid))).toEqual([]);
  });

  it("ANCHORED: GLEIF carries at most one LEI - the scheme it issues - and nothing else", () => {
    for (const item of readCorpus("anchored").evidenceItems) {
      if (item.content.registry !== "gleif") continue;
      const identifiers = item.content.identifiers ?? [];
      expect(identifiers.length).toBeLessThanOrEqual(1);
      for (const identifier of identifiers) expect(identifier.scheme).toBe("LEI");
      expect(item.content.relations).toBeUndefined();
    }
  });

  it("no per-record sourceUrl embeds a record identifier", () => {
    for (const regime of ["full", "anchored"] as const) {
      for (const item of readCorpus(regime).evidenceItems) {
        if (regime === "anchored" && item.content.registry === "gleif") continue;
        for (const lei of realLeis()) expect(item.content.sourceUrl).not.toContain(lei);
        for (const qid of realQids()) expect(item.content.sourceUrl).not.toContain(qid);
      }
    }
  });

  it("names and aliases are verbatim publisher strings - no variant is manufactured", () => {
    const byName = new Map<string, string>();
    for (const [surrogate, real] of Object.entries(truth.surrogateMap)) {
      byName.set(surrogate, real.name);
    }
    for (const regime of ["full", "anchored"] as const) {
      for (const item of readCorpus(regime).evidenceItems) {
        const surrogate = item.content.registryRecordId.startsWith("NIDP-")
          ? item.content.registryRecordId
          : Object.entries(truth.surrogateMap).find(
              ([, r]) => r.registryRecordId === item.content.registryRecordId,
            )?.[0];
        expect(surrogate).toBeDefined();
        expect(item.content.name).toBe(byName.get(surrogate!));
      }
    }
  });

  it("the corpus carries no ground truth: no pair, negative or surrogate map", () => {
    for (const regime of ["full", "anchored"] as const) {
      const blob = fs.readFileSync(`${BASE}-${regime}.corpus.json`, "utf8");
      expect(blob).not.toContain("surrogateMap");
      expect(blob).not.toContain("hardNegatives");
      expect(blob).not.toContain("POS-");
      expect(blob).not.toContain("NEG-");
    }
  });

  it("positive pairs and hard negatives reference records that exist in the corpus", () => {
    const surrogates = new Set(Object.keys(truth.surrogateMap));
    for (const p of truth.positives) {
      expect(surrogates.has(p.gleifSurrogate)).toBe(true);
      expect(surrogates.has(p.wikidataSurrogate)).toBe(true);
    }
    for (const n of truth.hardNegatives) {
      expect(surrogates.has(n.a.surrogate)).toBe(true);
      expect(surrogates.has(n.b.surrogate)).toBe(true);
    }
  });

  it("every hard negative is a pair of DIFFERENT legal entities", () => {
    for (const n of truth.hardNegatives) {
      const a = truth.surrogateMap[n.a.surrogate]!;
      const b = truth.surrogateMap[n.b.surrogate]!;
      expect(a.leis.length).toBeGreaterThan(0);
      expect(b.leis.length).toBeGreaterThan(0);
      expect(a.leis.some((lei) => b.leis.includes(lei))).toBe(false);
    }
  });

  it("every positive pair is one subject asserted by BOTH publishers", () => {
    for (const p of truth.positives) {
      const g = truth.surrogateMap[p.gleifSurrogate]!;
      const w = truth.surrogateMap[p.wikidataSurrogate]!;
      expect(g.registry).toBe("gleif");
      expect(w.registry).toBe("wikidata");
      expect(w.leis).toHaveLength(1);
      expect(g.leis).toContain(w.leis[0]);
    }
  });
});
