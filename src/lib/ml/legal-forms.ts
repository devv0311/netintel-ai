/**
 * P6.27 — legal-form boilerplate, and why identity is the RARE part of a name.
 *
 * P6.26 measured a candidate model merging `Sabiedriba ar ierobezotu
 * atbildibu "AKZ"` with `Frigate AS` at 0.9922 — a Latvian chemicals company
 * and a Norwegian one, joined because `sabiedriba ar ierobezotu atbildibu` is
 * Latvian for "limited liability company" and Latvian records spell it out
 * inside the legal name. Thirty characters of shared boilerplate read as name
 * agreement to every character- and token-similarity feature in the set.
 *
 * This module supplies two answers to that, and the second is the one that
 * generalises.
 *
 * 1. A mined VOCABULARY of legal forms (`stripLegalForms`). Precise,
 *    explainable, and narrow — five forms, because the miner rejects every
 *    candidate that cannot prove itself against four vetoes. A decision row
 *    can name the form it removed, which matters for an investigative tool.
 *
 * 2. INVERSE DOCUMENT FREQUENCY over training tokens (`idf`, and the weighted
 *    similarities built on it). This is the general lever. The vocabulary
 *    cannot cover Latvian, because the training corpora hold too few Latvian
 *    records to support any claim about Latvian — and the only evidence that
 *    Latvian mattered came from a frozen test that is now spent, so importing
 *    it would be fitting to that test. But the property the Latvian case
 *    shares with every other boilerplate case survives the language barrier:
 *    boilerplate is COMMON and identity is RARE. `sabiedriba`, `ierobezotu`
 *    and `atbildibu` recur across a jurisdiction; `akz` and `frigate` occur
 *    once each. IDF reads that without being told a word of Latvian, and
 *    keeps working in languages this corpus has never seen.
 *
 * NOTHING HERE IS THE RESOLVER'S. `src/lib/resolution/name-normalization.ts`
 * governs deterministic merge behaviour and is untouched by this file; these
 * are ML features and the model they feed is advisory. The separation is the
 * same one `LEGAL_FORM_GROUPS` in `features.ts` already keeps, and for the
 * same reason: adding a form to the resolver to help a classifier would
 * change how every name in the product resolves.
 */
import { LEGAL_FORM_VOCABULARY as vocabulary } from "./legal-form-vocabulary";

interface MinedForm {
  form: string;
  position: "leading" | "trailing";
  tokens: number;
}

const FORMS: MinedForm[] = (vocabulary.forms as readonly MinedForm[])
  .slice()
  // Longest first, so "public joint stock company" is consumed before any
  // shorter form nested inside it can be.
  .sort((a, b) => b.tokens - a.tokens);

const DOCUMENT_FREQUENCY = vocabulary.tokenDocumentFrequency.frequencies as Record<string, number>;
const DOCUMENT_COUNT = vocabulary.tokenDocumentFrequency.documentCount;
const MIN_DOCUMENT_FREQUENCY = vocabulary.tokenDocumentFrequency.minDocumentFrequency;

export const LEGAL_FORM_VOCABULARY_VERSION = vocabulary.vocabularyVersion;
export const LEGAL_FORM_COUNT = FORMS.length;

/**
 * Folding shared with the miner, character for character.
 *
 * Diacritics are stripped because publishers disagree about them far more
 * often than they disagree about words — "Prvá stavebná sporiteľňa" against
 * "Prva stavebna sporitelna" is one company written twice. Deliberately NOT
 * the resolver's `normalizeName`, which strips trailing English legal
 * suffixes and would therefore erase the signal this module measures.
 */
export const foldName = (value: string): string =>
  value
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    // Dots are REMOVED, not turned into spaces, so "S.A." reads as one token
    // `sa` and matches a publisher who wrote "SA". Measured on the training
    // corpora before it was adopted: 37 positive pairs match only under this
    // rule, against 2 negatives that would wrongly match - and those 2 are one
    // J&T fund pair counted in both directions. The same convention, for the
    // same reason, is already used by `legalFormOf` in features.ts.
    .replace(/[.]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The name with mined legal forms removed from its edges, repeatedly, until
 * nothing more matches.
 *
 * Never returns empty: a name that is nothing BUT a legal form keeps its last
 * form, because an empty comparison key would make every such record match
 * every other one — the exact failure this module exists to prevent, arrived
 * at from the other direction.
 */
export const stripLegalForms = (value: string): string => {
  let tokens = foldName(value).split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return "";
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of FORMS) {
      const width = entry.tokens;
      if (tokens.length <= width) continue;
      const slice =
        entry.position === "leading" ? tokens.slice(0, width) : tokens.slice(tokens.length - width);
      if (slice.join(" ") !== entry.form) continue;
      tokens =
        entry.position === "leading" ? tokens.slice(width) : tokens.slice(0, tokens.length - width);
      changed = true;
      break;
    }
  }
  return tokens.join(" ");
};

/**
 * Inverse document frequency for a folded token, over distinct training
 * entities.
 *
 * A token the training corpora never saw is treated as maximally rare rather
 * than as unknown, and that is the deliberate choice: an unseen token is far
 * more likely to be a company's own name than a legal form, because forms are
 * exactly the things that recur. The floor is the singleton weight, so an
 * unseen token can never outrank a token actually observed once.
 */
export const idf = (token: string): number => {
  const df = DOCUMENT_FREQUENCY[token] ?? MIN_DOCUMENT_FREQUENCY - 1;
  return Math.log((DOCUMENT_COUNT + 1) / (Math.max(df, 1) + 1)) + 1;
};

const weigh = (tokens: readonly string[]): Map<string, number> => {
  const weights = new Map<string, number>();
  for (const token of tokens) if (!weights.has(token)) weights.set(token, idf(token));
  return weights;
};

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const value of values) total += value;
  return total;
};

/**
 * IDF-weighted Jaccard. Two names sharing only boilerplate score near zero
 * however much boilerplate they share; two names sharing one rare token score
 * high on the strength of that token alone.
 */
export const weightedJaccard = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const left = weigh(a);
  const right = weigh(b);
  let intersection = 0;
  for (const [token, weight] of left) if (right.has(token)) intersection += weight;
  const union = sum(left.values()) + sum(right.values()) - intersection;
  return union === 0 ? 0 : intersection / union;
};

/** IDF-weighted containment, against the lighter side — symmetric by construction. */
export const weightedContainment = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const left = weigh(a);
  const right = weigh(b);
  let intersection = 0;
  for (const [token, weight] of left) if (right.has(token)) intersection += weight;
  const smaller = Math.min(sum(left.values()), sum(right.values()));
  return smaller === 0 ? 0 : intersection / smaller;
};

/**
 * The IDF of the rarest token the two names share, normalised to [0,1] by the
 * maximum weight the table can produce.
 *
 * This is the single most direct statement of the P6.26 defect. Two unrelated
 * Latvian and Norwegian companies share `sabiedriba`, `ar`, `ierobezotu`,
 * `atbildibu` — four tokens, every one of them common, so the rarest shared
 * token is still common and this feature is near zero. Two records of one
 * company share its actual name, which is rare, and this feature is near one.
 * Token COUNT cannot tell those apart; token RARITY can.
 */
export const maxSharedIdf = (a: readonly string[], b: readonly string[]): number => {
  if (a.length === 0 || b.length === 0) return 0;
  const right = new Set(b);
  let best = 0;
  for (const token of a) if (right.has(token)) best = Math.max(best, idf(token));
  const ceiling = idf(" never-observed-token");
  return ceiling === 0 ? 0 : Math.min(best / ceiling, 1);
};
