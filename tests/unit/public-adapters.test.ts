import { describe, expect, it } from "vitest";

import {
  SourceNotApprovedError,
  loadRegistry,
  requireApprovedSource,
} from "@/lib/adapters/public/registry";
import {
  GLEIF_SOURCE_ID,
  MAX_LIMIT as GLEIF_MAX,
  mapGleifRecord,
  mapGleifRelationship,
  normaliseGleifPredicate,
  planGleif,
} from "@/lib/adapters/public/gleif";
import {
  MAX_LIMIT as WD_MAX,
  QUERIES,
  WIKIDATA_SOURCE_ID,
  mapWikidataBinding,
  planWikidata,
} from "@/lib/adapters/public/wikidata";

const CONTEXT = {
  retrievedAt: "2026-09-03T00:00:00.000Z",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
};

/**
 * The adapters' most important property is what they REFUSE. These tests
 * are mostly refusals for that reason.
 */

describe("source registry gate", () => {
  it("reads the research registry", () => {
    expect(loadRegistry().size).toBeGreaterThan(10);
  });

  it("allows the two approved public sources", () => {
    expect(requireApprovedSource(WIKIDATA_SOURCE_ID).status).toBe("APPROVED");
    expect(requireApprovedSource(GLEIF_SOURCE_ID).status).toBe("APPROVED");
  });

  it("refuses a source under manual review (OpenSanctions, CC BY-NC)", () => {
    expect(() => requireApprovedSource("SRC-012")).toThrow(SourceNotApprovedError);
  });

  it("refuses a rejected source (NCRB aggregate statistics)", () => {
    expect(() => requireApprovedSource("SRC-015")).toThrow(SourceNotApprovedError);
  });

  it("refuses a source that is not in the registry at all", () => {
    expect(() => requireApprovedSource("SRC-999")).toThrow(SourceNotApprovedError);
  });
});

describe("bounded planning", () => {
  it("caps the limit at the adapter's own maximum, however large the request", () => {
    expect(planGleif({ jurisdiction: "IN" }, { limit: 10_000_000 }).limit).toBe(GLEIF_MAX);
    expect(planWikidata("indian-companies-with-lei", { limit: 10_000_000 }).limit).toBe(WD_MAX);
  });

  it("puts an explicit LIMIT in every SPARQL query", () => {
    for (const build of Object.values(QUERIES)) {
      expect(build(50)).toMatch(/LIMIT 50\s*$/);
    }
  });

  it("carries the licence and rate limit from the registry, not from the code", () => {
    const plan = planWikidata("indian-companies-with-lei", { limit: 10 });
    expect(plan.license).toBe(requireApprovedSource(WIKIDATA_SOURCE_ID).license);
    expect(plan.rateLimit).toBe(requireApprovedSource(WIKIDATA_SOURCE_ID).rateLimit);
  });
});

describe("GLEIF mapping", () => {
  const raw = {
    attributes: {
      lei: "TESTLEI0000000000001",
      entity: {
        legalName: { name: "Bharat Chemicals Private Limited" },
        otherNames: [{ name: "Bharat Chemicals Pvt Ltd" }],
      },
      registration: { lastUpdateDate: "2026-01-15T00:00:00Z" },
    },
  };

  it("produces a public_record with mandatory provenance", () => {
    const record = mapGleifRecord(raw, CONTEXT)!;
    expect(record.recordRef).toBe("gleif:TESTLEI0000000000001");
    expect(record.license).toBe("CC0-1.0");
    expect(record.sourceUrl).toContain("TESTLEI0000000000001");
    expect(record.identifiers).toEqual([{ scheme: "LEI", value: "TESTLEI0000000000001" }]);
  });

  it("does NOT normalise the corporate suffix", () => {
    expect(mapGleifRecord(raw, CONTEXT)!.name).toBe("Bharat Chemicals Private Limited");
  });

  it("returns null rather than a partial record when the LEI or name is missing", () => {
    expect(mapGleifRecord({ attributes: { lei: "X" } }, CONTEXT)).toBeNull();
    expect(mapGleifRecord({ attributes: { entity: { legalName: { name: "X" } } } }, CONTEXT)).toBeNull();
  });
});

describe("Wikidata mapping", () => {
  const binding = {
    item: { value: "http://www.wikidata.org/entity/Q90000001" },
    itemLabel: { value: "Nilgiri Textile Mills Company" },
    itemLabelHi: { value: "नीलगिरि टेक्सटाइल मिल्स कंपनी" },
    lei: { value: "TESTLEI0000000000009" },
  };

  it("keeps both scripts — the Hindi label becomes an alias, not a discard", () => {
    const record = mapWikidataBinding(binding, CONTEXT)!;
    expect(record.aliases).toEqual(["नीलगिरि टेक्सटाइल मिल्स कंपनी"]);
  });

  it("carries the LEI alongside the QID so cross-source linkage is possible", () => {
    const record = mapWikidataBinding(binding, CONTEXT)!;
    expect(record.identifiers).toEqual([
      { scheme: "WIKIDATA", value: "Q90000001" },
      { scheme: "LEI", value: "TESTLEI0000000000009" },
    ]);
  });

  it("rejects a binding whose item URI is not a QID", () => {
    expect(
      mapWikidataBinding({ item: { value: "http://example.com/not-a-qid" }, itemLabel: { value: "X" } }, CONTEXT),
    ).toBeNull();
  });
});

/**
 * P6.20 — GLEIF Level 2.
 *
 * SRC-002 has always been registered as "GLEIF LEI (Level 1 + Level 2)"
 * and the adapter has always been able to MAP a relationship record, but
 * nothing ever REQUESTED one: the only endpoint called was /lei-records,
 * so the mapping branch could not fire and relationship coverage read 0
 * for the whole project. These tests pin the request side, because that
 * is the half that was missing and the half a refactor could silently
 * drop again.
 */
describe("GLEIF Level 2 relationships", () => {
  it("is inert without an explicit LEI list — there is no bulk relationship mode", () => {
    // Relationships are a per-record sub-resource. Asked for against a
    // jurisdiction page there is no record to hang them on, so the flag
    // must not quietly widen the request.
    const plan = planGleif({ jurisdiction: "IN", withRelationships: true }, { limit: 100 });
    expect(plan.request).not.toContain("Level 2");
    expect(plan.estimatedRequests).toBe(1);
  });

  it("prices every relationship request in the plan the dry-run gate prints", () => {
    const leis = ["R0MUWSFPU8MPRO8K5P83", "2138002BJWNWW7MFZ169"];
    const without = planGleif({ jurisdiction: "IN", leis }, { limit: 10 });
    const withRel = planGleif({ jurisdiction: "IN", leis, withRelationships: true }, { limit: 10 });
    // Two parent look-ups per LEI, on top of the Level 1 batch. A plan
    // that under-reports its request count makes --dry-run useless as a
    // gate, which is the only thing standing between this collector and
    // an unbounded run.
    expect(withRel.estimatedRequests).toBe(without.estimatedRequests + leis.length * 2);
    expect(withRel.request).toContain("direct-parent-relationship");
    expect(withRel.request).toContain("ultimate-parent-relationship");
  });

  it("stays inside MAX_LIMIT when relationships are requested", () => {
    const leis = Array.from({ length: 900 }, (_, i) => `TESTLEI${String(i).padStart(13, "0")}`);
    const plan = planGleif({ jurisdiction: "IN", leis, withRelationships: true }, { limit: 10_000 });
    expect(plan.limit).toBe(GLEIF_MAX);
    expect(plan.estimatedRequests).toBeLessThanOrEqual(GLEIF_MAX * 2 + Math.ceil(GLEIF_MAX / 40));
  });

  it("folds the publisher's predicate punctuation without translating its meaning", () => {
    // GLEIF writes IS_FUND-MANAGED_BY. Only the separators change.
    expect(normaliseGleifPredicate("IS_ULTIMATELY_CONSOLIDATED_BY")).toBe("is_ultimately_consolidated_by");
    expect(normaliseGleifPredicate("IS_FUND-MANAGED_BY")).toBe("is_fund_managed_by");
  });

  it("refuses a relationship whose ends are not both LEIs", () => {
    // The schema's targetRegistryRecordId is a registry id. A non-LEI
    // node would silently become one and assert a relation between an
    // LEI and something that is not an entity key at all.
    const base = {
      attributes: {
        relationship: {
          startNode: { id: "2138002BJWNWW7MFZ169", type: "LEI" },
          endNode: { id: "R0MUWSFPU8MPRO8K5P83", type: "LEI" },
          type: "IS_ULTIMATELY_CONSOLIDATED_BY",
        },
      },
    };
    expect(mapGleifRelationship(base)).toEqual({
      startLei: "2138002BJWNWW7MFZ169",
      predicate: "is_ultimately_consolidated_by",
      endLei: "R0MUWSFPU8MPRO8K5P83",
    });
    expect(
      mapGleifRelationship({
        attributes: {
          relationship: {
            ...base.attributes.relationship,
            endNode: { id: "12345", type: "BIC" },
          },
        },
      }),
    ).toBeNull();
    expect(mapGleifRelationship({ attributes: { relationship: { startNode: { id: "X", type: "LEI" } } } })).toBeNull();
  });

  it("attaches a stated relation to the record without asserting identity", () => {
    const record = mapGleifRecord(
      { attributes: { lei: "2138002BJWNWW7MFZ169", entity: { legalName: { name: "BNP PARIBAS CARDIF POJISTOVNA" } } } },
      {
        ...CONTEXT,
        relations: [
          { predicate: "is_ultimately_consolidated_by", targetRegistryRecordId: "R0MUWSFPU8MPRO8K5P83" },
        ],
      },
    )!;
    // Both ends stay PUBLISHER ids. A relation is a statement about two
    // registry records, never a CIPHER entity id and never a merge.
    expect(record.relations).toEqual([
      { predicate: "is_ultimately_consolidated_by", targetRegistryRecordId: "R0MUWSFPU8MPRO8K5P83" },
    ]);
    expect(record.identifiers).toEqual([{ scheme: "LEI", value: "2138002BJWNWW7MFZ169" }]);
  });
});
