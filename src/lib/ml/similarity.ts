/**
 * P6.24 — string-similarity primitives for the pairwise entity-resolution
 * model. Pure, deterministic, dependency-free.
 *
 * These are FEATURE functions, not resolution rules. Nothing here is
 * wired into `src/lib/resolution/`; the deterministic resolver's
 * semantics are unchanged and remain the authority on a merge. A value
 * computed here can only ever become a SCORE the investigator sees
 * alongside the deterministic decision.
 *
 * Every function is total: it returns a finite number in [0, 1] for any
 * pair of strings including empty ones, so a missing field can never
 * produce NaN in a feature vector.
 */

/** Damerau-free Levenshtein distance, iterative, O(min(a,b)) memory. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Iterate over the shorter string to keep the row small.
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let previous: number[] = Array.from({ length: short.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(short.length + 1).fill(0);

  for (let i = 1; i <= long.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= short.length; j += 1) {
      const substitution = (previous[j - 1] ?? 0) + (long[i - 1] === short[j - 1] ? 0 : 1);
      const insertion = (current[j - 1] ?? 0) + 1;
      const deletion = (previous[j] ?? 0) + 1;
      current[j] = Math.min(substitution, insertion, deletion);
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[short.length] ?? 0;
}

/** 1 - normalised edit distance. 1.0 for identical, 0.0 for maximally different. */
export function levenshteinRatio(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Jaro-Winkler similarity. Included alongside Levenshtein because the two
 * disagree in the way that matters here: Jaro-Winkler rewards a shared
 * PREFIX, which is exactly the shape of both the true containment
 * positives and the shared-leading-token hard negatives. A model that can
 * see both can learn where the prefix stops being evidence.
 */
export function jaroWinkler(a: string, b: string, prefixScale = 0.1): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  const matchWindow = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatched = new Array<boolean>(a.length).fill(false);
  const bMatched = new Array<boolean>(b.length).fill(false);

  let matches = 0;
  for (let i = 0; i < a.length; i += 1) {
    const start = Math.max(0, i - matchWindow);
    const end = Math.min(i + matchWindow + 1, b.length);
    for (let j = start; j < end; j += 1) {
      if (bMatched[j] || a[i] !== b[j]) continue;
      aMatched[i] = true;
      bMatched[j] = true;
      matches += 1;
      break;
    }
  }
  if (matches === 0) return 0;

  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < a.length; i += 1) {
    if (!aMatched[i]) continue;
    while (!bMatched[k]) k += 1;
    if (a[i] !== b[k]) transpositions += 1;
    k += 1;
  }

  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;

  let prefix = 0;
  const maxPrefix = Math.min(4, a.length, b.length);
  while (prefix < maxPrefix && a[prefix] === b[prefix]) prefix += 1;

  return jaro + prefix * prefixScale * (1 - jaro);
}

/** Character n-grams of a string, padded so short strings still produce grams. */
export function charNGrams(value: string, n: number): string[] {
  if (n <= 0) return [];
  const padded = value.length >= n ? value : value.padEnd(n, " ");
  const grams: string[] = [];
  for (let i = 0; i + n <= padded.length; i += 1) grams.push(padded.slice(i, i + n));
  return grams;
}

/** Dice coefficient over character trigrams: 2|A∩B| / (|A|+|B|), multiset-free. */
export function trigramDice(a: string, b: string): number {
  if (a === b) return a.length === 0 ? 1 : 1;
  const left = new Set(charNGrams(a, 3));
  const right = new Set(charNGrams(b, 3));
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/** |A∩B| / |A∪B| over token sets. */
export function jaccard(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return 1;
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** |A∩B| / min(|A|,|B|) — 1.0 when one token set is a subset of the other. */
export function tokenContainment(a: readonly string[], b: readonly string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/**
 * True when one token sequence is a strict ORDERED prefix of the other.
 *
 * P6.18.2 measured that ordered prefix containment separates the real
 * hard negatives where unordered subset does not, because the negatives
 * diverge at their SECOND token. The feature is offered to the model in
 * the same ordered form for the same reason.
 */
export function orderedPrefix(a: readonly string[], b: readonly string[]): boolean {
  if (a.length === 0 || b.length === 0 || a.length === b.length) return false;
  const [shortSeq, longSeq] = a.length < b.length ? [a, b] : [b, a];
  return shortSeq.every((token, index) => token === longSeq[index]);
}

/**
 * The initials of a multi-token name, e.g. ["international","business",
 * "machines"] -> "ibm". Returns "" for a single token, because a
 * one-token name has no acronym to form.
 */
export function acronym(tokens: readonly string[]): string {
  if (tokens.length < 2) return "";
  return tokens.map((token) => token[0] ?? "").join("");
}

/**
 * A coarse script class for a string: the script of its first letter-like
 * character. Deliberately coarse — this is used to tell "same writing
 * system" from "different writing system", which is the distinction the
 * 31 script-variant positives turn on. It is NOT transliteration and
 * performs no conversion.
 */
export function scriptClass(value: string): string {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x0041) continue;
    if (code <= 0x024f) return "latin";
    if (code >= 0x0370 && code <= 0x03ff) return "greek";
    if (code >= 0x0400 && code <= 0x04ff) return "cyrillic";
    if (code >= 0x0590 && code <= 0x05ff) return "hebrew";
    if (code >= 0x0600 && code <= 0x06ff) return "arabic";
    if (code >= 0x0900 && code <= 0x097f) return "devanagari";
    if (code >= 0x0e00 && code <= 0x0e7f) return "thai";
    if (code >= 0x3040 && code <= 0x30ff) return "kana";
    if (code >= 0x3400 && code <= 0x9fff) return "han";
    if (code >= 0xac00 && code <= 0xd7af) return "hangul";
  }
  return "unknown";
}

/** The digit runs in a string, in order: "Fund III 2024" -> ["2024"]. */
export function digitRuns(value: string): string[] {
  return value.match(/\d+/g) ?? [];
}

/**
 * Roman-numeral tokens, which distinguish otherwise identical fund and
 * partnership names ("... Partners II" vs "... Partners III").
 */
export function romanTokens(tokens: readonly string[]): string[] {
  return tokens.filter((token) => /^(?=[ivxlcdm]+$)m*(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(token) && token.length > 0);
}
