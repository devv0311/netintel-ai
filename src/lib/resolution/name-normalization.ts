/**
 * Deterministic name normalisation for Tier-B entity resolution.
 *
 * Approved 2026-09-03 after P6.16 measured the current resolver against
 * the real no-identifier corpus and found it joined 0 of 75 real
 * cross-source pairs. The failure classes were not semantic: legal
 * suffix (29 pairs) and capitalisation (24) together account for 53 of
 * the 75, and both are differences between two publishers' house styles
 * rather than differences about which company is meant.
 *
 * WHAT THIS IS NOT.
 *
 * This is not fuzzy matching. There is no edit distance, no token
 * overlap ratio, no similarity threshold, no embedding and no model.
 * Two names either normalise to the same string or they do not, and the
 * answer is the same on every run and on every machine. That matters for
 * an investigative tool: a decision row can name the exact
 * transformations that made two strings equal, and a reader can disagree
 * with a rule rather than with a score.
 *
 * Every step is:
 *   - PURE           - no I/O, no clock, no locale-sensitive collation.
 *   - IDEMPOTENT     - normalise(normalise(x)) === normalise(x).
 *   - ORDER-FIXED    - the pipeline order below is part of the contract,
 *                      because suffix stripping depends on punctuation
 *                      and case already being folded.
 *   - EXPLAINABLE    - `applied` names each step that actually changed
 *                      the string, so a decision can say WHY.
 *
 * WHAT IT DELIBERATELY DOES NOT DO.
 *
 * No transliteration and no script folding. P6.16 found exactly one
 * primary-name transliteration pair, and the Devanagari strings in the
 * corpus are aliases rather than primary names; inventing a
 * transliteration rule against a single observed example would be
 * fitting a rule to an anecdote. No token reordering, no subset or
 * prefix matching: `GVK` is a strict token subset of `GVK POWER &
 * INFRASTRUCTURE LIMITED` and also of any other `GVK ...` entity, so
 * subset matching is exactly the rule that would have produced the false
 * merges the hard-negative set exists to catch.
 */

/**
 * Legal forms stripped from the END of a name, longest first so that
 * "private limited" is consumed before "limited" can be.
 *
 * Only trailing forms are removed. A legal form in the middle of a name
 * is usually part of it ("BANK OF INDIA LIMITED" keeps "of india"), and
 * removing interior tokens would collapse genuinely different entities.
 */
export const LEGAL_SUFFIXES: readonly string[] = [
  "private limited",
  "public limited",
  "incorporated",
  "corporation",
  "limited",
  "company",
  "gmbh",
  "llp",
  "llc",
  "plc",
  "ltd",
  "inc",
  "corp",
  "pvt",
  "bv",
  "nv",
  "sa",
  "ag",
  "lp",
  "co",
];

/** The steps this module can report having applied, in pipeline order. */
export type NormalizationStep =
  | "unicode_nfkc"
  | "case_fold"
  | "punctuation"
  | "whitespace"
  | "legal_suffix";

export interface NormalizedName {
  /** The comparison key. Never empty when the input had any word character. */
  normalized: string;
  /** Steps that actually CHANGED the string, in the order applied. */
  applied: NormalizationStep[];
  /**
   * The form before legal-suffix stripping. Kept because a suffix-only
   * difference is the one class where the stripped token is real
   * information about the entity, and a decision row should be able to
   * show what was removed.
   */
  withSuffix: string;
}

/**
 * Punctuation folded to a space, built from code points so this file
 * stays ASCII-only. 2010-2015 are the hyphen/dash family; 00AB/00BB the
 * guillemets; 2018/2019/201C/201D the curly quotes; 00B7/2022 the dots.
 */
const PUNCTUATION_TO_SPACE = new Set<string>([
  ".", ",", '"', "(", ")", "[", "]", "{", "}", "-", "_", "/", "\\",
  ":", ";", "!", "?", "*", "|", "@", "#",
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,
      0x00ab, 0x00bb, 0x201c, 0x201d,
      0x00b7, 0x2022].map((c) => String.fromCharCode(c)),
]);

/**
 * Apostrophes are DELETED rather than folded to a space, because they
 * are intra-word: "Dr. Reddy's Laboratories" must normalise to
 * "dr reddys laboratories", not "dr reddy s laboratories". Spacing them
 * would leave a stray one-letter token that no publisher writing
 * "Reddys" would produce, so the two spellings would stop matching -
 * which is the opposite of what normalisation is for. Covers the ASCII
 * apostrophe and U+2019, the typographic one publishers actually emit.
 */
const APOSTROPHES = new Set<string>(["'", String.fromCharCode(0x2019), String.fromCharCode(0x2018)]);

/**
 * `&` becomes " and " rather than a space, because the two publishers in
 * the corpus write the same company as "MAHINDRA AND MAHINDRA LIMITED"
 * and "Mahindra & Mahindra". Folding it to a space would make those two
 * strings differ by a token instead of matching.
 *
 * This is an expansion of a symbol into the word it stands for, not a
 * synonym table: no other word is ever substituted for another.
 */
const AMPERSAND_EXPANSION = " and ";

/**
 * Normalises a publisher-supplied name into a comparison key.
 *
 * The pipeline order is fixed and load-bearing: suffix stripping matches
 * lower-case, punctuation-free, single-spaced tokens, so it can only run
 * last. Reordering the steps changes the output and is a behaviour
 * change, not a refactor.
 */
export function normalizeName(raw: string): NormalizedName {
  const applied: NormalizationStep[] = [];

  // 1. Unicode NFKC. Composes accents and folds compatibility forms
  //    (full-width Latin, ligatures) so two byte-different encodings of
  //    the same string compare equal. It does NOT change script.
  const nfkc = raw.normalize("NFKC");
  if (nfkc !== raw) applied.push("unicode_nfkc");

  // 2. Case folding. GLEIF publishes legal names upper-cased and
  //    Wikidata title-cases them, which is 24 of the 75 pairs on its own.
  const folded = nfkc.toLowerCase();
  if (folded !== nfkc) applied.push("case_fold");

  // 3. Punctuation. Every character in PUNCTUATION_TO_SPACE becomes a
  //    space; apostrophes are deleted; "&" becomes " and ". Characters
  //    outside those sets - letters of any script, digits - are untouched.
  let depunctuated = "";
  for (const ch of folded) {
    if (ch === "&") depunctuated += AMPERSAND_EXPANSION;
    else if (APOSTROPHES.has(ch)) continue; // deleted, not spaced - see APOSTROPHES
    else if (PUNCTUATION_TO_SPACE.has(ch)) depunctuated += " ";
    else depunctuated += ch;
  }
  if (depunctuated !== folded) applied.push("punctuation");

  // 4. Whitespace. Any run of whitespace of any kind collapses to one
  //    space, and the ends are trimmed.
  const collapsed = depunctuated.replace(/\s+/g, " ").trim();
  if (collapsed !== depunctuated) applied.push("whitespace");

  // 5. Legal suffix, repeatedly, longest match first. "TATA MOTORS
  //    PRIVATE LIMITED" and "Tata Motors Pvt Ltd" both end at
  //    "tata motors".
  const withSuffix = collapsed;
  let stripped = collapsed;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (!stripped.endsWith(` ${suffix}`)) continue;
      const candidate = stripped.slice(0, -(suffix.length + 1)).trim();
      // Never strip a name down to nothing. A company genuinely called
      // "Limited" keeps its name; an empty key would collide with every
      // other empty key and merge unrelated records.
      if (candidate.length === 0) continue;
      stripped = candidate;
      changed = true;
      break;
    }
  }
  if (stripped !== withSuffix) applied.push("legal_suffix");

  return { normalized: stripped, applied, withSuffix };
}

/** Convenience: the comparison key alone. */
export const normalizedKey = (raw: string): string => normalizeName(raw).normalized;

/**
 * Human-readable account of what made two names comparable, for a
 * decision's `reason`. Returns null when nothing was applied - i.e. the
 * strings were already equal, which is Tier B's exact-match case and
 * should never be reported as a normalised match.
 */
export function describeNormalization(a: NormalizedName, b: NormalizedName): string | null {
  const steps = [...new Set([...a.applied, ...b.applied])].sort();
  if (steps.length === 0) return null;
  const labels: Record<NormalizationStep, string> = {
    unicode_nfkc: "Unicode NFKC",
    case_fold: "case folding",
    punctuation: "punctuation folding",
    whitespace: "whitespace collapsing",
    legal_suffix: "legal-suffix stripping",
  };
  return steps.map((s) => labels[s]).join(", ");
}
