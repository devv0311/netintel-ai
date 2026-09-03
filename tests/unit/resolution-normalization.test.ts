import { describe, it, expect } from "vitest";

import { makeContentId } from "@/lib/domain/ids";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import { resolveEntities, CONFIDENCE } from "@/lib/resolution/resolve";
import { MERGE_CONFIDENCE_FLOOR } from "@/lib/domain/resolution";

/**
 * Tier B2 (normalised name match) and the P6.17.2 resolution semantics.
 *
 * `resolveEntities` is pure, so these need no database.
 *
 * The fixtures use the REAL publisher strings P6.16 measured wherever a
 * real pair exists. The point of the suite is not that normalisation
 * works on invented input - it is that it joins the pairs that actually
 * failed, and does NOT join the pairs that actually must not.
 */

function record(opts: {
  evidenceItemId: string;
  recordType: ExtractedRecord["recordType"];
  data: Record<string, unknown>;
  fieldPath: string;
}): ExtractedRecord {
  return {
    id: makeContentId("extracted_record", [opts.evidenceItemId, opts.fieldPath]),
    evidenceItemId: opts.evidenceItemId,
    recordType: opts.recordType,
    data: opts.data,
    classification: "observed_fact",
    provenance: {
      source: opts.evidenceItemId,
      location: `fixture:${opts.evidenceItemId}#${opts.fieldPath}`,
      method: "extraction:field-read:fixture",
      confidence: 1,
      processingHistory: [`evidence_item:${opts.evidenceItemId}`, "extraction:fixture"],
      timestamp: "2026-01-01T00:00:00.000Z",
    },
  };
}

/** An organisation mention, with or without registry identifiers of its own. */
function org(
  evidenceItemId: string,
  name: string,
  identifiers: string[] = [],
  registry = "gleif",
): ExtractedRecord[] {
  return [
    record({
      evidenceItemId,
      recordType: "entity_mention",
      fieldPath: "name",
      data: {
        factType: "organisation_named",
        mentionKind: "organisation",
        observedValue: name,
        registry,
      },
    }),
    ...identifiers.map((qualified, i) =>
      record({
        evidenceItemId,
        recordType: "relationship_mention",
        fieldPath: `identifiers[${i}]`,
        data: {
          factType: "subject_has_identifier",
          relationshipType: "has_identifier",
          subject: name,
          observedValue: qualified,
          scheme: qualified.slice(0, qualified.indexOf(":")),
        },
      }),
    ),
  ];
}

const LEI_A = "LEI:AAAAAAAAAAAAAAAAAAAA";
const LEI_B = "LEI:BBBBBBBBBBBBBBBBBBBB";
const LEI_C = "LEI:CCCCCCCCCCCCCCCCCCCC";

const resolve = (records: ExtractedRecord[]) =>
  resolveEntities(records, "investigation_norm", "2026-01-01T00:00:00.000Z");

describe("Tier B2 - normalised name match", () => {
  it("joins a real suffix-only pair that exact matching missed", () => {
    // GLEIF 'COAL INDIA LIMITED' / Wikidata 'Coal India' - POS-005.
    const output = resolve([
      ...org("gleif_coal", "COAL INDIA LIMITED", [LEI_A], "gleif"),
      ...org("wikidata_coal", "Coal India", [], "wikidata"),
    ]);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(1);
    const d = output.decisions.find((x) => x.resolutionType === "normalized_name_match");
    expect(d).toBeDefined();
    expect(d!.status).toBe("resolved");
    expect(d!.reason).toContain("coal india");
    expect(d!.reason).toContain("legal-suffix stripping");
  });

  it("joins a real capitalisation-only pair", () => {
    // GLEIF 'STATE BANK OF INDIA' / Wikidata 'State Bank of India' - POS-007.
    const output = resolve([
      ...org("gleif_sbi", "STATE BANK OF INDIA", [LEI_A], "gleif"),
      ...org("wikidata_sbi", "State Bank of India", [], "wikidata"),
    ]);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(1);
    const d = output.decisions.find((x) => x.resolutionType === "normalized_name_match");
    expect(d!.reason).toContain("case folding");
  });

  it("records a normalised match BELOW an exact match and far below an identifier merge", () => {
    expect(CONFIDENCE.normalizedNameMatch).toBeLessThan(CONFIDENCE.exactNameMatch);
    expect(CONFIDENCE.normalizedNameMatch).toBeLessThan(CONFIDENCE.sharedIdentifierMerge);
    // Still applied rather than merely proposed - the approved decision.
    expect(CONFIDENCE.normalizedNameMatch).toBeGreaterThan(MERGE_CONFIDENCE_FLOOR);
  });

  it("carries that confidence onto the decision, so evidence strength is visible", () => {
    const output = resolve([
      ...org("gleif_itc", "ITC LIMITED", [LEI_A], "gleif"),
      ...org("wikidata_itc", "ITC Limited", [], "wikidata"),
    ]);
    const d = output.decisions.find((x) => x.resolutionType === "normalized_name_match")!;
    expect(d.provenance.confidence).toBe(CONFIDENCE.normalizedNameMatch);
  });

  it("never reports an EXACT match as a normalised one", () => {
    const output = resolve([
      ...org("gleif_x", "ACME LIMITED", [LEI_A], "gleif"),
      ...org("other_x", "ACME LIMITED", [], "wikidata"),
    ]);
    expect(output.decisions.some((d) => d.resolutionType === "exact_name_match")).toBe(true);
    expect(output.decisions.some((d) => d.resolutionType === "normalized_name_match")).toBe(false);
  });

  it("an exact match still wins when normalisation would reach a different cluster", () => {
    // 'ACME' exactly matches cluster A; it would also normalise onto
    // 'ACME LIMITED' (cluster B). Exact must win, and there must be no
    // ambiguity flag, because the publishers' own strings did agree.
    const output = resolve([
      ...org("gleif_a", "ACME", [LEI_A], "gleif"),
      ...org("gleif_b", "ACME LIMITED", [LEI_B], "gleif"),
      ...org("wikidata_a", "ACME", [], "wikidata"),
    ]);
    const d = output.decisions.find((x) => x.extractedRecordIds.some((id) => id.length > 0) &&
      x.resolutionType === "exact_name_match");
    expect(d).toBeDefined();
    expect(output.decisions.some((x) => x.resolutionType === "ambiguous_normalized_name_conflict")).toBe(false);
  });

  it("flags rather than merges when a normalised name reaches two clusters", () => {
    const output = resolve([
      ...org("gleif_a", "ACME LIMITED", [LEI_A], "gleif"),
      ...org("gleif_b", "Acme Ltd", [LEI_B], "gleif"),
      ...org("wikidata_a", "Acme", [], "wikidata"),
    ]);
    const flagged = output.decisions.find(
      (d) => d.resolutionType === "ambiguous_normalized_name_conflict",
    );
    expect(flagged).toBeDefined();
    expect(flagged!.status).toBe("ambiguous");
    expect(flagged!.candidateEntityIds).toHaveLength(2);
    expect(flagged!.provenance.confidence).toBeLessThan(MERGE_CONFIDENCE_FLOOR);
    expect(output.warnings.some((w) => w.includes("normalises to"))).toBe(true);
  });

  it("says the ambiguity was created by normalisation, not by the publishers", () => {
    const output = resolve([
      ...org("gleif_a", "ACME LIMITED", [LEI_A], "gleif"),
      ...org("gleif_b", "Acme Ltd", [LEI_B], "gleif"),
      ...org("wikidata_a", "Acme", [], "wikidata"),
    ]);
    const flagged = output.decisions.find(
      (d) => d.resolutionType === "ambiguous_normalized_name_conflict",
    )!;
    expect(flagged.conflicts[0]).toContain("created by normalisation");
  });
});

describe("Tier B2 - the real hard negatives are not merged", () => {
  const pairs: [string, string][] = [
    ["BHARAT HEAVY ELECTRICALS LIMITED", "BHARAT DYNAMICS LIMITED"],
    ["BHARAT DYNAMICS LIMITED", "BHARAT ELECTRONICS"],
    ["NAVNEET PRAKASHAN KENDRA", "NAVNEET EDUCATION LIMITED"],
    ["HINDUSTAN AERONAUTICS LIMITED", "HINDUSTAN ZINC LIMITED"],
    ["TATA CHEMICALS LIMITED", "TATA CONSUMER PRODUCTS LIMITED"],
    ["SUN PHARMACEUTICAL INDUSTRIES LIMITED", "SUN PARADISE"],
    ["BHATI SOLAR SOLUTIONS PRIVATE LIMITED", "RAJDEEP BHATI SOLAR SOLUTIONS PRIVATE LIMITED"],
  ];

  it.each(pairs)("keeps %s and %s as two entities", (a, b) => {
    const output = resolve([
      ...org("gleif_a", a, [LEI_A], "gleif"),
      ...org("gleif_b", b, [LEI_B], "gleif"),
    ]);
    const orgs = output.entities.filter((e) => e.kind === "organisation");
    expect(orgs).toHaveLength(2);
    expect(output.decisions.some((d) => d.resolutionType === "normalized_name_match")).toBe(false);
  });

  it("does not let a subsidiary's short name absorb an unrelated sibling", () => {
    // 'GVK' must not reach 'GVK POWER & INFRASTRUCTURE LIMITED' - no
    // subset or prefix matching exists, by design.
    const output = resolve([
      ...org("gleif_gvk", "GVK POWER & INFRASTRUCTURE LIMITED", [LEI_A], "gleif"),
      ...org("wikidata_gvk", "GVK", [], "wikidata"),
    ]);
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(2);
  });

  it("does not merge a person with an organisation however the names normalise", () => {
    const output = resolve([
      ...org("gleif_raj", "RAJ AUTOLINK", [LEI_A], "gleif"),
      ...org("gleif_raj2", "Raj Autolink Limited", [LEI_B], "gleif"),
    ]);
    // Two distinct LEIs stay two entities: Tier A anchored both, and
    // Tier B never runs for a mention that already has an identifier.
    expect(output.entities.filter((e) => e.kind === "organisation")).toHaveLength(2);
    expect(LEI_C).toBeDefined();
  });
});

describe("P6.17.2 - an unresolved mention can never look like a success", () => {
  it("marks an uncorroborated mention unresolved, not resolved/new_entity", () => {
    const output = resolve([...org("lonely", "Some Unlinked Company", [], "wikidata")]);
    const d = output.decisions[0]!;
    expect(d.resolutionType).toBe("unlinked_mention");
    expect(d.status).toBe("unresolved");
    // The old behaviour, pinned so it cannot silently return.
    expect(d.status).not.toBe("resolved");
    expect(d.resolutionType).not.toBe("new_entity");
  });

  it("keeps new_entity for a mention genuinely anchored by its own identifier", () => {
    const output = resolve([...org("anchored", "ANCHORED LIMITED", [LEI_A], "gleif")]);
    const d = output.decisions[0]!;
    expect(d.resolutionType).toBe("new_entity");
    expect(d.status).toBe("resolved");
  });

  it("explains WHY it did not resolve, naming both keys it searched", () => {
    const output = resolve([...org("lonely", "Coal India", [], "wikidata")]);
    const d = output.decisions[0]!;
    expect(d.reason).toContain("Coal India");
    expect(d.reason).toContain("coal india");
    expect(d.reason).toContain("UNRESOLVED");
  });

  it("emits ONE aggregate warning, not one per unresolved mention", () => {
    const output = resolve([
      ...org("a", "Alpha Co Unlinked", [], "wikidata"),
      ...org("b", "Beta Co Unlinked", [], "wikidata"),
      ...org("c", "Gamma Co Unlinked", [], "wikidata"),
    ]);
    const unlinkedWarnings = output.warnings.filter((w) => w.includes("did not resolve"));
    expect(unlinkedWarnings).toHaveLength(1);
    expect(unlinkedWarnings[0]).toContain("3 of 3");
  });

  it("emits no unresolved warning when everything resolved", () => {
    const output = resolve([
      ...org("gleif_coal", "COAL INDIA LIMITED", [LEI_A], "gleif"),
      ...org("wikidata_coal", "Coal India", [], "wikidata"),
    ]);
    expect(output.warnings.filter((w) => w.includes("did not resolve"))).toHaveLength(0);
  });

  it("still creates an entity for the unresolved mention - nothing is dropped", () => {
    const output = resolve([...org("lonely", "Some Unlinked Company", [], "wikidata")]);
    expect(output.entities).toHaveLength(1);
    expect(output.entities[0]!.canonicalLabel).toBe("Some Unlinked Company");
  });

  it("distinguishes all four outcomes in one run", () => {
    const output = resolve([
      ...org("gleif_a", "ACME LIMITED", [LEI_A], "gleif"),          // new_entity / resolved
      ...org("gleif_b", "Beta Ltd", [LEI_B], "gleif"),              // new_entity / resolved
      ...org("wd_exact", "ACME LIMITED", [], "wikidata"),           // exact_name_match / resolved
      ...org("wd_norm", "Beta", [], "wikidata"),                    // normalized_name_match / resolved
      ...org("wd_lonely", "Totally Unrelated Name", [], "wikidata"), // unlinked_mention / unresolved
    ]);
    const types = new Set(output.decisions.map((d) => d.resolutionType));
    expect(types.has("new_entity")).toBe(true);
    expect(types.has("exact_name_match")).toBe(true);
    expect(types.has("normalized_name_match")).toBe(true);
    expect(types.has("unlinked_mention")).toBe(true);
    const statuses = new Set(output.decisions.map((d) => d.status));
    expect(statuses.has("resolved")).toBe(true);
    expect(statuses.has("unresolved")).toBe(true);
  });
});
