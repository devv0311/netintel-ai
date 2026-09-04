/**
 * P6.24 — the pairwise feature vector, and the leakage contract that
 * defines what may be in it.
 *
 * THE TASK. Given two public records, decide whether they denote the
 * SAME legal entity. This is the same question `src/lib/resolution/`
 * answers deterministically; the model answers it as a score.
 *
 * THE LEAKAGE CONTRACT, WHICH IS THE MOST IMPORTANT THING IN THIS FILE.
 *
 * Every label in this project is created from an IDENTIFIER: a positive
 * is two publishers independently stating the same GLEIF-issued LEI or
 * the same SEC-issued CIK; a negative is two records that share an
 * identifier scheme and DISAGREE on its value. The label is therefore a
 * deterministic function of the identifiers.
 *
 * It follows that an identifier feature is not a feature at all — it is
 * the answer. A model given `sharesLEI` would reach 100% on every split,
 * learn nothing about names, and be worthless at the only job it could
 * usefully do: judging the record pairs where an identifier is ABSENT,
 * which is precisely where the deterministic resolver already fails
 * (containment 0/160, partial overlap 0/69, divergent 0/69, script
 * variant 0/31 at `a00cdf3`).
 *
 * So: NO feature in this file may read `identifiers`, and none reads the
 * OpenCorporates id either — `ocid_agrees` is recorded as corroboration
 * on positives and is co-determined with LEI agreement, so it leaks the
 * same answer one step removed. `buildFeatures` is given a
 * `FeatureRecord` that structurally CANNOT carry an identifier, so the
 * contract is enforced by the type and not by discipline.
 *
 * The ground-truth `variation` class ("containment", "divergent", ...)
 * is likewise absent: it is an annotation derived by comparing the two
 * names against the known answer, and is used only to SLICE results.
 *
 * REGISTRY PAIRING IS DELIBERATELY NOT HERE. Every positive in the
 * corpus is cross-source by construction (`gleif x wikidata`,
 * `edgar x wikidata`) while many hard negatives are same-source, so
 * "same registry" predicts the label largely because of how the labels
 * were BUILT. It is measured as an ablation in the experiment registry
 * and excluded from the shipped model. See `docs/evaluation/ml-leakage-audit.md`.
 */

import { LEGAL_SUFFIXES, normalizeName } from "@/lib/resolution/name-normalization";
import {
  acronym,
  digitRuns,
  jaccard,
  jaroWinkler,
  levenshteinRatio,
  orderedPrefix,
  romanTokens,
  scriptClass,
  tokenContainment,
  trigramDice,
} from "@/lib/ml/similarity";

/**
 * The ONLY view of a record the model is allowed. There is no
 * `identifiers` field, by design — see the leakage contract above.
 */
export interface FeatureRecord {
  /** The publisher's primary name, verbatim. */
  readonly name: string;
  /** A publisher-stated legal name, when one exists. */
  readonly officialName?: string | undefined;
  /** Publisher-stated other names. */
  readonly aliases?: readonly string[] | undefined;
  /** The publisher's jurisdiction string, verbatim ("IN", "US-DE"). */
  readonly jurisdiction?: string | undefined;
}

/** Feature names, in the fixed order every vector uses. Order is part of the artifact contract. */
export const FEATURE_NAMES = [
  "exactNameMatch",
  "normalizedNameMatch",
  "anyVariantNormalizedMatch",
  "sortedTokenMatch",
  "tokenJaccard",
  "tokenContainment",
  "orderedPrefixContainment",
  "firstTokenMatch",
  "lastTokenMatch",
  "levenshteinRatio",
  "jaroWinkler",
  "trigramDice",
  "bestVariantTrigramDice",
  "lengthRatio",
  "tokenCountRatio",
  "singleTokenSide",
  "acronymMatch",
  "sameScript",
  "jurisdictionBothKnown",
  "jurisdictionCountryMatch",
  "jurisdictionCountryConflict",
  "officialNameBothPresent",
  "aliasesEitherPresent",
  "digitSetConflict",
  "romanNumeralConflict",
  "legalFormConflict",
  "structuralTokenAsymmetry",
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

/**
 * Features EXCLUDED from any newly trained model, and why.
 *
 * `officialNameBothPresent` is a missingness flag, and in this corpus
 * missingness is a source-pairing proxy rather than evidence about
 * identity. Only Wikidata publishes an official name (531 of 3,282
 * records; GLEIF and EDGAR publish none), so "both sides state an
 * official name" is true exactly when both records are Wikidata — a
 * same-source pair, which is never a positive here because every
 * positive is cross-source by construction. Leakage check L12 caught it:
 * the flag is true for 63 TRAIN rows and never once alongside a positive.
 *
 * The official name itself is NOT excluded and remains real evidence: it
 * is one of the name variants behind `bestVariantTrigramDice` and
 * `anyVariantNormalizedMatch`, which is where a legal name earns its
 * keep. What is dropped is only the bare assertion that two publishers
 * happened to state one.
 *
 * It stays in FEATURE_NAMES so that artifacts trained before P6.25 keep
 * loading and scoring exactly as they did — those models were fitted
 * with it and must keep receiving it.
 */
export const EXCLUDED_FROM_NEW_MODELS: readonly FeatureName[] = ["officialNameBothPresent"];

/** The feature set a model trained by this build is fitted on. */
export const TRAINABLE_FEATURE_NAMES: readonly FeatureName[] = FEATURE_NAMES.filter(
  (name) => !EXCLUDED_FROM_NEW_MODELS.includes(name),
);

export interface FeatureVector {
  readonly values: readonly number[];
}

const tokensOf = (value: string): string[] => {
  const normalized = normalizeName(value).normalized;
  return normalized.length === 0 ? [] : normalized.split(" ").filter((token) => token.length > 0);
};

/** Every name string a record offers, primary first. Used only for "best variant" features. */
const variantsOf = (record: FeatureRecord): string[] => {
  const variants = [record.name];
  if (record.officialName) variants.push(record.officialName);
  for (const alias of record.aliases ?? []) variants.push(alias);
  return variants.filter((value) => value.trim().length > 0);
};

/** The ISO country part of a jurisdiction string: "US-DE" -> "US". */
const countryOf = (jurisdiction: string | undefined): string | null => {
  if (!jurisdiction) return null;
  const trimmed = jurisdiction.trim().toUpperCase();
  if (trimmed.length === 0) return null;
  const [country] = trimmed.split("-");
  return country && country.length > 0 ? country : null;
};

const bool = (value: boolean): number => (value ? 1 : 0);

/**
 * Legal forms, grouped so that two spellings of ONE form are not read as a
 * disagreement. "Reliance Industries Limited" and "Reliance Industries
 * Ltd" are the same form written twice; "Simon Property Group, Inc." and
 * "Simon Property Group, L.P." are two different legal persons.
 *
 * This list is deliberately SEPARATE from the resolver's LEGAL_SUFFIXES.
 * That list governs deterministic normalisation and therefore authoritative
 * merge behaviour, and it is not this feature's business to change it —
 * adding "spa" there to help a classifier would alter how every name in
 * the product resolves. So the ML side keeps its own vocabulary, and the
 * resolver's semantics are untouched.
 */
const LEGAL_FORM_GROUPS: readonly (readonly string[])[] = [
  ["ltd", "limited"],
  ["private limited", "pvt ltd", "pvt"],
  ["plc", "public limited"],
  ["inc", "incorporated"],
  ["corp", "corporation"],
  ["co", "company"],
  ["llc"], ["llp"], ["lp"], ["gmbh"], ["ag"], ["bv"], ["nv"], ["sa"],
  // Forms the resolver's list does not carry, which appear in this corpus
  // because it is worldwide rather than India-filtered.
  ["spa"], ["ab"], ["as"], ["oy"], ["kk"], ["nsa"], ["se"], ["kgaa"], ["sas"], ["srl"], ["aps"],
];

const FORM_OF_TOKEN = new Map<string, string>();
for (const group of LEGAL_FORM_GROUPS) {
  const canonical = group[0] as string;
  for (const spelling of group) FORM_OF_TOKEN.set(spelling, canonical);
}

/**
 * The canonical legal form a name ends in, or null.
 *
 * Read from the RAW name, before normalisation, because normalisation
 * deliberately strips exactly this token — which is why the two halves of
 * a corporate family collide in the first place. "Simon Property Group,
 * Inc." and "Simon Property Group, L.P." both normalise to `simon property
 * group`, and they are two different legal entities with two different
 * LEIs: an UPREIT and its operating partnership. Stripping the suffix is
 * right for matching "Tata Motors Ltd" to "Tata Motors" and wrong here,
 * and one normalised string cannot serve both. So the form is recovered as
 * its own signal and handed to the model as evidence.
 *
 * Dots are removed rather than replaced by a space, so "L.P." reads as
 * `lp` and "S.p.A." as `spa`.
 */
const legalFormOf = (name: string): string | null => {
  const cleaned = name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return null;
  const tokens = cleaned.split(" ");
  // Longest match first: "private limited" before "limited".
  const lastTwo = tokens.length >= 2 ? `${tokens[tokens.length - 2]} ${tokens[tokens.length - 1]}` : null;
  if (lastTwo && FORM_OF_TOKEN.has(lastTwo)) return FORM_OF_TOKEN.get(lastTwo) as string;
  const last = tokens[tokens.length - 1] as string;
  return FORM_OF_TOKEN.get(last) ?? null;
};

/**
 * Tokens that name a ROLE INSIDE a corporate group rather than the group's
 * brand. One side carrying one that the other lacks is the signature of a
 * parent/subsidiary or holding/operating pair — "Allergan plc" against
 * "Allergan Finance LLC", "Novartis AG" against "Novartis Pharma AG",
 * "Humana AB" against "Humana Holding AB".
 *
 * This is a NAME feature and nothing more. It is derived from the two
 * strings alone, reads no relationship record, and asserts no view about
 * whether a parent and its subsidiary are the same entity — that question
 * is the owner's under P6.21.2 and is untouched here. All this says is
 * that the two names describe different POSITIONS in a group, which is
 * evidence they denote different legal persons, and it can only ever push
 * a pair away from a merge.
 */
const STRUCTURAL_TOKENS = new Set([
  "holding", "holdings", "group", "groupe", "finance", "financial", "capital",
  "international", "intressenter", "pharma", "pharmaceutical", "pharmaceuticals",
  "services", "solutions", "trust", "partners", "partnership", "ventures",
  "investments", "investment", "management", "operating", "properties",
  "entertainment", "technologies", "systems", "industries", "enterprises",
]);

const setsDiffer = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;
  const left = new Set(a);
  const right = new Set(b);
  if (left.size !== right.size) return true;
  for (const value of left) if (!right.has(value)) return true;
  return false;
};

/**
 * Builds the feature vector for an unordered pair. Every feature is
 * SYMMETRIC — f(a,b) === f(b,a) — because "same entity" is symmetric and
 * an asymmetric feature would let the model learn the arbitrary order in
 * which the dataset builder happened to emit each pair.
 */
export function buildFeatures(a: FeatureRecord, b: FeatureRecord): FeatureVector {
  const normA = normalizeName(a.name).normalized;
  const normB = normalizeName(b.name).normalized;
  const tokA = tokensOf(a.name);
  const tokB = tokensOf(b.name);

  const variantsA = variantsOf(a);
  const variantsB = variantsOf(b);

  let anyVariantNormalizedMatch = false;
  let bestVariantDice = 0;
  for (const left of variantsA) {
    const leftNorm = normalizeName(left).normalized;
    for (const right of variantsB) {
      const rightNorm = normalizeName(right).normalized;
      if (leftNorm.length > 0 && leftNorm === rightNorm) anyVariantNormalizedMatch = true;
      const dice = trigramDice(leftNorm, rightNorm);
      if (dice > bestVariantDice) bestVariantDice = dice;
    }
  }

  const sortedA = [...tokA].sort().join(" ");
  const sortedB = [...tokB].sort().join(" ");

  const acronymA = acronym(tokA);
  const acronymB = acronym(tokB);
  const acronymMatch =
    (tokB.length === 1 && acronymA.length > 1 && acronymA === tokB[0]) ||
    (tokA.length === 1 && acronymB.length > 1 && acronymB === tokA[0]);

  const countryA = countryOf(a.jurisdiction);
  const countryB = countryOf(b.jurisdiction);
  const bothJurisdictions = countryA !== null && countryB !== null;

  const maxLength = Math.max(normA.length, normB.length);
  const maxTokens = Math.max(tokA.length, tokB.length);

  // Both sides must actually STATE a form for a disagreement to exist. A
  // name with no suffix is silent about its legal form, not in conflict
  // with one — "Genertel" does not contradict "GENERTEL S.P.A.".
  const formA = legalFormOf(a.name);
  const formB = legalFormOf(b.name);
  const legalFormConflict = formA !== null && formB !== null && formA !== formB;

  const structuralA = tokA.filter((token) => STRUCTURAL_TOKENS.has(token));
  const structuralB = tokB.filter((token) => STRUCTURAL_TOKENS.has(token));
  const structuralTokenAsymmetry = setsDiffer(
    [...new Set(structuralA)].sort(),
    [...new Set(structuralB)].sort(),
  )
    ? true
    : // setsDiffer returns false when either side is empty, which is the
      // case that matters most here: one side carries "Holding" and the
      // other carries nothing at all.
      structuralA.length !== structuralB.length;

  const values: number[] = [
    bool(a.name === b.name),
    bool(normA.length > 0 && normA === normB),
    bool(anyVariantNormalizedMatch),
    bool(sortedA.length > 0 && sortedA === sortedB),
    jaccard(tokA, tokB),
    tokenContainment(tokA, tokB),
    bool(orderedPrefix(tokA, tokB)),
    bool(tokA.length > 0 && tokA[0] === tokB[0]),
    bool(tokA.length > 0 && tokB.length > 0 && tokA[tokA.length - 1] === tokB[tokB.length - 1]),
    levenshteinRatio(normA, normB),
    jaroWinkler(normA, normB),
    trigramDice(normA, normB),
    bestVariantDice,
    maxLength === 0 ? 1 : Math.min(normA.length, normB.length) / maxLength,
    maxTokens === 0 ? 1 : Math.min(tokA.length, tokB.length) / maxTokens,
    bool(tokA.length === 1 || tokB.length === 1),
    bool(acronymMatch),
    bool(scriptClass(a.name) === scriptClass(b.name)),
    bool(bothJurisdictions),
    bool(bothJurisdictions && countryA === countryB),
    bool(bothJurisdictions && countryA !== countryB),
    bool(Boolean(a.officialName) && Boolean(b.officialName)),
    bool((a.aliases?.length ?? 0) > 0 || (b.aliases?.length ?? 0) > 0),
    bool(setsDiffer(digitRuns(a.name), digitRuns(b.name))),
    bool(setsDiffer(romanTokens(tokA), romanTokens(tokB))),
    bool(legalFormConflict),
    bool(structuralTokenAsymmetry),
  ];

  if (values.length !== FEATURE_NAMES.length) {
    throw new Error(
      `feature vector length ${values.length} does not match FEATURE_NAMES length ${FEATURE_NAMES.length}`,
    );
  }
  for (const value of values) {
    if (!Number.isFinite(value)) throw new Error("feature vector contains a non-finite value");
  }

  return { values };
}

/**
 * The deterministic resolver's own pair-level decision, replayed.
 *
 * The shipped resolver merges an identifier-less mention into a cluster
 * on EXACT name (Tier B) or NORMALISED name (Tier B2), and on nothing
 * else. At pair level, with identifiers withheld, that is exactly
 * normalised-name equality. This function is the baseline every model
 * result is compared against; it imports the resolver's own normaliser
 * rather than reimplementing it, so the two cannot drift.
 */
export function deterministicPairDecision(a: FeatureRecord, b: FeatureRecord): boolean {
  const normA = normalizeName(a.name).normalized;
  const normB = normalizeName(b.name).normalized;
  return normA.length > 0 && normA === normB;
}
