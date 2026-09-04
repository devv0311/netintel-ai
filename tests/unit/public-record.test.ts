import { describe, expect, it } from "vitest";

import { CorpusManifestSchema } from "@/lib/corpus/manifest-schema";
import {
  InvalidPublicRecordError,
  parsePublicRecord,
} from "@/lib/domain/public-record";
import { buildCandidatesForItem, extractRawFacts } from "@/lib/extraction/extract";
import type { EvidenceItem } from "@/lib/domain/evidence";

/**
 * `public_record` is the only evidence type through which externally
 * fetched data may enter the pipeline, so the tests that matter most are
 * the refusals: a record that cannot state where it came from, or under
 * what licence, must produce nothing at all.
 */

const VALID = {
  recordRef: "gleif:EXAMPLE0000000000TEST",
  registry: "gleif",
  registryRecordId: "EXAMPLE0000000000TEST",
  subjectKind: "organisation" as const,
  name: "Example Holdings Private Limited",
  aliases: ["Example Holdings Pvt Ltd"],
  identifiers: [{ scheme: "LEI", value: "EXAMPLE0000000000TEST" }],
  relations: [{ predicate: "parent_of", targetRegistryRecordId: "EXAMPLE0000000000SUB1" }],
  observedAt: "2026-01-15T00:00:00.000Z",
  retrievedAt: "2026-09-03T00:00:00.000Z",
  license: "CC0-1.0",
  licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
  sourceUrl: "https://www.gleif.org/example",
};

const item = (content: Record<string, unknown>): EvidenceItem => ({
  id: "evidence_item_test",
  investigationId: "investigation_test",
  evidenceSourceId: "evidence_source_test",
  itemType: "public_record",
  content,
  ingestedAt: "2026-09-03T00:00:00.000Z",
  validationStatus: "accepted",
  errors: [],
  warnings: [],
  confidence: 1,
});

describe("public_record — mandatory provenance and licensing", () => {
  it("accepts a complete record", () => {
    expect(parsePublicRecord(VALID).name).toBe("Example Holdings Private Limited");
  });

  for (const field of ["license", "licenseUrl", "sourceUrl", "retrievedAt", "registry"] as const) {
    it(`rejects a record with no ${field}`, () => {
      const content: Record<string, unknown> = { ...VALID };
      delete content[field];
      expect(() => parsePublicRecord(content)).toThrow(InvalidPublicRecordError);
    });
  }

  it("rejects a licenceUrl or sourceUrl that is not a URL", () => {
    expect(() => parsePublicRecord({ ...VALID, licenseUrl: "CC0" })).toThrow(InvalidPublicRecordError);
    expect(() => parsePublicRecord({ ...VALID, sourceUrl: "gleif.org" })).toThrow(InvalidPublicRecordError);
  });

  it("rejects a recordRef that does not match registry:registryRecordId", () => {
    expect(() => parsePublicRecord({ ...VALID, recordRef: "gleif:SOMETHING-ELSE" })).toThrow(
      InvalidPublicRecordError,
    );
  });

  it("rejects unknown fields rather than silently carrying them", () => {
    expect(() => parsePublicRecord({ ...VALID, scrapedFrom: "somewhere" })).toThrow(
      InvalidPublicRecordError,
    );
  });

  it("rejects a subject kind outside person/organisation", () => {
    expect(() => parsePublicRecord({ ...VALID, subjectKind: "place" })).toThrow(
      InvalidPublicRecordError,
    );
  });

  it("produces NO facts at all when the record is invalid — never partial ones", () => {
    const content: Record<string, unknown> = { ...VALID };
    delete content.license;
    expect(() => extractRawFacts("public_record", content)).toThrow(InvalidPublicRecordError);
  });
});

describe("public_record — ingestion schema gate", () => {
  const manifest = (content: Record<string, unknown>) => ({
    corpus: { name: "public-pilot", version: "1.0.0", seed: null, generatedAt: "2026-09-03T00:00:00.000Z", description: "t" },
    investigation: { name: "t", status: "in_progress" },
    evidenceSources: [{ key: "gleif", label: "GLEIF", sourceType: "structured_dataset" }],
    evidenceItems: [{ sourceKey: "gleif", ref: "gleif:X", itemType: "public_record", content }],
    locations: [],
    communicationEvents: [],
    financialTransactions: [],
  });

  it("rejects an unlicensed public_record at the manifest boundary", () => {
    const content: Record<string, unknown> = { ...VALID };
    delete content.license;
    const result = CorpusManifestSchema.safeParse(manifest(content));
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.join(".").includes("content.license"))).toBe(true);
    }
  });

  it("still accepts the other evidence types with free-form content", () => {
    const m = manifest(VALID) as unknown as { evidenceItems: Record<string, unknown>[] };
    m.evidenceItems[0] = { sourceKey: "gleif", ref: "fir:001", itemType: "fir", content: { anything: true } };
    expect(CorpusManifestSchema.safeParse(m).success).toBe(true);
  });
});

describe("public_record — extraction", () => {
  const candidates = buildCandidatesForItem(item(VALID), "2026-09-03T00:00:00.000Z");
  const byType = (t: string) => candidates.filter((c) => c.recordType === t);

  it("emits exactly one subject mention, of the declared kind", () => {
    const mentions = byType("entity_mention");
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.data.mentionKind).toBe("organisation");
    expect(mentions[0]!.data.observedValue).toBe("Example Holdings Private Limited");
  });

  it("emits identifiers scheme-qualified, so an LEI and a QID can never collide", () => {
    const identifier = byType("relationship_mention").find(
      (c) => c.data.relationshipType === "has_identifier",
    );
    expect(identifier?.data.observedValue).toBe("LEI:EXAMPLE0000000000TEST");
  });

  it("records the publisher's own id for a relation's other end, never a CIPHER id", () => {
    const relation = byType("relationship_mention").find((c) => c.data.relationshipType === "parent_of");
    expect(relation?.data.observedValue).toBe("EXAMPLE0000000000SUB1");
  });

  it("persists licence, source and retrieval as first-class attribute rows", () => {
    const attributes = new Map(
      byType("attribute_mention").map((c) => [c.data.attribute, c.data.observedValue]),
    );
    expect(attributes.get("public_record_license")).toBe("CC0-1.0");
    expect(attributes.get("public_record_source_url")).toBe("https://www.gleif.org/example");
    expect(attributes.get("public_record_retrieved_at")).toBe("2026-09-03T00:00:00.000Z");
  });

  it("gives every fact full provenance traceable to the record and field", () => {
    for (const candidate of candidates) {
      expect(candidate.provenance.location.startsWith("gleif:EXAMPLE0000000000TEST#")).toBe(true);
      expect(candidate.provenance.method).toBe("extraction:field-read:public_record");
      expect(candidate.provenance.processingHistory.length).toBeGreaterThan(0);
      expect(candidate.classification).toBe("observed_fact");
    }
  });

  it("does not normalise the publisher's name — the suffix is left exactly as written", () => {
    const mention = byType("entity_mention")[0]!;
    // "Private Limited" is NOT stripped. Whether that defeats the
    // resolver's exact-name matching is the question the pilot asks; a
    // normalisation applied here would hide the answer.
    expect(mention.data.observedValue).toContain("Private Limited");
  });
});
