import { describe, expect, it } from "vitest";

import {
  SourceNotApprovedError,
  loadRegistry,
  requireApprovedSource,
} from "@/lib/adapters/public/registry";
import { GLEIF_SOURCE_ID, MAX_LIMIT as GLEIF_MAX, mapGleifRecord, planGleif } from "@/lib/adapters/public/gleif";
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
