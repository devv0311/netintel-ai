/**
 * P6.27 — legal-form normalisation and IDF-weighted name similarity.
 *
 * The defect these exist to prevent is specific and measured. P6.26 scored a
 * candidate model merging `Sabiedriba ar ierobezotu atbildibu "AKZ"` with
 * `Frigate AS` at 0.9922: a Latvian chemicals company and a Norwegian one,
 * joined because Latvian records spell "limited liability company" out inside
 * the legal name, and thirty characters of shared boilerplate read as name
 * agreement to every similarity feature the model had.
 *
 * So the assertions below are mostly about what must NOT match. A test suite
 * for entity resolution that only checks that the right things join will pass
 * happily on a system that joins everything, and false merges are the
 * expensive error here: a wrong merge puts two real companies into one node
 * and every downstream inference inherits it.
 */
import { describe, expect, it } from "vitest";

import { FEATURE_NAMES, buildFeatures } from "@/lib/ml/features";
import {
  LEGAL_FORM_COUNT,
  foldName,
  idf,
  maxSharedIdf,
  stripLegalForms,
  weightedContainment,
  weightedJaccard,
} from "@/lib/ml/legal-forms";
import { normalizeName } from "@/lib/resolution/name-normalization";

const feature = (a: string, b: string, name: string): number => {
  const vector = buildFeatures(
    { name: a },
    { name: b },
  );
  const index = FEATURE_NAMES.indexOf(name as (typeof FEATURE_NAMES)[number]);
  expect(index, `unknown feature ${name}`).toBeGreaterThanOrEqual(0);
  return vector.values[index] as number;
};

const tokens = (value: string): string[] => {
  const core = stripLegalForms(value);
  return core.length === 0 ? [] : core.split(" ");
};

describe("foldName", () => {
  it("folds diacritics, case and punctuation, because publishers disagree about those far more often than about words", () => {
    expect(foldName("Société Générale S.A.")).toBe("societe generale sa");
    // A dot is removed; a SPACE is still a separator. "a. s." is therefore two
    // tokens and "a.s." is one, which is a real residual difference between
    // two Slovak house styles and is left visible rather than papered over.
    expect(foldName("Prvá stavebná sporiteľňa, a. s.")).toBe("prva stavebna sporitelna a s");
    expect(foldName("Prvá stavebná sporiteľňa, a.s.")).toBe("prva stavebna sporitelna as");
  });

  it("does NOT fold stroke and dotless letters, because the corpus gives no evidence for it", () => {
    // Turkish ı, Danish ø, Polish ł and friends have no canonical
    // decomposition, so NFKD leaves them alone and this fold does too.
    //
    // That looks like a gap and was measured before being left open: of 287
    // training positives containing such a letter, ZERO match only when those
    // letters are folded to ASCII. A rule with no attested case is a guess,
    // and P6.17 already established that this project does not add
    // transliteration rules on the strength of a plausible-sounding example.
    // If a later corpus attests one, the miner's own evidence will say so.
    expect(foldName("Türkiye Garanti Bankası")).toBe("turkiye garanti bankası");
  });

  it("is idempotent", () => {
    const once = foldName("Société Générale S.A.");
    expect(foldName(once)).toBe(once);
  });
});

describe("stripLegalForms", () => {
  it("removes a spelled-out trailing form the resolver's English suffix list cannot reach", () => {
    // The resolver strips trailing English suffixes only, so it leaves the
    // Turkish form in place. That is correct for the resolver and is exactly
    // the gap this module fills on the ML side.
    expect(normalizeName("Turkiye Garanti Bankasi Anonim Sirketi").normalized).toContain("anonim");
    expect(stripLegalForms("Turkiye Garanti Bankasi Anonim Sirketi")).toBe("turkiye garanti bankasi");
  });

  it("removes a leading form as well as a trailing one", () => {
    expect(stripLegalForms("Публичное акционерное общество Сбербанк")).toBe("сбербанк");
  });

  it("leaves a name that carries no mined form completely untouched", () => {
    expect(stripLegalForms("Reliance Industries Limited")).toBe("reliance industries limited");
  });

  it("never returns empty, even when the name is nothing but a legal form", () => {
    // An empty comparison key would make every such record match every other
    // one - the same failure as the boilerplate case, reached from the other
    // side.
    expect(stripLegalForms("Anonim Sirketi")).not.toBe("");
    expect(stripLegalForms("GmbH")).not.toBe("");
  });

  it("is idempotent", () => {
    const once = stripLegalForms("Turkiye Garanti Bankasi Anonim Sirketi");
    expect(stripLegalForms(once)).toBe(once);
  });

  it("ships a vocabulary that was actually mined", () => {
    expect(LEGAL_FORM_COUNT).toBeGreaterThan(0);
  });
});

describe("idf", () => {
  it("scores a token that recurs across the corpus below one that does not", () => {
    // "limited" is boilerplate; a company's own name is not. This ordering is
    // the whole mechanism.
    expect(idf("limited")).toBeLessThan(idf("tencent"));
  });

  it("treats an unseen token as rare rather than as unknown", () => {
    expect(idf("qzxwvunseen")).toBeGreaterThan(idf("limited"));
  });
});

describe("weighted similarity — false-positive resistance", () => {
  it("scores two unrelated companies sharing only a spelled-out legal form at zero", () => {
    // The P6.26 defect class. Plain token overlap calls these half-identical.
    const a = "Akbank Anonim Sirketi";
    const b = "Sabanci Anonim Sirketi";
    expect(feature(a, b, "tokenJaccard")).toBeGreaterThan(0.3);
    expect(feature(a, b, "coreTokenJaccard")).toBe(0);
    expect(feature(a, b, "idfWeightedJaccard")).toBe(0);
    expect(feature(a, b, "maxSharedTokenIdf")).toBe(0);
  });

  it("does not let a long shared boilerplate run outscore a short shared name", () => {
    const boilerplateOnly = weightedJaccard(
      tokens("Akbank Anonim Sirketi"),
      tokens("Sabanci Anonim Sirketi"),
    );
    const realNameShared = weightedJaccard(tokens("Tencent Limited"), tokens("Tencent"));
    expect(realNameShared).toBeGreaterThan(boilerplateOnly);
  });

  it("keeps two different legal persons in one corporate family apart", () => {
    // Simon Property Group Inc and its operating partnership are two LEIs.
    // P6.21.2 defines them as distinct entities, so this must not read as a
    // match, and `legalFormConflict` is the feature that says so.
    expect(feature("Simon Property Group, Inc.", "Simon Property Group, L.P.", "legalFormConflict")).toBe(1);
  });

  it("keeps a parent apart from a subsidiary that shares its brand", () => {
    expect(feature("Novartis AG", "Novartis Pharma AG", "structuralTokenAsymmetry")).toBe(1);
  });
});

describe("weighted similarity — genuine matches survive", () => {
  it("matches a name whose only difference is a spelled-out legal form", () => {
    const a = "Turkiye Garanti Bankasi Anonim Sirketi";
    const b = "Turkiye Garanti Bankasi";
    expect(feature(a, b, "coreNameMatch")).toBe(1);
    expect(feature(a, b, "coreTokenJaccard")).toBe(1);
    expect(feature(a, b, "idfWeightedJaccard")).toBe(1);
  });

  it("matches across a jurisdiction boundary, which is the class P6.26 was collected against", () => {
    // Cross-border pairs are same-entity records whose publishers state
    // different countries. The name features must not care.
    expect(feature("Tencent Holdings Limited", "Tencent", "maxSharedTokenIdf")).toBeGreaterThan(0.5);
    expect(feature("NetEase, Inc.", "NetEase", "maxSharedTokenIdf")).toBeGreaterThan(0.5);
  });

  it("survives punctuation and case differences", () => {
    expect(feature("SOCIETE GENERALE S.A.", "Société Générale SA", "coreNameMatch")).toBe(1);
  });

  it("survives diacritic-only differences, the commonest cross-publisher disagreement", () => {
    expect(feature("Prvá stavebná sporiteľňa", "Prva stavebna sporitelna", "coreNameMatch")).toBe(1);
  });

  it("still matches an English abbreviation against its expansion, via the resolver's own normalisation", () => {
    // This class was already handled and must not regress: the new features
    // are additive, and `normalizedNameMatch` is unchanged.
    expect(feature("Reliance Industries Ltd", "Reliance Industries Limited", "normalizedNameMatch")).toBe(1);
  });
});

describe("symmetry and contract", () => {
  it("is symmetric in its arguments, because 'same entity' is", () => {
    for (const name of ["coreTokenJaccard", "idfWeightedJaccard", "maxSharedTokenIdf", "coreTrigramDice"]) {
      const forward = feature("Tencent Holdings Limited", "Tencent", name);
      const backward = feature("Tencent", "Tencent Holdings Limited", name);
      expect(backward, name).toBeCloseTo(forward, 12);
    }
  });

  it("keeps every feature finite and inside [0,1]", () => {
    const vector = buildFeatures(
      { name: "Sabiedriba ar ierobezotu atbildibu \"AKZ\"" },
      { name: "Frigate AS" },
    );
    for (const [index, value] of vector.values.entries()) {
      expect(Number.isFinite(value), FEATURE_NAMES[index]).toBe(true);
      expect(value, FEATURE_NAMES[index]).toBeGreaterThanOrEqual(0);
      expect(value, FEATURE_NAMES[index]).toBeLessThanOrEqual(1);
    }
  });

  it("emits exactly one value per declared feature name", () => {
    const vector = buildFeatures(
      { name: "A" },
      { name: "B" },
    );
    expect(vector.values.length).toBe(FEATURE_NAMES.length);
  });

  it("handles an empty side without throwing", () => {
    expect(weightedJaccard([], ["x"])).toBe(0);
    expect(weightedContainment([], ["x"])).toBe(0);
    expect(maxSharedIdf([], ["x"])).toBe(0);
  });
});

describe("the resolver is not touched by any of this", () => {
  it("leaves normalizeName's spelled-out-form behaviour exactly as it was", () => {
    // If this ever changes, the ML feature work has leaked into
    // deterministic merge behaviour, which it must never do.
    expect(normalizeName("Turkiye Garanti Bankasi Anonim Sirketi").normalized).toBe(
      "turkiye garanti bankasi anonim sirketi",
    );
    expect(normalizeName("Reliance Industries Limited").normalized).toBe("reliance industries");
  });
});
