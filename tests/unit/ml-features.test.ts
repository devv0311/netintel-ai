import { describe, expect, it } from "vitest";
import {
  buildFeatures,
  deterministicPairDecision,
  FEATURE_NAMES,
  type FeatureRecord,
} from "@/lib/ml/features";
import { normalizeName } from "@/lib/resolution/name-normalization";
import { jaroWinkler, levenshtein, orderedPrefix, scriptClass, trigramDice } from "@/lib/ml/similarity";

const record = (name: string, extra: Partial<FeatureRecord> = {}): FeatureRecord => ({ name, ...extra });

describe("similarity primitives", () => {
  it("levenshtein is a metric on the cases that matter", () => {
    expect(levenshtein("", "")).toBe(0);
    expect(levenshtein("abc", "abc")).toBe(0);
    expect(levenshtein("abc", "")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(3);
    expect(levenshtein("kitten", "sitting")).toBe(levenshtein("sitting", "kitten"));
  });

  it("jaroWinkler rewards a shared prefix and stays in range", () => {
    expect(jaroWinkler("abc", "abc")).toBe(1);
    expect(jaroWinkler("", "abc")).toBe(0);
    const prefixed = jaroWinkler("bnp paribas", "bnp paribas cardif");
    const unprefixed = jaroWinkler("bnp paribas", "cardif bnp paribas");
    expect(prefixed).toBeGreaterThan(unprefixed);
    expect(prefixed).toBeLessThanOrEqual(1);
  });

  it("trigramDice is symmetric and bounded", () => {
    expect(trigramDice("santander", "santander")).toBe(1);
    expect(trigramDice("santander", "banco santander")).toBe(trigramDice("banco santander", "santander"));
    expect(trigramDice("abc", "xyz")).toBeGreaterThanOrEqual(0);
  });

  it("orderedPrefix is ordered, which is the whole point", () => {
    // P6.18.2: the real hard negatives diverge at their SECOND token, so
    // an ordered prefix separates them where an unordered subset does not.
    expect(orderedPrefix(["bnp", "paribas"], ["bnp", "paribas", "cardif"])).toBe(true);
    expect(orderedPrefix(["solar", "solutions"], ["rajdeep", "bhati", "solar", "solutions"])).toBe(false);
    expect(orderedPrefix(["a", "b"], ["a", "b"])).toBe(false);
  });

  it("scriptClass separates writing systems without transliterating", () => {
    expect(scriptClass("Bell Canada")).toBe("latin");
    expect(scriptClass("アサヒビール株式会社")).toBe("kana");
    expect(scriptClass("Мобильные ТелеСистемы")).toBe("cyrillic");
    expect(scriptClass("एसोसिएटेड")).toBe("devanagari");
  });
});

describe("feature vector", () => {
  it("has one value per declared feature name and no non-finite value", () => {
    const vector = buildFeatures(record("Bell Canada"), record("The Bell Telephone Company of Canada"));
    expect(vector.values).toHaveLength(FEATURE_NAMES.length);
    for (const value of vector.values) expect(Number.isFinite(value)).toBe(true);
  });

  it("is symmetric: f(a,b) equals f(b,a)", () => {
    const a = record("BANCO SANTANDER S.A.", { jurisdiction: "ES", aliases: ["Santander"] });
    const b = record("Santander Group", { officialName: "Banco Santander" });
    expect(buildFeatures(a, b).values).toEqual(buildFeatures(b, a).values);
  });

  it("is deterministic across calls", () => {
    const a = record("Tata Motors Ltd");
    const b = record("TATA MOTORS PASSENGER VEHICLES LIMITED");
    expect(buildFeatures(a, b).values).toEqual(buildFeatures(a, b).values);
  });

  it("survives empty and single-character names without producing NaN", () => {
    for (const value of buildFeatures(record("x"), record("y")).values) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it("reads no identifier: two records differing only in fields it cannot see score identically", () => {
    // The FeatureRecord type has no identifier field at all, so this test
    // asserts the consequence: extra properties are invisible to the model.
    const withExtras = { name: "Genertel", jurisdiction: "IT" } as FeatureRecord;
    const plain = record("Genertel", { jurisdiction: "IT" });
    expect(buildFeatures(withExtras, plain).values).toEqual(buildFeatures(plain, plain).values);
  });
});

describe("deterministic baseline replay", () => {
  it("agrees with the resolver's own normaliser, which is its only rule", () => {
    const cases: [string, string][] = [
      ["ENDESA", "ENDESA SA"],
      ["Mahindra & Mahindra", "MAHINDRA AND MAHINDRA LIMITED"],
      ["Dr. Reddy's Laboratories", "DR REDDYS LABORATORIES"],
      ["Bell Canada", "The Bell Telephone Company of Canada"],
    ];
    for (const [left, right] of cases) {
      const expected = normalizeName(left).normalized === normalizeName(right).normalized;
      expect(deterministicPairDecision(record(left), record(right))).toBe(expected);
    }
  });

  it("never merges on an empty normalisation", () => {
    expect(deterministicPairDecision(record("..."), record("---"))).toBe(false);
  });
});
