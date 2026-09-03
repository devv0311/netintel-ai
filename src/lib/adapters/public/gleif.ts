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
  type RetrievalChannel,
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
      transliteratedOtherNames?: { name?: string }[];
      jurisdiction?: string;
      legalJurisdiction?: string;
      status?: string;
    };
    registration?: { lastUpdateDate?: string };
  };
}

/**
 * A GLEIF Level 2 relationship record: the publisher's own statement
 * that one LEI stands in a stated relation to another. Both ends are
 * LEIs — publisher ids, never NetIntel entity ids — so attaching one to
 * a record asserts nothing about entity identity.
 */
interface GleifRelationshipRecord {
  attributes?: {
    relationship?: {
      startNode?: { id?: string; type?: string };
      endNode?: { id?: string; type?: string };
      type?: string;
      status?: string;
    };
  };
}

/**
 * GLEIF writes its predicates as `IS_FUND-MANAGED_BY`. Lowercased and
 * separator-folded so the graph layer sees the same shape it sees from
 * every other source; the publisher's meaning is not translated, only
 * its punctuation.
 */
export function normaliseGleifPredicate(type: string): string {
  return type.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

/** Extracts the stated relation from a Level 2 payload, or null. */
export function mapGleifRelationship(
  raw: GleifRelationshipRecord,
): { startLei: string; predicate: string; endLei: string } | null {
  const rel = raw.attributes?.relationship;
  const startLei = rel?.startNode?.id;
  const endLei = rel?.endNode?.id;
  const type = rel?.type;
  // Only LEI-to-LEI relations are representable: the schema's
  // targetRegistryRecordId is a registry id, and a non-LEI node would
  // silently become one.
  if (!startLei || !endLei || !type) return null;
  if (rel?.startNode?.type && rel.startNode.type !== "LEI") return null;
  if (rel?.endNode?.type && rel.endNode.type !== "LEI") return null;
  return { startLei, predicate: normaliseGleifPredicate(type), endLei };
}

/**
 * Maps one GLEIF API record to a public_record. Pure — no network, no
 * clock beyond the supplied `retrievedAt`, so it is testable against a
 * saved payload with no live source.
 */
export function mapGleifRecord(
  raw: GleifApiRecord,
  context: {
    retrievedAt: string;
    license: string;
    licenseUrl: string;
    /** Publisher-stated relations whose startNode is this LEI. */
    relations?: { predicate: string; targetRegistryRecordId: string }[];
  },
): PublicRecordContent | null {
  const lei = raw.attributes?.lei;
  const name = raw.attributes?.entity?.legalName?.name;
  if (!lei || !name) return null;

  // otherNames are trading/operating names; transliteratedOtherNames are
  // the same subject written in another script. Both are names the
  // publisher itself attaches to this record, so both are aliases; the
  // resolver is left to decide what, if anything, that implies.
  const aliases = [
    ...(raw.attributes?.entity?.otherNames ?? []),
    ...(raw.attributes?.entity?.transliteratedOtherNames ?? []),
  ]
    .map((other) => other.name)
    .filter((value): value is string => Boolean(value));

  const jurisdiction =
    raw.attributes?.entity?.jurisdiction ?? raw.attributes?.entity?.legalJurisdiction;
  const status = raw.attributes?.entity?.status;

  return parsePublicRecord({
    recordRef: `gleif:${lei}`,
    registry: "gleif",
    registryRecordId: lei,
    subjectKind: "organisation",
    // NFC only. Nothing else: no case folding, no suffix stripping.
    name: name.normalize("NFC"),
    ...(aliases.length > 0 ? { aliases: aliases.map((a) => a.normalize("NFC")) } : {}),
    identifiers: [{ scheme: "LEI", value: lei }],
    ...(context.relations && context.relations.length > 0
      ? { relations: context.relations }
      : {}),
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(status ? { status } : {}),
    ...(raw.attributes?.registration?.lastUpdateDate
      ? { observedAt: new Date(raw.attributes.registration.lastUpdateDate).toISOString() }
      : {}),
    retrievedAt: context.retrievedAt,
    license: context.license,
    licenseUrl: context.licenseUrl,
    sourceUrl: `${ENDPOINT}/${lei}`,
  });
}

/** Splits a JSON:API payload into its record objects, list or single. */
function payloadRecords(payload: string): { type: string; record: unknown }[] {
  const parsed = JSON.parse(payload) as { data?: unknown };
  const data = parsed.data;
  const items = Array.isArray(data) ? data : data ? [data] : [];
  return items.map((item) => ({
    type: String((item as { type?: unknown }).type ?? ""),
    record: item,
  }));
}

export async function collectGleif(
  query: GleifQuery,
  options: AdapterOptions,
): Promise<AdapterResult> {
  const plan = planGleif(query, options);
  const retrievedAt = new Date().toISOString();
  const warnings: string[] = [];
  const sourcePayloads: AdapterResult["sourcePayloads"] = [];

  // Each entry is one retrieved payload, kept separate so its own hash
  // and record count stay attributable to the request that produced it.
  const payloads: { file: string; body: string }[] = [];
  let retrievalChannel: RetrievalChannel = "direct-https";

  if (options.fromDir) {
    retrievalChannel = "agent-relay";
    const dir = options.fromDir;
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".json") && !f.startsWith("retrieval-manifest"))
      .sort();
    if (files.length === 0) throw new AdapterFetchError(dir, "no *.json payloads in directory");
    for (const file of files) {
      payloads.push({ file, body: fs.readFileSync(path.join(dir, file), "utf8") });
    }
    warnings.push(
      `Transformed ${files.length} stored payload(s) from ${dir} via the agent-relay channel; ` +
        `no socket was opened by this process, and rawSha256 hashes the STORED bytes, not verified wire bytes.`,
    );
  } else if (options.fromFile) {
    payloads.push({ file: path.basename(options.fromFile), body: fs.readFileSync(options.fromFile, "utf8") });
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
      payloads.push({ file: "lei-records.json", body: await response.text() });
    } catch (error) {
      if (error instanceof AdapterFetchError) throw error;
      throw new AdapterFetchError(url, error instanceof Error ? error.message : String(error));
    }
  }

  // Pass 1 — collect the publisher's stated relations, keyed by the LEI
  // they start at. Done first so a relation can be attached to its
  // subject regardless of which payload each arrived in.
  const relationsByLei = new Map<string, { predicate: string; targetRegistryRecordId: string }[]>();
  for (const { body } of payloads) {
    for (const { type, record } of payloadRecords(body)) {
      if (type !== "relationship-records") continue;
      const relation = mapGleifRelationship(record as GleifRelationshipRecord);
      if (!relation) {
        warnings.push("Skipped a GLEIF relationship record that was not a complete LEI-to-LEI relation.");
        continue;
      }
      const existing = relationsByLei.get(relation.startLei) ?? [];
      existing.push({ predicate: relation.predicate, targetRegistryRecordId: relation.endLei });
      relationsByLei.set(relation.startLei, existing);
    }
  }

  // Pass 2 — map the LEI records themselves. Deduplicated by LEI: the
  // same record legitimately appears in two payloads (a jurisdiction
  // page and a name search), and emitting it twice would let one real
  // entity look like two sources agreeing.
  const byLei = new Map<string, PublicRecordContent>();
  for (const { file, body } of payloads) {
    let inPayload = 0;
    for (const { type, record } of payloadRecords(body)) {
      if (type !== "lei-records") continue;
      const raw = record as GleifApiRecord;
      const lei = raw.attributes?.lei;
      if (lei && byLei.has(lei)) {
        warnings.push(`Duplicate LEI ${lei} in ${file}; kept the first occurrence.`);
        continue;
      }
      const mapped = mapGleifRecord(raw, {
        retrievedAt,
        license: plan.license,
        licenseUrl: plan.licenseUrl,
        ...(lei && relationsByLei.has(lei) ? { relations: relationsByLei.get(lei)! } : {}),
      });
      if (!mapped) {
        warnings.push("Skipped a GLEIF record with no LEI or no legal name.");
        continue;
      }
      byLei.set(mapped.registryRecordId, mapped);
      inPayload++;
    }
    sourcePayloads.push({
      file,
      sha256: crypto.createHash("sha256").update(body).digest("hex"),
      bytes: Buffer.byteLength(body),
      records: inPayload,
    });
  }

  // The bound is enforced on the result, not just per request, so a
  // multi-payload relay run cannot exceed what --limit permitted.
  const records = [...byLei.values()].slice(0, plan.limit);
  if (byLei.size > plan.limit) {
    warnings.push(`Bounded to ${plan.limit} records; ${byLei.size - plan.limit} discarded.`);
  }

  const combined = payloads.map((p) => p.body).join("");
  return {
    plan,
    records,
    rawSha256: crypto.createHash("sha256").update(combined).digest("hex"),
    rawBytes: Buffer.byteLength(combined),
    retrievalChannel,
    sourcePayloads,
    warnings,
  };
}
