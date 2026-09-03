import { describe, expect, it } from "vitest";

import {
  LEGAL_SUFFIXES,
  describeNormalization,
  normalizeName,
  normalizedKey,
} from "@/lib/resolution/name-normalization";

/**
 * These tests are written against the REAL pairs P6.16 measured, not
 * against invented strings. Where a case is a made-up edge case it says
 * so; where it is a real publisher pair, the two names are the ones
 * GLEIF and Wikidata actually published.
 *
 * The hard-negative assertions matter as much as the positive ones: the
 * whole risk of normalisation is that it merges things it should not,
 * and the 19 hard negatives in the no-identifier corpus exist to catch
 * exactly that.
 */

describe("normalizeName - the four approved rules", () => {
  it("folds case (24 of 75 real pairs differ only in this)", () => {
    expect(normalizedKey("STATE BANK OF INDIA")).toBe(normalizedKey("State Bank of India"));
    expect(normalizedKey("ITC LIMITED")).toBe(normalizedKey("ITC Limited"));
    expect(normalizedKey("MOSCHIP TECHNOLOGIES LIMITED")).toBe(
      normalizedKey("MosChip Technologies Limited"),
    );
  });

  it("strips trailing legal suffixes (29 of 75 real pairs)", () => {
    expect(normalizedKey("COAL INDIA LIMITED")).toBe(normalizedKey("Coal India"));
    expect(normalizedKey("ICICI BANK LIMITED")).toBe(normalizedKey("ICICI Bank"));
    expect(normalizedKey("MAHANAGAR TELEPHONE NIGAM LIMITED")).toBe(
      normalizedKey("Mahanagar Telephone Nigam"),
    );
  });

  it("strips a multi-word legal form before a single-word one can bite", () => {
    expect(normalizeName("ACME PRIVATE LIMITED").normalized).toBe("acme");
    expect(normalizeName("Acme Pvt Ltd").normalized).toBe("acme");
  });

  it("normalises punctuation, and expands & to 'and'", () => {
    expect(normalizedKey("MAHINDRA AND MAHINDRA LIMITED")).toBe(
      normalizedKey("Mahindra & Mahindra"),
    );
    expect(normalizedKey("DR. REDDY'S LABORATORIES LIMITED")).toBe(
      normalizedKey("Dr Reddys Laboratories"),
    );
  });

  it("collapses whitespace of every kind", () => {
    expect(normalizeName("  Tata   Motors\tLimited \n").normalized).toBe("tata motors");
  });

  it("applies NFKC, so two encodings of one string agree", () => {
    // Full-width Latin is a compatibility form of ASCII.
    const fullWidth = [0xff34, 0xff41, 0xff54, 0xff41].map((c) => String.fromCharCode(c)).join("");
    expect(normalizeName(fullWidth).normalized).toBe("tata");
  });
});

describe("normalizeName - properties that must hold", () => {
  const samples = [
    "STATE BANK OF INDIA",
    "Mahindra & Mahindra",
    "ACME PRIVATE LIMITED",
    "  spaced   out  ",
    "Limited",
    "L&T",
    "",
  ];

  it("is idempotent: normalising a normalised name changes nothing", () => {
    for (const s of samples) {
      const once = normalizeName(s).normalized;
      expect(normalizeName(once).normalized).toBe(once);
    }
  });

  it("is deterministic across repeated calls", () => {
    for (const s of samples) {
      expect(normalizeName(s)).toEqual(normalizeName(s));
    }
  });

  it("never reduces a name to the empty string when it has word characters", () => {
    // A company genuinely called "Limited" keeps its name. An empty key
    // would collide with every other empty key and merge unrelated records.
    expect(normalizeName("Limited").normalized).toBe("limited");
    expect(normalizeName("LTD").normalized).toBe("ltd");
    expect(normalizeName("Co.").normalized).toBe("co");
  });

  it("reports only the steps that actually changed the string", () => {
    expect(normalizeName("acme").applied).toEqual([]);
    expect(normalizeName("ACME").applied).toEqual(["case_fold"]);
    expect(normalizeName("ACME LIMITED").applied).toEqual(["case_fold", "legal_suffix"]);
  });

  it("keeps the pre-suffix form, so a decision can show what was removed", () => {
    const n = normalizeName("TATA MOTORS PRIVATE LIMITED");
    expect(n.withSuffix).toBe("tata motors private limited");
    expect(n.normalized).toBe("tata motors");
  });

  it("lists legal suffixes longest-first so the longer form wins", () => {
    const firstLimited = LEGAL_SUFFIXES.indexOf("limited");
    expect(LEGAL_SUFFIXES.indexOf("private limited")).toBeLessThan(firstLimited);
    expect(LEGAL_SUFFIXES.indexOf("public limited")).toBeLessThan(firstLimited);
  });
});

describe("normalizeName - what it must NOT do", () => {
  it("does not transliterate or fold script", () => {
    const devanagari = [0x092d, 0x093e, 0x0930, 0x0924].map((c) => String.fromCharCode(c)).join("");
    expect(normalizeName(devanagari).normalized).not.toBe("bharat");
    expect(normalizeName(devanagari).normalized).toBe(devanagari.toLowerCase());
  });

  it("does not reorder tokens", () => {
    expect(normalizedKey("Reddy Sanjay")).not.toBe(normalizedKey("Sanjay Reddy"));
  });

  it("does not match a token subset or prefix", () => {
    // GVK is a strict subset of the registered name and of any other
    // "GVK ..." entity. Subset matching is the rule that would produce
    // the false merges the hard-negative set exists to catch.
    expect(normalizedKey("GVK")).not.toBe(normalizedKey("GVK POWER & INFRASTRUCTURE LIMITED"));
    expect(normalizedKey("Flipkart")).not.toBe(normalizedKey("FLIPKART INDIA PRIVATE LIMITED"));
  });

  it("strips legal forms only at the END, never in the middle", () => {
    expect(normalizeName("BANK OF INDIA LIMITED").normalized).toBe("bank of india");
    expect(normalizeName("CO OPERATIVE STORES LIMITED").normalized).toBe("co operative stores");
  });
});

describe("normalizeName - the real hard negatives must stay apart", () => {
  const mustDiffer: [string, string][] = [
    ["BHARAT HEAVY ELECTRICALS LIMITED", "BHARAT DYNAMICS LIMITED"],
    ["BHARAT HEAVY ELECTRICALS LIMITED", "BHARAT ELECTRONICS"],
    ["BHARAT DYNAMICS LIMITED", "BHARAT ELECTRONICS"],
    ["NAVNEET PRAKASHAN KENDRA", "NAVNEET EDUCATION LIMITED"],
    ["HINDUSTAN AERONAUTICS LIMITED", "HINDUSTAN ZINC LIMITED"],
    ["TATA MOTORS PASSENGER VEHICLES LIMITED", "TATA STARBUCKS PRIVATE LIMITED"],
    ["TATA CHEMICALS LIMITED", "TATA CONSUMER PRODUCTS LIMITED"],
    ["SUN PHARMACEUTICAL INDUSTRIES LIMITED", "SUN PARADISE"],
    ["BHATI SOLAR SOLUTIONS PRIVATE LIMITED", "RAJDEEP BHATI SOLAR SOLUTIONS PRIVATE LIMITED"],
    ["JAY MAA VAISHNAVI RICE MILL PRIVATE LIMITED", "JAY AMBE STEEL PROFILE CUTTING CO"],
    ["SHREE KRISHNA RMC AND STRUCTURE", "SHREE D B GOLD"],
    ["RAJ SUNIL WADHWA", "RAJ AUTOLINK"],
    ["Carnelian Structural Shifts Fund Series II", "Carnelian Bharat AmritKaal Fund 3"],
  ];

  it.each(mustDiffer)("keeps %s and %s distinct", (a, b) => {
    expect(normalizedKey(a)).not.toBe(normalizedKey(b));
  });
});

describe("describeNormalization", () => {
  it("names the steps that made two strings comparable", () => {
    const a = normalizeName("COAL INDIA LIMITED");
    const b = normalizeName("Coal India");
    expect(describeNormalization(a, b)).toContain("case folding");
    expect(describeNormalization(a, b)).toContain("legal-suffix stripping");
  });

  it("returns null when nothing was applied - that is Tier B's exact-match case", () => {
    expect(describeNormalization(normalizeName("acme"), normalizeName("acme"))).toBeNull();
  });
});
