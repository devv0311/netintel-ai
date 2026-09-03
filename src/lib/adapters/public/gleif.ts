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
 * GLEIF LEI adapter — read-only, bounded, registry-gated (SRC-002, CC0).
 *
 * Uses the LEI Records API rather than the Golden Copy bulk file: the
 * pilot needs a few hundred records, and downloading a multi-gigabyte
 * bulk file to sample it would be exactly the "large-scale collection"
 * this milestone forbids. If the pilot ever grows past a few thousand
 * records, the bulk file becomes the correct choice and this adapter
 * should be pointed at it instead of paged harder.
 *
 * No name is normalised beyond what GLEIF publishes. "Private Limited"
 * is left as written — whether that defeats Tier-B exact-name matching
 * is the question the pilot exists to answer.
 */

export const GLEIF_SOURCE_ID = "SRC-002";
const ENDPOINT = "https://api.gleif.org/api/v1/lei-records";
/** Bounded by construction: no caller can ask for more than this. */
export const MAX_LIMIT = 500;
const PAGE_SIZE = 100;

/** GLEIF's own jurisdiction filter — ISO 3166-1 alpha-2. */
export interface GleifQuery {
  jurisdiction: string;
}

export function planGleif(query: GleifQuery, options: AdapterOptions): AdapterPlan {
  const entry = requireApprovedSource(GLEIF_SOURCE_ID, options.root);
  const limit = Math.min(options.limit, MAX_LIMIT);
  return {
    sourceId: GLEIF_SOURCE_ID,
    sourceName: entry.sourceName,
    endpoint: ENDPOINT,
    request: `filter[entity.jurisdiction]=${query.jurisdiction}&page[size]=${PAGE_SIZE}`,
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    rateLimit: entry.rateLimit,
    limit,
    estimatedRequests: Math.ceil(limit / PAGE_SIZE),
    // ~2 KB per LEI record in the API's JSON:API envelope.
    estimatedBytes: limit * 2048,
    destination: `data/public/raw/${GLEIF_SOURCE_ID}/<retrievedAt>/lei-records.json`,
  };
}

interface GleifApiRecord {
  attributes?: {
    lei?: string;
    entity?: {
      legalName?: { name?: string };
      otherNames?: { name?: string }[];
      legalJurisdiction?: string;
    };
    registration?: { lastUpdateDate?: string };
  };
}

/**
 * Maps one GLEIF API record to a public_record. Pure — no network, no
 * clock beyond the supplied `retrievedAt`, so it is testable against a
 * saved payload with no live source.
 */
export function mapGleifRecord(
  raw: GleifApiRecord,
  context: { retrievedAt: string; license: string; licenseUrl: string },
): PublicRecordContent | null {
  const lei = raw.attributes?.lei;
  const name = raw.attributes?.entity?.legalName?.name;
  if (!lei || !name) return null;

  const aliases = (raw.attributes?.entity?.otherNames ?? [])
    .map((other) => other.name)
    .filter((value): value is string => Boolean(value));

  return parsePublicRecord({
    recordRef: `gleif:${lei}`,
    registry: "gleif",
    registryRecordId: lei,
    subjectKind: "organisation",
    // NFC only. Nothing else: no case folding, no suffix stripping.
    name: name.normalize("NFC"),
    ...(aliases.length > 0 ? { aliases: aliases.map((a) => a.normalize("NFC")) } : {}),
    identifiers: [{ scheme: "LEI", value: lei }],
    ...(raw.attributes?.registration?.lastUpdateDate
      ? { observedAt: new Date(raw.attributes.registration.lastUpdateDate).toISOString() }
      : {}),
    retrievedAt: context.retrievedAt,
    license: context.license,
    licenseUrl: context.licenseUrl,
    sourceUrl: `${ENDPOINT}/${lei}`,
  });
}

export async function collectGleif(
  query: GleifQuery,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const plan = planGleif(query, options);
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];

  let payload: string;
  if (options.fromFile) {
    payload = fs.readFileSync(options.fromFile, "utf8");
    warnings.push(`Transformed a local payload (${options.fromFile}); no network call was made.`);
  } else {
    const url = `${ENDPOINT}?${plan.request}`;
    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Accept: "application/vnd.api+json",
          "User-Agent": "NetIntelAI-research/0.1 (+https://github.com/devv0311/netintel-ai)",
        },
      });
      if (!response.ok) throw new AdapterFetchError(url, `HTTP ${response.status}`);
      payload = await response.text();
    } catch (error) {
      if (error instanceof AdapterFetchError) throw error;
      throw new AdapterFetchError(url, error instanceof Error ? error.message : String(error));
    }
  }

  const parsed = JSON.parse(payload) as { data?: GleifApiRecord[] };
  const records: PublicRecordContent[] = [];
  for (const raw of (parsed.data ?? []).slice(0, plan.limit)) {
    const record = mapGleifRecord(raw, {
      retrievedAt,
      license: plan.license,
      licenseUrl: plan.licenseUrl,
    });
    if (record) records.push(record);
    else warnings.push("Skipped a GLEIF record with no LEI or no legal name.");
  }

  return {
    plan,
    records,
    rawSha256: crypto.createHash("sha256").update(payload).digest("hex"),
    rawBytes: Buffer.byteLength(payload),
    warnings,
  };
}
