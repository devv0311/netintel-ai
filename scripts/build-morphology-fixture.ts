/**
 * Builds the name-morphology fixture for the real-world generalisation
 * experiment.
 *
 * READ THIS BEFORE QUOTING ANY NUMBER PRODUCED FROM IT.
 *
 * This is NOT collected data and does not claim to be. Egress to
 * query.wikidata.org and api.gleif.org is blocked by policy in the
 * environment where the pilot was attempted (HTTP 403 at the proxy), so
 * no real records could be fetched. Rather than report nothing, this
 * fixture reproduces the NAME MORPHOLOGY that real public registers
 * exhibit — corporate suffix variants, Devanagari/Latin transliteration,
 * abbreviation, western/eastern name ordering, and two distinct
 * subjects sharing a name — over identifiers that are obviously
 * synthetic (`TESTLEI…`, `Q90000…`).
 *
 * What it can answer: how the CURRENT resolver behaves when the strings
 * are not ones the corpus generator wrote — which of Tier A and Tier B
 * carries the load, and which variation classes defeat Tier B.
 *
 * What it cannot answer: the real distribution. How OFTEN each variation
 * occurs in GLEIF or Wikidata is an empirical question that needs the
 * real collection. The rates below are properties of this fixture, by
 * construction. Read the per-class outcomes, not the aggregate.
 */
import fs from "node:fs";
import path from "node:path";

const RETRIEVED_AT = "2026-09-03T00:00:00.000Z";
const LICENSE = "CC0-1.0";
const LICENSE_URL = "https://creativecommons.org/publicdomain/zero/1.0/";

/** How a variant differs from its subject's canonical form. */
export type VariationClass =
  | "identical_with_identifier"
  | "suffix"
  | "transliteration"
  | "abbreviation"
  | "name_order"
  | "same_name_different_subject";

interface Variant {
  name: string;
  variation: VariationClass;
  /** Whether this record carries the subject's identifier. */
  withIdentifier: boolean;
  aliases?: string[];
}

interface Subject {
  key: string;
  kind: "organisation" | "person";
  identifier: { scheme: string; value: string };
  variants: Variant[];
}

const SUBJECTS: Subject[] = [
  {
    key: "ORG-1",
    kind: "organisation",
    identifier: { scheme: "LEI", value: "TESTLEI0000000000001" },
    variants: [
      { name: "Bharat Chemicals Private Limited", variation: "identical_with_identifier", withIdentifier: true },
      { name: "Bharat Chemicals Pvt Ltd", variation: "suffix", withIdentifier: true },
      { name: "Bharat Chemicals Pvt. Ltd.", variation: "suffix", withIdentifier: false },
      { name: "भारत केमिकल्स प्राइवेट लिमिटेड", variation: "transliteration", withIdentifier: false },
      { name: "BCPL", variation: "abbreviation", withIdentifier: false },
    ],
  },
  {
    key: "ORG-2",
    kind: "organisation",
    identifier: { scheme: "LEI", value: "TESTLEI0000000000002" },
    variants: [
      { name: "Deccan Logistics Limited", variation: "identical_with_identifier", withIdentifier: true },
      { name: "DECCAN LOGISTICS LTD", variation: "suffix", withIdentifier: false },
      { name: "Deccan Logistics Ltd.", variation: "suffix", withIdentifier: true },
      { name: "दक्कन लॉजिस्टिक्स लिमिटेड", variation: "transliteration", withIdentifier: false },
    ],
  },
  {
    key: "ORG-3",
    kind: "organisation",
    identifier: { scheme: "WIKIDATA", value: "Q90000001" },
    variants: [
      { name: "Nilgiri Textile Mills Company", variation: "identical_with_identifier", withIdentifier: true },
      { name: "Nilgiri Textile Mills Co.", variation: "suffix", withIdentifier: false },
      { name: "NTMC", variation: "abbreviation", withIdentifier: false, aliases: ["Nilgiri Textile Mills Company"] },
    ],
  },
  {
    key: "ORG-4",
    kind: "organisation",
    identifier: { scheme: "LEI", value: "TESTLEI0000000000004" },
    variants: [
      { name: "Konkan Shipping & Freight Private Limited", variation: "identical_with_identifier", withIdentifier: true },
      { name: "Konkan Shipping and Freight Pvt Ltd", variation: "suffix", withIdentifier: false },
      { name: "कोंकण शिपिंग एंड फ्रेट प्राइवेट लिमिटेड", variation: "transliteration", withIdentifier: true },
    ],
  },
  {
    key: "PER-1",
    kind: "person",
    identifier: { scheme: "WIKIDATA", value: "Q90000010" },
    variants: [
      { name: "Narayana Murthy Rajagopalan", variation: "identical_with_identifier", withIdentifier: true },
      { name: "Rajagopalan, Narayana Murthy", variation: "name_order", withIdentifier: false },
      { name: "N. M. Rajagopalan", variation: "abbreviation", withIdentifier: false },
      { name: "नारायण मूर्ति राजगोपालन", variation: "transliteration", withIdentifier: false },
    ],
  },
  {
    key: "PER-2",
    kind: "person",
    identifier: { scheme: "WIKIDATA", value: "Q90000011" },
    variants: [
      { name: "Priya Venkataraman", variation: "identical_with_identifier", withIdentifier: true },
      { name: "Venkataraman, Priya", variation: "name_order", withIdentifier: false },
      { name: "Priya Venkataraman", variation: "identical_with_identifier", withIdentifier: true },
    ],
  },
  // The false-merge trap: two DIFFERENT companies with an identical
  // registered name and different identifiers. A resolver that merges on
  // exact name alone gets this wrong, and getting it wrong means
  // asserting that two real companies are one.
  {
    key: "ORG-5A",
    kind: "organisation",
    identifier: { scheme: "LEI", value: "TESTLEI000000000005A" },
    variants: [
      { name: "Kumar Enterprises Private Limited", variation: "same_name_different_subject", withIdentifier: true },
    ],
  },
  {
    key: "ORG-5B",
    kind: "organisation",
    identifier: { scheme: "LEI", value: "TESTLEI000000000005B" },
    variants: [
      { name: "Kumar Enterprises Private Limited", variation: "same_name_different_subject", withIdentifier: true },
    ],
  },
];

function build() {
  const evidenceItems: unknown[] = [];
  const truth: { recordRef: string; subjectKey: string; variation: VariationClass; withIdentifier: boolean; name: string }[] = [];

  SUBJECTS.forEach((subject) => {
    subject.variants.forEach((variant, i) => {
      const registry = subject.identifier.scheme === "LEI" ? "gleif" : "wikidata";
      const registryRecordId = `${subject.key}-${i}`;
      const recordRef = `${registry}:${registryRecordId}`;
      evidenceItems.push({
        sourceKey: registry,
        ref: recordRef,
        itemType: "public_record",
        content: {
          recordRef,
          registry,
          registryRecordId,
          subjectKind: subject.kind,
          name: variant.name,
          ...(variant.aliases ? { aliases: variant.aliases } : {}),
          ...(variant.withIdentifier ? { identifiers: [subject.identifier] } : {}),
          retrievedAt: RETRIEVED_AT,
          license: LICENSE,
          licenseUrl: LICENSE_URL,
          sourceUrl: `https://example.invalid/${registry}/${registryRecordId}`,
        },
      });
      truth.push({
        recordRef,
        subjectKey: subject.key,
        variation: variant.variation,
        withIdentifier: variant.withIdentifier,
        name: variant.name,
      });
    });
  });

  const manifest = {
    corpus: {
      name: "public-name-morphology",
      version: "1.0.0",
      seed: null,
      generatedAt: RETRIEVED_AT,
      description:
        "SYNTHETIC name-morphology fixture for the real-world generalisation experiment. Not collected data; identifiers are deliberately fake (TESTLEI…, Q9000…).",
    },
    investigation: { name: "Public-data generalisation experiment", status: "in_progress" },
    evidenceSources: [
      { key: "gleif", label: "GLEIF-shaped public records (synthetic morphology fixture)", sourceType: "structured_dataset" },
      { key: "wikidata", label: "Wikidata-shaped public records (synthetic morphology fixture)", sourceType: "structured_dataset" },
    ],
    evidenceItems,
    locations: [],
    communicationEvents: [],
    financialTransactions: [],
  };

  const dir = path.join(process.cwd(), "evidence", "public-pilot");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "name-morphology.corpus.json"), JSON.stringify(manifest, null, 2) + "\n");
  fs.writeFileSync(
    path.join(dir, "name-morphology.ground-truth.json"),
    JSON.stringify({ note: "Subject key per record. NOT collected data.", records: truth }, null, 2) + "\n",
  );
  console.log(`fixture: ${evidenceItems.length} public_record items across ${SUBJECTS.length} subjects`);
}

build();
