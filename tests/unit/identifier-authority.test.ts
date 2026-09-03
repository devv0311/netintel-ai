import { describe, it, expect } from "vitest";

import {
  applyIdentifierPolicy,
  describeConflict,
  parseSchemeQualified,
  MERGEABLE_IDENTIFIER_SCHEMES,
  SCHEME_ISSUER_REGISTRY,
  REGISTRY_SOURCE_IDS,
} from "@/lib/resolution/identifier-authority";
import { loadRegistry } from "@/lib/adapters/public/registry";

/**
 * The identifier-authority policy in isolation: pure functions, no
 * database, no pipeline. The resolver's use of them is covered in
 * tests/unit/resolution.test.ts.
 */
describe("identifier authority — policy", () => {
  const LEI_A = "LEI:AAAAAAAAAAAAAAAAAAAA";
  const LEI_B = "LEI:BBBBBBBBBBBBBBBBBBBB";

  it("parses scheme-qualified values, and refuses shapes that are not", () => {
    expect(parseSchemeQualified(LEI_A)).toEqual({ scheme: "LEI", value: "AAAAAAAAAAAAAAAAAAAA" });
    // A value containing a colon keeps everything after the FIRST one.
    expect(parseSchemeQualified("URI:https://x/y")).toEqual({ scheme: "URI", value: "https://x/y" });
    expect(parseSchemeQualified("nocolon")).toBeNull();
    expect(parseSchemeQualified(":leadingcolon")).toBeNull();
    expect(parseSchemeQualified("trailingcolon:")).toBeNull();
  });

  it("allows a single value of a mergeable scheme to merge", () => {
    const result = applyIdentifierPolicy([LEI_A]);
    expect(result.mergeable).toEqual([LEI_A]);
    expect(result.conflicts).toEqual([]);
  });

  it("withholds EVERY value of a scheme that contradicts itself, not just the extras", () => {
    // Keeping the first would make identity depend on payload ordering,
    // and keeping either would be a guess carrying a merge's confidence.
    const result = applyIdentifierPolicy([LEI_B, LEI_A]);
    expect(result.mergeable).toEqual([]);
    expect(result.contextOnly).toEqual([LEI_A, LEI_B]);
    expect(result.conflicts).toEqual([{ scheme: "LEI", values: [LEI_A, LEI_B] }]);
  });

  it("treats a repeated identical value as one value, not a conflict", () => {
    const result = applyIdentifierPolicy([LEI_A, LEI_A]);
    expect(result.mergeable).toEqual([LEI_A]);
    expect(result.conflicts).toEqual([]);
  });

  it("keeps non-mergeable schemes as context and never merges on them", () => {
    const result = applyIdentifierPolicy(["WIKIDATA:Q42"]);
    expect(result.mergeable).toEqual([]);
    expect(result.contextOnly).toEqual(["WIKIDATA:Q42"]);
    expect(result.conflicts).toEqual([]);
  });

  it("does not treat two QIDs as a conflict — a non-merging scheme cannot bridge anything", () => {
    const result = applyIdentifierPolicy(["WIKIDATA:Q1", "WIKIDATA:Q2"]);
    expect(result.mergeable).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });

  it("isolates schemes: an LEI conflict does not suppress a clean value of another scheme", () => {
    const result = applyIdentifierPolicy([LEI_A, LEI_B, "WIKIDATA:Q1"]);
    expect(result.conflicts.map((c) => c.scheme)).toEqual(["LEI"]);
    expect(result.mergeable).toEqual([]);
    expect(result.contextOnly).toContain("WIKIDATA:Q1");
  });

  it("never merges on an unqualified value", () => {
    // An unqualified value could collide across schemes, which is exactly
    // what qualification exists to prevent.
    const result = applyIdentifierPolicy(["AAAAAAAAAAAAAAAAAAAA"]);
    expect(result.mergeable).toEqual([]);
    expect(result.contextOnly).toEqual(["AAAAAAAAAAAAAAAAAAAA"]);
  });

  it("is order-independent", () => {
    const a = applyIdentifierPolicy([LEI_A, "WIKIDATA:Q1", LEI_B]);
    const b = applyIdentifierPolicy(["WIKIDATA:Q1", LEI_B, LEI_A]);
    expect(a).toEqual(b);
  });

  it("names the authority position in the conflict message", () => {
    const conflict = { scheme: "LEI", values: [LEI_A, LEI_B] };
    const crossReference = describeConflict(conflict, "wikidata");
    expect(crossReference).toContain("does not issue LEI");
    expect(crossReference).toContain("gleif");

    const selfContradiction = describeConflict(conflict, "gleif");
    expect(selfContradiction).toContain("self-contradiction");
  });
});

/**
 * The source registry is the governance record for identifier authority;
 * the constants in identifier-authority.ts are its executable form. If the
 * two drift, the code is enforcing a policy nobody approved.
 */
describe("identifier authority — code agrees with the source registry", () => {
  it("every scheme the code claims an issuer for is declared by that source in the registry", () => {
    const registry = loadRegistry();
    for (const [scheme, registryKey] of Object.entries(SCHEME_ISSUER_REGISTRY)) {
      const sourceId = REGISTRY_SOURCE_IDS[registryKey];
      expect(sourceId, `no source id mapped for registry key "${registryKey}"`).toBeDefined();
      const entry = registry.get(sourceId!);
      expect(entry, `${sourceId} missing from the source registry`).toBeDefined();
      expect(
        entry!.issuesIdentifierSchemes,
        `${sourceId} (${registryKey}) must declare issues_identifier_schemes=${scheme}`,
      ).toContain(scheme);
    }
  });

  it("every scheme approved for merging has a registered authoritative issuer", () => {
    for (const scheme of MERGEABLE_IDENTIFIER_SCHEMES) {
      expect(SCHEME_ISSUER_REGISTRY[scheme], `${scheme} may merge but has no issuer`).toBeDefined();
    }
  });

  it("LEI is the only scheme currently approved for Tier-A auto-merge", () => {
    // Governance decision of 2026-09-03. Widening this set is a policy
    // change, not a refactor: a QID identifies a Wikidata item, which is
    // not the same claim as one legal entity.
    expect([...MERGEABLE_IDENTIFIER_SCHEMES].sort()).toEqual(["LEI"]);
    expect(SCHEME_ISSUER_REGISTRY.LEI).toBe("gleif");
  });

  it("no source declares itself the issuer of a scheme another source also issues", () => {
    const registry = loadRegistry();
    const issuers = new Map<string, string[]>();
    for (const [, entry] of registry) {
      for (const scheme of entry.issuesIdentifierSchemes) {
        issuers.set(scheme, [...(issuers.get(scheme) ?? []), entry.sourceId]);
      }
    }
    for (const [scheme, sources] of issuers) {
      expect(sources, `${scheme} is claimed by more than one issuer: ${sources.join(", ")}`).toHaveLength(1);
    }
  });
});
