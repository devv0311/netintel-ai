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

  const hindi = binding.itemLabelHi?.value;
  return parsePublicRecord({
    recordRef: `wikidata:${qid}`,
    registry: "wikidata",
    registryRecordId: qid,
    subjectKind: "organisation",
    name: name.normalize("NFC"),
    ...(hindi && hindi !== name ? { aliases: [hindi.normalize("NFC")] } : {}),
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
          "User-Agent": "NetIntelAI-research/0.1 (+https://github.com/devv0311/netintel-ai)",
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
    byQid.set(record.registryRecordId, {
      ...existing,
      identifiers,
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
