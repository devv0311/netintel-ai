import crypto from "node:crypto";
import fs from "node:fs";

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
 * SEC EDGAR submissions adapter — read-only, bounded, registry-gated
 * (SRC-006, US Government work / public domain).
 *
 * WHY A THIRD SOURCE EXISTS AT ALL.
 *
 * The P6.19.1 audit found the real corpus had exactly ONE source
 * pairing: every one of the 75 positive pairs is gleif x wikidata, and
 * every one of the 19 hard negatives is gleif x gleif. A resolver — or a
 * model — measured only there learns "GLEIF house style versus Wikidata
 * house style", which is not entity resolution. EDGAR is a third
 * publisher with its own naming conventions and its own authoritative
 * identifier.
 *
 * WHAT IT IS COLLECTED FOR.
 *
 * `formerNames`: the SEC's own dated record that a filer with a given
 * CIK previously filed under a different official name — `Facebook Inc`
 * before `Meta Platforms, Inc.`, `APPLE COMPUTER INC` before
 * `Apple Inc.`. These are REAL, publisher-stated, dated name variants
 * anchored on an authoritative identifier. They are exactly the
 * divergent-name and abbreviation classes P6.18 measured as unsolvable,
 * and NOTHING about them is manufactured: the project's rule that name
 * variants are never invented is why a source that publishes real ones
 * is worth adding.
 *
 * WHAT IT DOES NOT COLLECT.
 *
 * Only the company-level entity block. EDGAR's PII risk is rated MEDIUM
 * in the source registry because Forms 3/4/5 name officers and carry
 * signatures and addresses; this adapter never requests a filing, never
 * touches the `filings` block, and never stores a natural person. Nothing
 * it emits is personal data.
 *
 * P6.16 REJECTED EDGAR because it publishes no LEI, and that finding
 * STANDS: the submissions schema has an `lei` key but it was null for
 * all 20 filers probed in P6.19. EDGAR therefore does NOT join GLEIF
 * directly. It joins Wikidata through the CIK that Wikidata publishes as
 * P5531, and its value is its own name variants, not an LEI bridge.
 */

export const EDGAR_SOURCE_ID = "SRC-006";
const SUBMISSIONS = "https://data.sec.gov/submissions";
/** Bounded by construction: no caller can ask for more than this. */
export const MAX_LIMIT = 400;

/**
 * SEC fair-access requires a descriptive User-Agent carrying a real
 * contact, and enforces 10 requests/second. The registry records both as
 * hard restrictions "enforced at the collector layer, not by
 * convention", so the delay below is not decoration.
 */
const USER_AGENT = "NetIntelAI-research/0.1 (contact: sanchit.sharma1089@gmail.com)";
const MIN_REQUEST_INTERVAL_MS = 150; // ~6.7 req/s, comfortably inside 10/s

/** EDGAR pads CIKs to ten digits in a path and prints them unpadded elsewhere. */
export function padCik(cik: string): string {
  const digits = cik.replace(/\D/g, "");
  if (digits.length === 0 || digits.length > 10) throw new Error(`not a CIK: ${cik}`);
  return digits.padStart(10, "0");
}
export const unpadCik = (cik: string): string => cik.replace(/\D/g, "").replace(/^0+(?=\d)/, "");

export interface EdgarQuery {
  /**
   * Exact CIKs to fetch. Like GLEIF's `--leis-from`, the set is derived
   * from ALREADY-COLLECTED approved records of another source, never
   * hand-typed and never crawled: EDGAR has no useful jurisdiction page
   * for this purpose and guessing CIKs would not produce cross-source
   * pairs.
   */
  ciks: string[];
}

export function planEdgar(query: EdgarQuery, options: AdapterOptions): AdapterPlan {
  const entry = requireApprovedSource(EDGAR_SOURCE_ID, options.root);
  const limit = Math.min(options.limit, MAX_LIMIT);
  const ciks = query.ciks.slice(0, limit);
  return {
    sourceId: EDGAR_SOURCE_ID,
    sourceName: entry.sourceName,
    endpoint: SUBMISSIONS,
    request: `GET ${SUBMISSIONS}/CIK<10-digit>.json for ${ciks.length} CIK(s); company block only, filings never read`,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    rateLimit: entry.rateLimit,
    limit,
    estimatedRequests: ciks.length,
    estimatedBytes: ciks.length * 40_000,
    destination: `data/public/raw/${EDGAR_SOURCE_ID}/<retrievedAt>/submissions-<cik>.json`,
  };
}

interface EdgarSubmissions {
  cik?: string;
  name?: string;
  entityType?: string;
  tickers?: string[];
  ein?: string | null;
  stateOfIncorporation?: string;
  formerNames?: { name?: string; from?: string; to?: string }[];
}

/**
 * Pure mapper — testable against a saved submissions payload with no
 * live source.
 *
 * Former names become ALIASES, not the record's name and not its
 * `officialName`. The SEC's claim is that this filer once filed under
 * that name; the name it files under NOW is the one in `name`. Recording
 * a superseded name as though it were current would be the adapter
 * asserting something the publisher does not.
 */
export function mapEdgarSubmissions(
  raw: EdgarSubmissions,
  context: { retrievedAt: string; license: string; licenseUrl: string },
): PublicRecordContent | null {
  const cikRaw = raw.cik;
  const name = raw.name;
  if (!cikRaw || !name) return null;
  const cik = unpadCik(String(cikRaw));
  if (!/^\d+$/.test(cik)) return null;

  const formerNames = (raw.formerNames ?? [])
    .map((f) => f.name)
    .filter((v): v is string => Boolean(v && v.trim()))
    .map((v) => v.normalize("NFC"))
    .filter((v) => v !== name.normalize("NFC"));

  const identifiers = [{ scheme: "CIK", value: cik }];

  return parsePublicRecord({
    recordRef: `edgar:${cik}`,
    registry: "edgar",
    registryRecordId: cik,
    subjectKind: "organisation",
    // NFC only. No case folding, no suffix stripping — same rule as every
    // other adapter: the publisher's string is kept as the publisher wrote it.
    name: name.normalize("NFC"),
    ...(formerNames.length > 0 ? { aliases: [...new Set(formerNames)] } : {}),
    identifiers,
    ...(raw.stateOfIncorporation ? { jurisdiction: `US-${raw.stateOfIncorporation}` } : {}),
    ...(raw.entityType ? { status: raw.entityType } : {}),
    retrievedAt: context.retrievedAt,
    license: context.license,
    licenseUrl: context.licenseUrl,
    sourceUrl: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${padCik(cik)}`,
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function collectEdgar(
  query: EdgarQuery,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const plan = planEdgar(query, options);
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];
  const ciks = query.ciks.slice(0, plan.limit);

  const payloads: { file: string; bytes: string }[] = [];

  if (options.fromDir) {
    for (const file of fs.readdirSync(options.fromDir).filter((f) => f.endsWith(".json")).sort()) {
      payloads.push({ file, bytes: fs.readFileSync(`${options.fromDir}/${file}`, "utf8") });
    }
    warnings.push(`Transformed ${payloads.length} local payload(s); no network call was made.`);
  } else {
    for (const cik of ciks) {
      const padded = padCik(cik);
      const url = `${SUBMISSIONS}/CIK${padded}.json`;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: { Accept: "application/json", "User-Agent": USER_AGENT },
        });
        if (response.status === 429) {
          throw new AdapterFetchError(url, "HTTP 429 — rate limited; stop, do not back off in a loop");
        }
        if (response.status === 404) {
          warnings.push(`CIK ${cik} has no submissions record (HTTP 404); skipped.`);
          await sleep(MIN_REQUEST_INTERVAL_MS);
          continue;
        }
        if (!response.ok) throw new AdapterFetchError(url, `HTTP ${response.status}`);
        payloads.push({ file: `submissions-${padded}.json`, bytes: await response.text() });
      } catch (error) {
        if (error instanceof AdapterFetchError) throw error;
        throw new AdapterFetchError(url, error instanceof Error ? error.message : String(error));
      }
      await sleep(MIN_REQUEST_INTERVAL_MS);
    }
  }

  const byCik = new Map<string, PublicRecordContent>();
  let skipped = 0;
  for (const payload of payloads) {
    let parsed: EdgarSubmissions;
    try {
      parsed = JSON.parse(payload.bytes) as EdgarSubmissions;
    } catch {
      skipped++;
      continue;
    }
    const record = mapEdgarSubmissions(parsed, {
      retrievedAt,
      license: plan.license,
      licenseUrl: plan.licenseUrl,
    });
    if (!record) {
      skipped++;
      continue;
    }
    // One CIK is one filer; a repeated payload is a duplicate, not two entities.
    if (!byCik.has(record.registryRecordId)) byCik.set(record.registryRecordId, record);
  }
  if (skipped > 0) warnings.push(`Skipped ${skipped} payload(s) with no CIK or no company name.`);

  const records = [...byCik.values()];
  const withFormer = records.filter((r) => (r.aliases ?? []).length > 0).length;
  warnings.push(`${withFormer} of ${records.length} record(s) carry at least one SEC-stated former name.`);

  const combined = payloads.map((p) => p.bytes).join("");
  return {
    plan,
    records,
    rawSha256: crypto.createHash("sha256").update(combined).digest("hex"),
    rawBytes: Buffer.byteLength(combined),
    retrievalChannel: options.fromDir ? "agent-relay" : "direct-https",
    sourcePayloads: payloads.map((p) => ({
      file: p.file,
      sha256: crypto.createHash("sha256").update(p.bytes).digest("hex"),
      bytes: Buffer.byteLength(p.bytes),
      records: byCik.has(unpadCik(p.file.replace(/\D/g, ""))) ? 1 : 0,
    })),
    rawPayloads: payloads.map((p) => ({ file: p.file, body: p.bytes })),
    warnings,
  };
}
