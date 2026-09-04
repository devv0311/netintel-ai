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

/**
 * What to ask GLEIF for. Both forms are bounded and neither accepts a URL.
 *
 * `leis` exists for cross-source work: the linkage set is derived from
 * ALREADY-COLLECTED, registry-approved records of another source, never
 * hand-typed and never crawled. Collecting a jurisdiction page and hoping
 * it overlaps another publisher's sample does not work — the first pilot
 * drew 24 of India's 395,227 LEIs and overlapped Wikidata on exactly
 * zero — so a targeted lookup of the specific identifiers the other
 * source already published is both the smaller request and the only one
 * that produces cross-source pairs.
 */
export interface GleifQuery {
  jurisdiction: string;
  /** Exact LEIs to fetch. Bounded by MAX_LIMIT like everything else. */
  leis?: string[];
  /**
   * Also fetch each collected LEI's Level 2 PARENT relationships.
   *
   * Only meaningful with `leis`: the relation endpoints are per-record
   * sub-resources, so there is no way to express "every relationship in
   * a jurisdiction" and no way to start a bulk relationship crawl. The
   * LEI list is itself derived from already-collected approved records,
   * so this widens what is known about records already held rather than
   * widening the collection.
   *
   * SRC-002 is registered as "GLEIF LEI (Level 1 + Level 2)" and
   * APPROVED, so Level 2 needs no new approval - it is the half of the
   * approved source that was never actually requested.
   */
  withRelationships?: boolean;
}

/** GLEIF accepts a comma-separated filter[lei]; batched to stay well inside its page size. */
const LEI_BATCH = 40;

/**
 * The Level 2 sub-resources fetched per LEI, in a fixed order.
 *
 * BOTH are needed and neither substitutes for the other. GLEIF's
 * `direct-parent` is the immediate consolidating entity, which for an
 * operating subsidiary is usually an intermediate holding company whose
 * name shares no tokens with the group: BNP PARIBAS CARDIF POJISTOVNA's
 * direct parent is BNP PARIBAS CARDIF, not BNP PARIBAS. The
 * `ultimate-parent` is the top of the consolidation chain, and that is
 * the one that answers "is this short name the group this longer name
 * belongs to". Collecting only the direct parent would leave the
 * containment question exactly as unanswerable as it is today.
 *
 * There is deliberately no `direct-children` / `ultimate-children` here.
 * Those endpoints are PAGED collections whose size is a property of the
 * parent, not of our request - one call against a large group returns
 * thousands of records - so they are not bounded by construction the way
 * the two parent look-ups are. The parent direction carries the same
 * edges anyway, stated from the other end.
 */
const RELATIONSHIP_PATHS = ["direct-parent-relationship", "ultimate-parent-relationship"] as const;

/**
 * GLEIF's fair-use guidance is a request rate, not a quota. 120ms is
 * ~8 req/s, inside the 10 req/s the registry entry records for the
 * publisher's API, and the collector waits rather than bursting.
 */
const MIN_REQUEST_INTERVAL_MS = 120;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects anything that is not a syntactically valid LEI before it reaches a query string. */
export function isLei(value: string): boolean {
  return /^[A-Z0-9]{20}$/.test(value);
}

export function planGleif(query: GleifQuery, options: AdapterOptions): AdapterPlan {
  const entry = requireApprovedSource(GLEIF_SOURCE_ID, options.root);
  const limit = Math.min(options.limit, MAX_LIMIT);
  const leis = (query.leis ?? []).filter(isLei).slice(0, limit);
  // Relationships are a per-record sub-resource, so they are only
  // requestable for an explicit LEI list. Asked for without one, the
  // flag is inert rather than silently widening a jurisdiction page.
  const wantsRelationships = Boolean(query.withRelationships) && leis.length > 0;
  return {
    sourceId: GLEIF_SOURCE_ID,
    sourceName: entry.sourceName,
    endpoint: ENDPOINT,
    request:
      (leis.length > 0
        ? `filter[lei]=<${leis.length} LEIs from an already-collected source>&page[size]=${LEI_BATCH}`
        : `filter[entity.jurisdiction]=${query.jurisdiction}&page[size]=${PAGE_SIZE}`) +
      (wantsRelationships
        ? ` + Level 2: /lei-records/<each of ${leis.length} LEIs>/{${RELATIONSHIP_PATHS.join(",")}}`
        : ""),
    license: entry.license,
    licenseUrl: entry.licenseUrl,
    rateLimit: entry.rateLimit,
    limit,
    estimatedRequests:
      (leis.length > 0 ? Math.ceil(leis.length / LEI_BATCH) : Math.ceil(limit / PAGE_SIZE)) +
      (wantsRelationships ? leis.length * RELATIONSHIP_PATHS.length : 0),
    // ~2 KB per LEI record in the API's JSON:API envelope; a relationship
    // record is ~1 KB and there are at most two per LEI.
    estimatedBytes: limit * 2048 + (wantsRelationships ? leis.length * 2048 : 0),
    destination: `data/public/raw/${GLEIF_SOURCE_ID}/<retrievedAt>/lei-records.json`,
  };
}

interface GleifApiRecord {
  attributes?: {
    lei?: string;
    /** OpenCorporates id, published by GLEIF itself (e.g. "in/L23109WB1973GOI028844"). */
    ocid?: string | null;
    entity?: {
      legalName?: { name?: string };
      otherNames?: { name?: string }[];
      transliteratedOtherNames?: { name?: string }[];
      jurisdiction?: string;
      legalJurisdiction?: string;
      status?: string;
      /** The national business register that registered this entity (GLEIF RA code). */
      registeredAt?: { id?: string | null } | null;
      /** The entity's number IN that register — an Indian CIN, a UK company number, and so on. */
      registeredAs?: string | null;
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
/**
 * Every identifier GLEIF states about this record.
 *
 * P6.19: GLEIF publishes more than the LEI it issues. `ocid` is an
 * OpenCorporates id and `entity.registeredAs` is the entity's number in
 * its NATIONAL business register, qualified by the register's GLEIF
 * authority code (`entity.registeredAt.id`, e.g. RA000394 for the Indian
 * MCA). Both were being discarded.
 *
 * They matter because they are bridges that do NOT run through the LEI:
 * Wikidata publishes an OpenCorporates id for ~28,600 LEI-bearing items,
 * so a cross-source pair can be corroborated by a scheme the linking
 * source did not supply. A national register number is qualified by its
 * authority because the same digits mean different companies in
 * different registers — an unqualified value would be a collision
 * waiting to happen.
 *
 * Recording an identifier is not permission to merge on it. Only
 * MERGEABLE_IDENTIFIER_SCHEMES may merge, and that set is still {LEI}.
 */
export function gleifIdentifiers(
  raw: GleifApiRecord,
  lei: string,
): { scheme: string; value: string }[] {
  const identifiers = [{ scheme: "LEI", value: lei }];
  const ocid = raw.attributes?.ocid;
  if (typeof ocid === "string" && ocid.length > 0) {
    identifiers.push({ scheme: "OPENCORPORATES", value: ocid });
  }
  const registeredAs = raw.attributes?.entity?.registeredAs;
  const registeredAt = raw.attributes?.entity?.registeredAt?.id;
  if (typeof registeredAs === "string" && registeredAs.length > 0
      && typeof registeredAt === "string" && registeredAt.length > 0) {
    identifiers.push({ scheme: `NATIONAL_REGISTER:${registeredAt}`, value: registeredAs });
  }
  return identifiers;
}

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
    identifiers: gleifIdentifiers(raw, lei),
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
    const leis = (query.leis ?? []).filter(isLei).slice(0, plan.limit);
    const requested = (query.leis ?? []).length;
    if (requested > 0 && leis.length < requested) {
      warnings.push(
        `${requested - leis.length} of ${requested} requested identifiers were not valid LEIs or exceeded --limit; not requested.`,
      );
    }
    // Either a bounded list of exact LEIs, or one jurisdiction page. There
    // is no third mode and no way to express "everything".
    const requests: { file: string; query: string }[] =
      leis.length > 0
        ? Array.from({ length: Math.ceil(leis.length / LEI_BATCH) }, (_, i) => {
            const batch = leis.slice(i * LEI_BATCH, (i + 1) * LEI_BATCH);
            return {
              file: `lei-records-batch-${String(i + 1).padStart(2, "0")}.json`,
              query: `filter[lei]=${encodeURIComponent(batch.join(","))}&page[size]=${LEI_BATCH}`,
            };
          })
        : [
            {
              file: "lei-records.json",
              query: `filter[entity.jurisdiction]=${encodeURIComponent(query.jurisdiction)}&page[size]=${PAGE_SIZE}`,
            },
          ];

    for (const request of requests) {
      const url = `${ENDPOINT}?${request.query}`;
      try {
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/vnd.api+json",
            "User-Agent": "NetIntelAI-research/0.1 (+https://github.com/devv0311/netintel-ai)",
          },
        });
        if (response.status === 429) {
          throw new AdapterFetchError(ENDPOINT, "HTTP 429 — rate limited; stop, do not back off in a loop");
        }
        if (!response.ok) throw new AdapterFetchError(url, `HTTP ${response.status}`);
        payloads.push({ file: request.file, body: await response.text() });
      } catch (error) {
        if (error instanceof AdapterFetchError) throw error;
        throw new AdapterFetchError(url, error instanceof Error ? error.message : String(error));
      }
      await sleep(MIN_REQUEST_INTERVAL_MS);
    }

    // --- Level 2, the approved half of SRC-002 that was never requested ---
    //
    // The relationship-record BRANCH of pass 1 below has existed since
    // P6.x and could never fire, because nothing ever fetched a payload
    // containing one: the only endpoint called was /lei-records.
    // Relationship coverage read 0 for that reason and not because GLEIF
    // withholds the data.
    if (query.withRelationships && leis.length > 0) {
      let stated = 0;
      let absent = 0;
      for (const lei of leis) {
        for (const relPath of RELATIONSHIP_PATHS) {
          const url = `${ENDPOINT}/${lei}/${relPath}`;
          let response: Response;
          try {
            response = await fetch(url, {
              method: "GET",
              headers: {
                Accept: "application/vnd.api+json",
                "User-Agent": "NetIntelAI-research/0.1 (+https://github.com/devv0311/netintel-ai)",
              },
            });
          } catch (error) {
            throw new AdapterFetchError(url, error instanceof Error ? error.message : String(error));
          }
          if (response.status === 429) {
            throw new AdapterFetchError(ENDPOINT, "HTTP 429 — rate limited; stop, do not back off in a loop");
          }
          // 404 is the publisher's ANSWER, not a failure: GLEIF returns
          // it for an entity that states no parent of that kind, which
          // is the common case (a group's ultimate parent has none by
          // definition). Treating it as an error would abort a run over
          // its most ordinary result; recording it as a fetch failure
          // would make "no parent stated" indistinguishable from "we
          // could not ask". It is counted and otherwise skipped.
          if (response.status === 404) {
            absent++;
            await sleep(MIN_REQUEST_INTERVAL_MS);
            continue;
          }
          if (!response.ok) throw new AdapterFetchError(url, `HTTP ${response.status}`);
          payloads.push({ file: `relationship-${lei}-${relPath}.json`, body: await response.text() });
          stated++;
          await sleep(MIN_REQUEST_INTERVAL_MS);
        }
      }
      warnings.push(
        `Level 2: asked ${leis.length} LEIs for ${RELATIONSHIP_PATHS.join(" and ")}; ` +
          `${stated} relationship(s) stated, ${absent} absent (HTTP 404 — the publisher's answer, not a failure).`,
      );
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
      // A relationship payload carries no lei-record, so `records` would
      // read 0 for it and the manifest would look like a payload that
      // yielded nothing. Count the relations it actually carried, so
      // every stored payload accounts for what was derived from it.
      if (type === "relationship-records") {
        inPayload++;
        continue;
      }
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
    rawPayloads: payloads,
    warnings,
  };
}
