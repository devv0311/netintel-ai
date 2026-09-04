import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { PublicRecordContent } from "@/lib/domain/public-record";
import { parsePublicRecord } from "@/lib/domain/public-record";
import { requireApprovedSource } from "@/lib/adapters/public/registry";
import {
  AdapterFetchError,
  type AdapterOptions,
  type AdapterPlan,
  type AdapterResult,
} from "@/lib/adapters/public/types";

/**
 * Wikidata adapter — read-only, bounded, registry-gated (SRC-001, CC0).
 *
 * Queries are CONSTANTS in this file, chosen for the pilot, with an
 * explicit LIMIT injected from the bounded `limit`. There is no
 * caller-supplied SPARQL and no caller-supplied URL: an arbitrary query
 * is an arbitrary crawl with extra steps, and the governance rules
 * forbid it.
 *
 * Only the fields the pilot needs are read: name, aliases, identifiers,
 * type and declared relations. Date of birth, nationality, positions
 * held and every other biographical property about a living person are
 * excluded HERE, at the adapter, rather than filtered later — a field
 * that is never fetched cannot leak.
 *
 * Both the English and the Hindi label are kept when present. That is
 * deliberate: Devanagari against Latin for the same subject is exactly
 * the transliteration case the generalisation experiment measures, and
 * dropping one script would remove the evidence.
 */

export const WIKIDATA_SOURCE_ID = "SRC-001";
const ENDPOINT = "https://query.wikidata.org/sparql";
export const MAX_LIMIT = 2000;

export const QUERIES = {
  /** Indian companies that publish an LEI — the cross-source linkage set. */
  "indian-companies-with-lei": (limit: number) => `
SELECT ?item ?itemLabel ?itemLabelHi ?lei WHERE {
  ?item wdt:P31/wdt:P279* wd:Q4830453 ;
        wdt:P17 wd:Q668 ;
        wdt:P1278 ?lei .
  OPTIONAL { ?item rdfs:label ?itemLabelHi FILTER(LANG(?itemLabelHi) = "hi") }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`,
  /** Indian organisations carrying both an English and a Hindi label — the transliteration set. */
  "indian-organisations-bilingual": (limit: number) => `
SELECT ?item ?itemLabel ?itemLabelHi WHERE {
  ?item wdt:P31/wdt:P279* wd:Q43229 ;
        wdt:P17 wd:Q668 ;
        rdfs:label ?itemLabelHi .
  FILTER(LANG(?itemLabelHi) = "hi")
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`,
  /**
   * P6.19 — companies that publish an LEI, WORLDWIDE, carrying the
   * evidence the earlier queries never asked for.
   *
   * Two deliberate changes from `indian-companies-with-lei`:
   *
   *   NO `wdt:P17 wd:Q668`. The P6.19.1 audit found the corpus is 99.2%
   *   Latin script and every positive pair is one source pairing, because
   *   the linkage set was filtered to one country. Worldwide there are
   *   ~43,800 LEI-bearing items and ~29,700 of them state an official
   *   name, against 8 of 78 in the India-filtered sample.
   *
   *   P1448/P1813/P1320/P5531. The official name is the bridge for the
   *   divergent-name class; the OpenCorporates id and the SEC CIK are
   *   SECOND and THIRD identifier bridges that do not run through the
   *   LEI, so a cross-source pair can be corroborated by an identifier
   *   the linking source did not supply.
   *
   * Still bounded, still no URL parameter, still one constant query.
   */
  "companies-with-lei-enriched": (limit: number) => `
SELECT ?item ?itemLabel ?itemLabelHi ?lei ?official ?shortName ?ocid ?cik WHERE {
  ?item wdt:P31/wdt:P279* wd:Q4830453 ;
        wdt:P1278 ?lei .
  OPTIONAL { ?item rdfs:label ?itemLabelHi FILTER(LANG(?itemLabelHi) = "hi") }
  OPTIONAL { ?item wdt:P1448 ?official }
  OPTIONAL { ?item wdt:P1813 ?shortName }
  OPTIONAL { ?item wdt:P1320 ?ocid }
  OPTIONAL { ?item wdt:P5531 ?cik }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`,
  /**
   * P6.25 — the enriched query, plus the one field its predecessor never
   * asked for: the country the publisher states.
   *
   * `companies-with-lei-enriched` returns no jurisdiction at all, and the
   * consequence was measurable rather than cosmetic. Every Wikidata record
   * in the P6.24 corpus carried a null jurisdiction, so every positive pair
   * fell into a single "not stated by both publishers" slice, the
   * jurisdiction generalisation breakdown had one bucket, and the three
   * features that exist to catch a cross-border name collision
   * (`jurisdictionBothKnown`, `jurisdictionCountryMatch`,
   * `jurisdictionCountryConflict`) could not fire on a Wikidata side. Two
   * of the three false merges on the frozen test are cross-border pairs —
   * a French retailer against a Norwegian bank, a French bank against a
   * Czech insurer — that the model had no way to see as cross-border.
   *
   * P17 is the country; P297 is its ISO 3166-1 alpha-2 code, which is the
   * same vocabulary GLEIF's `jurisdiction` already uses, so the two
   * publishers become comparable without a mapping table of our own. It is
   * read through an OPTIONAL: a missing country stays missing rather than
   * dropping the record.
   *
   * Still one constant query, still one request, still bounded by MAX_LIMIT.
   */
  "companies-with-lei-enriched-v2": (limit: number) => `
SELECT ?item ?itemLabel ?itemLabelHi ?lei ?official ?shortName ?ocid ?cik ?countryCode WHERE {
  ?item wdt:P31/wdt:P279* wd:Q4830453 ;
        wdt:P1278 ?lei .
  OPTIONAL { ?item rdfs:label ?itemLabelHi FILTER(LANG(?itemLabelHi) = "hi") }
  OPTIONAL { ?item wdt:P1448 ?official }
  OPTIONAL { ?item wdt:P1813 ?shortName }
  OPTIONAL { ?item wdt:P1320 ?ocid }
  OPTIONAL { ?item wdt:P5531 ?cik }
  OPTIONAL { ?item wdt:P17/wdt:P297 ?countryCode }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT ${limit}`,
} as const;

export type WikidataQueryName = keyof typeof QUERIES;

export function planWikidata(
  queryName: WikidataQueryName,
  options: AdapterOptions,
): AdapterPlan {
  const entry = requireApprovedSource(WIKIDATA_SOURCE_ID, options.root);
  const limit = Math.min(options.limit, MAX_LIMIT);
  return {
    sourceId: WIKIDATA_SOURCE_ID,
    sourceName: entry.sourceName,
    endpoint: ENDPOINT,
    request: QUERIES[queryName](limit).trim(),
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    rateLimit: entry.rateLimit,
    limit,
    estimatedRequests: 1,
    estimatedBytes: limit * 512,
    destination: `data/public/raw/${WIKIDATA_SOURCE_ID}/<retrievedAt>/${queryName}.json`,
  };
}

interface SparqlBinding {
  item?: { value?: string };
  itemLabel?: { value?: string };
  itemLabelHi?: { value?: string };
  lei?: { value?: string };
  /** P1448 official name — a legal-name claim, NOT an alias. See PublicRecordContent.officialName. */
  official?: { value?: string };
  /** P1813 short name — an abbreviation the publisher states, so it IS an alias. */
  shortName?: { value?: string };
  /** P1320 OpenCorporates id — an identifier bridge that does not run through the LEI. */
  ocid?: { value?: string };
  /** P5531 SEC CIK — the bridge to SRC-006. */
  cik?: { value?: string };
  /**
   * P17 country, resolved to its P297 ISO 3166-1 alpha-2 code — the same
   * vocabulary GLEIF's `jurisdiction` field uses. A FEATURE field, never a
   * label: two records agreeing on a country are not thereby the same
   * entity, and two disagreeing are not thereby different. It is evidence
   * the classifier may weigh, and it is not consulted by the resolver's
   * identifier rules at all.
   */
  countryCode?: { value?: string };
}

/** Pure mapper — testable against a saved SPARQL response with no live source. */
export function mapWikidataBinding(
  binding: SparqlBinding,
  context: { retrievedAt: string; license: string; licenseUrl: string },
): PublicRecordContent | null {
  const uri = binding.item?.value;
  const name = binding.itemLabel?.value;
  if (!uri || !name) return null;
  const qid = uri.slice(uri.lastIndexOf("/") + 1);
  if (!/^Q\d+$/.test(qid)) return null;

  const identifiers = [{ scheme: "WIKIDATA", value: qid }];
  if (binding.lei?.value) identifiers.push({ scheme: "LEI", value: binding.lei.value });
  // Cross-references Wikidata publishes about the same subject. They are
  // recorded as identifiers so a join can be corroborated by a scheme the
  // linking source did not supply; whether any of them may MERGE is
  // governed by identifier-authority.ts, not by this adapter.
  if (binding.ocid?.value) identifiers.push({ scheme: "OPENCORPORATES", value: binding.ocid.value });
  if (binding.cik?.value) identifiers.push({ scheme: "CIK", value: binding.cik.value.replace(/^0+(?=\d)/, "") });

  const hindi = binding.itemLabelHi?.value;
  const official = binding.official?.value;
  const short = binding.shortName?.value;
  // A short name is another name the subject goes by, so it is an alias.
  // An official name is a legal-name claim and gets its own field.
  const aliases = [...new Set([
    ...(hindi && hindi !== name ? [hindi.normalize("NFC")] : []),
    ...(short && short !== name ? [short.normalize("NFC")] : []),
  ])];
  // Only a well-formed alpha-2 code is kept. Anything else is dropped
  // rather than passed through, so `jurisdiction` never carries a value
  // that cannot be compared against GLEIF's.
  const country = binding.countryCode?.value;
  const jurisdiction = country && /^[A-Z]{2}$/.test(country) ? country : undefined;
  return parsePublicRecord({
    recordRef: `wikidata:${qid}`,
    registry: "wikidata",
    registryRecordId: qid,
    subjectKind: "organisation",
    name: name.normalize("NFC"),
    ...(official && official !== name ? { officialName: official.normalize("NFC") } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    identifiers,
    retrievedAt: context.retrievedAt,
    license: context.license,
    licenseUrl: context.licenseUrl,
    sourceUrl: `https://www.wikidata.org/wiki/${qid}`,
  });
}

export async function collectWikidata(
  queryName: WikidataQueryName,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const plan = planWikidata(queryName, options);
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];

  let payload: string;
  if (options.fromFile) {
    payload = fs.readFileSync(options.fromFile, "utf8");
    warnings.push(`Transformed a local payload (${options.fromFile}); no network call was made.`);
  } else {
    const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(plan.request)}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/sparql-results+json",
          // Wikimedia's User-Agent policy requires identification and contact.
          "User-Agent": "CIPHER-research/0.1 (+https://github.com/devv0311/netintel-ai)",
          "Accept-Encoding": "gzip,deflate",
        },
      });
      if (response.status === 429) {
        throw new AdapterFetchError(ENDPOINT, "HTTP 429 — rate limited; stop, do not back off in a loop");
      }
      if (!response.ok) throw new AdapterFetchError(ENDPOINT, `HTTP ${response.status}`);
      payload = await response.text();
    } catch (error) {
      if (error instanceof AdapterFetchError) throw error;
      throw new AdapterFetchError(ENDPOINT, error instanceof Error ? error.message : String(error));
    }
  }

  const parsed = JSON.parse(payload) as { results?: { bindings?: SparqlBinding[] } };

  // SPARQL returns one row per solution, so a single item legitimately
  // arrives several times: once per (item, LEI, label) combination. One of
  // the 30 rows collected in the first real run was Wikidata item Q188087
  // asserting TWO different LEIs, which the cross-product multiplied into
  // four rows. Emitting a public_record per row produces duplicate
  // recordRefs, and ingestion rejects the corpus outright — correctly, since
  // recordRef is `registry:registryRecordId` and an item has one id.
  //
  // Rows are therefore folded by QID: one record per item, carrying every
  // identifier and label that item states. Nothing is discarded and nothing
  // is chosen between — if Wikidata publishes two LEIs for one item, both
  // are kept, and deciding what that means is entity resolution's problem,
  // not the adapter's.
  const byQid = new Map<string, PublicRecordContent>();
  let skipped = 0;
  for (const binding of (parsed.results?.bindings ?? [])) {
    const record = mapWikidataBinding(binding, {
      retrievedAt,
      license: plan.license,
      licenseUrl: plan.licenseUrl,
    });
    if (!record) {
      skipped++;
      continue;
    }
    const existing = byQid.get(record.registryRecordId);
    if (!existing) {
      if (byQid.size >= plan.limit) continue;
      byQid.set(record.registryRecordId, record);
      continue;
    }
    const identifiers = [...(existing.identifiers ?? [])];
    for (const identifier of record.identifiers ?? []) {
      if (!identifiers.some((i) => i.scheme === identifier.scheme && i.value === identifier.value)) {
        identifiers.push(identifier);
      }
    }
    const aliases = [...new Set([...(existing.aliases ?? []), ...(record.aliases ?? [])])];
    // Keep the first official name seen and do not choose between two:
    // a second, different P1448 value is the publisher contradicting
    // itself, and picking one would make identity depend on row order.
    const officialName = existing.officialName ?? record.officialName;
    byQid.set(record.registryRecordId, {
      ...existing,
      identifiers,
      ...(officialName ? { officialName } : {}),
      ...(aliases.length > 0 ? { aliases } : {}),
    });
  }
  if (skipped > 0) warnings.push(`Skipped ${skipped} binding(s) with no item URI or no English label.`);

  const records = [...byQid.values()];
  const rowCount = (parsed.results?.bindings ?? []).length;
  if (rowCount > records.length) {
    warnings.push(
      `${rowCount} SPARQL rows folded into ${records.length} records by item id (multi-valued properties produce a cross-product).`,
    );
  }
  for (const record of records) {
    const leis = (record.identifiers ?? []).filter((i) => i.scheme === "LEI");
    if (leis.length > 1) {
      warnings.push(
        `${record.recordRef} states ${leis.length} LEIs (${leis.map((l) => l.value).join(", ")}); all kept, none chosen between.`,
      );
    }
  }

  return {
    plan,
    records,
    rawSha256: crypto.createHash("sha256").update(payload).digest("hex"),
    rawBytes: Buffer.byteLength(payload),
    // Wikidata has only ever been collected by this adapter over a
    // direct socket. It has no relay path because, unlike GLEIF, no
    // relay channel to query.wikidata.org is available either — see
    // docs/data-research/network-access-diagnosis.md.
    retrievalChannel: options.fromFile ? "agent-relay" : "direct-https",
    rawPayloads: [
      { file: options.fromFile ? path.basename(options.fromFile) : "sparql-results.json", body: payload },
    ],
    sourcePayloads: [
      {
        file: options.fromFile ? options.fromFile : "sparql-results.json",
        sha256: crypto.createHash("sha256").update(payload).digest("hex"),
        bytes: Buffer.byteLength(payload),
        records: records.length,
      },
    ],
    warnings,
  };
}
