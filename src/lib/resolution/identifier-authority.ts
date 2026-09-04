/**
 * Identifier-authority policy for Tier-A entity resolution.
 *
 * Approved 2026-09-03; the analysis behind it is in
 * docs/evaluation/identifier-authority-policy.md, and the failure that
 * prompted it is in docs/evaluation/cross-source-experiment.md.
 *
 * The rule, in one sentence: authority is a property of a
 * (source, identifier scheme) pair — the body that ISSUES a scheme is
 * authoritative for it, everyone else is making a cross-reference — and a
 * cross-reference may CORROBORATE an identity but may never ESTABLISH or
 * OVERRIDE one.
 *
 * Why this module exists at all. Tier A unions a mention with every
 * identifier its own evidence item states, and union-find is transitive,
 * so a record asserting two values of one scheme becomes a BRIDGE between
 * them. Wikidata item Q188087 states two different LEIs, which collapsed a
 * Russian PJSC and an unrelated company into a single entity at full merge
 * confidence with no warning. The defect was never that the resolver was
 * wrong once; it was that nothing in its output said so.
 *
 * Scope discipline, because this is a resolution-behaviour change:
 *   - It applies ONLY to `has_identifier` — the registry identifiers a
 *     public_record states about its own subject. The phone / account /
 *     vehicle identifiers every other evidence type carries are untouched,
 *     which is what keeps the Operation DarkNet Delhi evaluation
 *     unchanged.
 *   - No fuzzy matching, no embeddings, no adjudication, no ML. Nothing
 *     here reads a name.
 */

/**
 * Schemes whose values may establish identity by themselves in Tier A.
 *
 * LEI only, deliberately. An LEI denotes exactly one legal entity
 * (ISO 17442) and is globally unique, so two records stating the same LEI
 * are two observations of one subject. A Wikidata QID identifies a
 * Wikidata ITEM, which is not the same claim: items are merged, split and
 * repurposed by editors, and one item can carry several LEIs — the very
 * shape that caused the false merge. QIDs are therefore kept as
 * source-local identity and context and never used to merge, until some
 * scheme is explicitly added here by a governance decision.
 */
export const MERGEABLE_IDENTIFIER_SCHEMES: ReadonlySet<string> = new Set(["LEI"]);

/**
 * The registry key of the publisher that ISSUES each scheme. A record from
 * any other registry stating that scheme is making a cross-reference.
 *
 * The governance record for this is the `issues_identifier_schemes` column
 * of docs/data-research/source-registry.csv. These constants must agree
 * with it, and `tests/unit/identifier-authority.test.ts` fails if they
 * drift — the CSV is the decision, this is the executable form of it.
 */
export const SCHEME_ISSUER_REGISTRY: Readonly<Record<string, string>> = {
  LEI: "gleif",
  WIKIDATA: "wikidata",
  // P6.19: the SEC issues the CIK, so a CIK carried by Wikidata (P5531)
  // is a cross-reference and cannot establish identity, exactly as a
  // Wikidata-carried LEI cannot. Declaring the issuer does NOT make the
  // scheme mergeable — MERGEABLE_IDENTIFIER_SCHEMES is still {LEI}.
  CIK: "edgar",
};

/** Registry key -> its row in the source registry. */
export const REGISTRY_SOURCE_IDS: Readonly<Record<string, string>> = {
  gleif: "SRC-002",
  wikidata: "SRC-001",
  edgar: "SRC-006",
};

/** The `has_identifier` relationship type, the only one this policy governs. */
export const REGISTRY_IDENTIFIER_RELATIONSHIP = "has_identifier";

export interface SchemeConflict {
  scheme: string;
  /** Every value of that scheme the single record asserted, sorted. */
  values: string[];
}

export interface IdentifierPolicyResult {
  /** Scheme-qualified values that may be unioned in Tier A. */
  mergeable: string[];
  /**
   * Values retained for provenance and context but never unioned: schemes
   * outside the allowlist (QIDs), and every value of a scheme that
   * conflicts with itself on this record.
   */
  contextOnly: string[];
  /** Schemes this record asserted more than one distinct value of. */
  conflicts: SchemeConflict[];
}

/** Splits `SCHEME:value`, the form extraction emits for registry identifiers. */
export function parseSchemeQualified(qualified: string): { scheme: string; value: string } | null {
  const separator = qualified.indexOf(":");
  if (separator <= 0 || separator === qualified.length - 1) return null;
  return { scheme: qualified.slice(0, separator), value: qualified.slice(separator + 1) };
}

/**
 * Applies the policy to the registry identifiers one record states about
 * its own subject.
 *
 * A scheme asserting two or more distinct values on ONE record is a
 * self-contradiction the record cannot resolve: at most one can be right,
 * and nothing in the record says which. Every value of that scheme is
 * therefore withheld from the union — not just the extras — because
 * picking one would be a guess wearing a merge's confidence, and picking
 * by order would make the outcome depend on payload ordering. The record
 * is flagged instead, which is what the resolver already does one tier up
 * for an ambiguous name.
 *
 * Pure and order-independent: same input set, same output, always.
 */
export function applyIdentifierPolicy(qualifiedValues: string[]): IdentifierPolicyResult {
  const valuesByScheme = new Map<string, Set<string>>();
  const unparsed: string[] = [];

  for (const qualified of qualifiedValues) {
    const parsed = parseSchemeQualified(qualified);
    if (!parsed) {
      // Not scheme-qualified. Never merged on: an unqualified value could
      // collide across schemes, which is the collision the qualification
      // exists to prevent.
      unparsed.push(qualified);
      continue;
    }
    const set = valuesByScheme.get(parsed.scheme) ?? new Set<string>();
    set.add(qualified);
    valuesByScheme.set(parsed.scheme, set);
  }

  const mergeable: string[] = [];
  const contextOnly: string[] = [...unparsed];
  const conflicts: SchemeConflict[] = [];

  for (const [scheme, values] of valuesByScheme) {
    const sorted = [...values].sort();
    if (!MERGEABLE_IDENTIFIER_SCHEMES.has(scheme)) {
      contextOnly.push(...sorted);
      continue;
    }
    if (sorted.length > 1) {
      conflicts.push({ scheme, values: sorted });
      contextOnly.push(...sorted);
      continue;
    }
    mergeable.push(...sorted);
  }

  return {
    mergeable: mergeable.sort(),
    contextOnly: contextOnly.sort(),
    conflicts: conflicts.sort((a, b) => (a.scheme < b.scheme ? -1 : a.scheme > b.scheme ? 1 : 0)),
  };
}

/** Human-readable conflict text for a decision's `conflicts[]` and the warning log. */
export function describeConflict(conflict: SchemeConflict, registry: string | null): string {
  const issuer = SCHEME_ISSUER_REGISTRY[conflict.scheme];
  const authority =
    registry && issuer && registry === issuer
      ? `${registry} issues ${conflict.scheme}, so this is a self-contradiction in the authoritative source`
      : issuer
        ? `${registry ?? "this record"} does not issue ${conflict.scheme} (${issuer} does), so these are cross-references and neither can establish identity`
        : `no issuer is registered for ${conflict.scheme}`;
  return (
    `Record asserts ${conflict.values.length} distinct ${conflict.scheme} values (${conflict.values.join(", ")}); ` +
    `${authority}. Not merged on any of them — an identifier scheme that contradicts itself on one record cannot establish identity.`
  );
}
