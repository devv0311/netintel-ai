import type { Alias, Entity, EntityKind } from "@/lib/domain/entity";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import { makeContentId } from "@/lib/domain/ids";
import type { EvidenceClassification, Provenance } from "@/lib/domain/provenance";
import type { RelationshipType } from "@/lib/domain/relationship";
import type { ResolutionDecision } from "@/lib/domain/resolution";

/**
 * Graph synthesis core: deterministic construction of relationship
 * candidates from P5.4's resolved entities and P5.3's extracted
 * records. Every edge is justified by structural evidence explicitly
 * present in the extracted records — never by re-running identity
 * resolution, never by raw-name matching except as a bounded fallback
 * lookup against P5.4's ALREADY-COMPUTED canonical registry (never a
 * new clustering/merge decision).
 *
 * Endpoint resolution has two paths, deliberately kept separate:
 *
 *   A. Same-evidence-item sibling lookup (deterministic, no guessing):
 *      a `has_phone`/`has_account`/`has_vehicle` relationship_mention's
 *      "subject" is the person named by that SAME evidence item's own
 *      person entity_mention record — found via resolution_decisions,
 *      exactly mirroring how P5.4's Tier-A clustering itself read these
 *      same sibling records (src/lib/resolution/resolve.ts).
 *
 *   B. Canonical-registry lookup (bounded, exact-match only): a
 *      `phone_subscriber`/`account_held_by`/`vehicle_registered_to`
 *      relationship_mention's target person has NO sibling entity_mention
 *      in its own evidence item — the only way to resolve it is to look
 *      up its name string against entities.canonicalLabel ∪
 *      aliases.aliasValue (P5.4's own already-resolved output, not a new
 *      inference). Zero or multiple matches → the record is dropped with
 *      a warning, never guessed.
 *
 * Every relationship_mention/event_mention is aggregated into AT MOST
 * ONE edge per (relationshipType, sourceEntityId, targetEntityId) triple
 * — repeated evidence corroborates an existing edge (raising
 * evidenceItemIds' count, which upgrades classification to
 * corroborated_fact) rather than creating duplicate edges.
 *
 * Two edge families:
 *   - DIRECT edges (ownership, phone↔phone communication, account↔account
 *     financial, phone↔location co_location): classification is
 *     "observed_fact" (1 contributing evidence item) or "corroborated_fact"
 *     (≥2 distinct contributing evidence items) — never higher.
 *   - DERIVED edges (person↔person communication/financial, built by
 *     chaining an ownership edge + a direct event edge): always
 *     "ai_inference" — combining two distinct fact types into a
 *     conclusion beyond either alone is the textbook AI Inference
 *     definition (docs/requirements.md §7), however deterministic the
 *     chaining rule is (same rationale P5.4 documents for
 *     ResolutionDecision).
 *
 * crime_event records are deliberately out of scope for this module —
 * they carry no clean structured person-entity endpoint on the record
 * itself (see docs/data/graph.md, limitations).
 */

export const CONFIDENCE = {
  direct: 1,
  derivedPersonEdge: 0.7,
} as const;

export interface LocationCandidate {
  id: string;
  investigationId: string;
  label: string;
  locationType: "address" | "cell_tower" | "crime_scene" | "other";
  latitude: number;
  longitude: number;
  provenance: Provenance;
}

export interface CommunicationEventCandidate {
  id: string;
  investigationId: string;
  callerPhone: string;
  calleePhone: string;
  callerEntityId?: string;
  calleeEntityId?: string;
  occurredAt: string;
  durationSeconds: number;
  cellLocationId?: string;
  provenance: Provenance;
}

export interface FinancialTransactionCandidate {
  id: string;
  investigationId: string;
  fromAccountEntityId?: string;
  toAccountEntityId?: string;
  amount: number;
  currency: string;
  occurredAt: string;
  provenance: Provenance;
}

export interface RelationshipCandidate {
  id: string;
  investigationId: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationshipType: RelationshipType;
  directed: boolean;
  evidenceItemIds: string[];
  extractedRecordIds: string[];
  conflicts: string[];
  attributes: Record<string, unknown>;
  classification: EvidenceClassification;
  provenance: Provenance;
}

export interface GraphBuildOutput {
  locations: LocationCandidate[];
  communicationEvents: CommunicationEventCandidate[];
  financialTransactions: FinancialTransactionCandidate[];
  relationships: RelationshipCandidate[];
  warnings: string[];
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(data: Record<string, unknown>, key: string): number | undefined {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Accumulator for one (relationshipType, source, target) edge under construction. */
interface Accum {
  relationshipType: RelationshipType;
  sourceEntityId: string;
  targetEntityId: string;
  directed: boolean;
  evidenceItemIds: Set<string>;
  extractedRecordIds: Set<string>;
  attributesAcc: {
    count: number;
    firstObservedAt?: string;
    lastObservedAt?: string;
    totalDurationSeconds?: number;
    totalAmount?: number;
    currency?: string;
  };
  forcedClassification?: EvidenceClassification;
  forcedConfidence?: number;
  method: string;
  primaryRecordId: string;
  primaryProvenance: Provenance;
}

function edgeKey(type: RelationshipType, source: string, target: string): string {
  return `${type}|${source}|${target}`;
}

const PERSON_ANCHORED: Record<string, EntityKind> = {
  has_phone: "phone",
  has_account: "bank_account",
  has_vehicle: "vehicle",
};

const IDENTIFIER_ANCHORED: Record<string, EntityKind> = {
  vehicle_registered_to: "vehicle",
  account_held_by: "bank_account",
  phone_subscriber: "phone",
};

export function synthesizeGraph(
  entities: Entity[],
  aliases: Alias[],
  decisions: ResolutionDecision[],
  records: ExtractedRecord[],
  investigationId: string,
  synthesizedAt: string,
): GraphBuildOutput {
  const warnings: string[] = [];
  const entityById = new Map(entities.map((e) => [e.id, e]));

  // --- indices -----------------------------------------------------

  // extracted_record id -> canonical entity id (covers both person
  // mentions and identifier mentions — P5.4's decisions already record
  // this for every entity_mention it processed).
  const canonicalByRecordId = new Map<string, string>();
  for (const d of decisions) {
    for (const recId of d.extractedRecordIds) canonicalByRecordId.set(recId, d.canonicalEntityId);
  }

  // identifier entity lookup: "<kind>:<value>" -> canonical entity id
  // (identifier entities' canonicalLabel IS the raw value, per P5.4).
  const identifierEntityId = new Map<string, string>();
  for (const e of entities) {
    if (e.kind !== "person") identifierEntityId.set(`${e.kind}:${e.canonicalLabel}`, e.id);
  }

  // exact-name person lookup, built ONLY from P5.4's already-resolved
  // output (never a new merge decision): canonicalLabel + aliasValue.
  const nameToPersonEntityIds = new Map<string, Set<string>>();
  for (const e of entities) {
    if (e.kind !== "person") continue;
    const set = nameToPersonEntityIds.get(e.canonicalLabel) ?? new Set<string>();
    set.add(e.id);
    nameToPersonEntityIds.set(e.canonicalLabel, set);
  }
  for (const a of aliases) {
    const owner = entityById.get(a.entityId);
    if (!owner || owner.kind !== "person") continue;
    const set = nameToPersonEntityIds.get(a.aliasValue) ?? new Set<string>();
    set.add(a.entityId);
    nameToPersonEntityIds.set(a.aliasValue, set);
  }

  // per-evidence-item person entity_mention record (Path A sibling lookup).
  const personMentionByItem = new Map<string, ExtractedRecord>();
  for (const r of records) {
    if (r.recordType !== "entity_mention" || str(r.data, "mentionKind") !== "person") continue;
    if (!personMentionByItem.has(r.evidenceItemId)) personMentionByItem.set(r.evidenceItemId, r);
  }

  function resolvePersonBySameItemSibling(evidenceItemId: string): { id: string } | null {
    const sibling = personMentionByItem.get(evidenceItemId);
    if (!sibling) return null;
    const canonicalId = canonicalByRecordId.get(sibling.id);
    if (!canonicalId) return null;
    return { id: canonicalId };
  }

  function resolvePersonByNameLookup(name: string): string | null {
    const candidates = nameToPersonEntityIds.get(name);
    if (!candidates || candidates.size !== 1) return null;
    return [...candidates][0]!;
  }

  // --- accumulation --------------------------------------------------

  const accByKey = new Map<string, Accum>();
  // identifier entity id -> owning person entity id (first ownership edge wins; used for derived person↔person edges).
  const ownerOf = new Map<string, { personId: string }>();

  function addContribution(
    type: RelationshipType,
    source: string,
    target: string,
    directed: boolean,
    evidenceItemId: string,
    extractedRecordId: string,
    method: string,
    primary: ExtractedRecord,
    numeric?: { occurredAt?: string; durationSeconds?: number; amount?: number; currency?: string },
    forced?: { classification?: EvidenceClassification; confidence?: number },
  ): void {
    const key = edgeKey(type, source, target);
    let acc = accByKey.get(key);
    if (!acc) {
      acc = {
        relationshipType: type,
        sourceEntityId: source,
        targetEntityId: target,
        directed,
        evidenceItemIds: new Set(),
        extractedRecordIds: new Set(),
        attributesAcc: { count: 0 },
        forcedClassification: forced?.classification,
        forcedConfidence: forced?.confidence,
        method,
        primaryRecordId: primary.id,
        primaryProvenance: primary.provenance,
      };
      accByKey.set(key, acc);
    }
    acc.evidenceItemIds.add(evidenceItemId);
    acc.extractedRecordIds.add(extractedRecordId);
    if (extractedRecordId < acc.primaryRecordId) {
      acc.primaryRecordId = extractedRecordId;
      acc.primaryProvenance = primary.provenance;
    }
    acc.attributesAcc.count += 1;
    if (numeric?.occurredAt) {
      if (!acc.attributesAcc.firstObservedAt || numeric.occurredAt < acc.attributesAcc.firstObservedAt) {
        acc.attributesAcc.firstObservedAt = numeric.occurredAt;
      }
      if (!acc.attributesAcc.lastObservedAt || numeric.occurredAt > acc.attributesAcc.lastObservedAt) {
        acc.attributesAcc.lastObservedAt = numeric.occurredAt;
      }
    }
    if (numeric?.durationSeconds !== undefined) {
      acc.attributesAcc.totalDurationSeconds = (acc.attributesAcc.totalDurationSeconds ?? 0) + numeric.durationSeconds;
    }
    if (numeric?.amount !== undefined) {
      acc.attributesAcc.totalAmount = (acc.attributesAcc.totalAmount ?? 0) + numeric.amount;
      if (numeric.currency) acc.attributesAcc.currency = numeric.currency;
    }
    if (type === "ownership" && !ownerOf.has(target)) {
      ownerOf.set(target, { personId: source });
    }
  }

  const relationshipMentions = records.filter((r) => r.recordType === "relationship_mention");
  const eventMentions = records.filter((r) => r.recordType === "event_mention");
  const locationMentions = records.filter(
    (r) => r.recordType === "entity_mention" && str(r.data, "mentionKind") === "location",
  );

  // --- relationship_mentions: ownership (Path A + Path B) ---------------

  for (const r of relationshipMentions) {
    const relType = str(r.data, "relationshipType");
    if (!relType) continue;

    if (relType in PERSON_ANCHORED) {
      const targetKind = PERSON_ANCHORED[relType]!;
      const value = str(r.data, "observedValue");
      if (!value) continue;
      const person = resolvePersonBySameItemSibling(r.evidenceItemId);
      const targetId = identifierEntityId.get(`${targetKind}:${value}`);
      if (!person) {
        warnings.push(
          `${relType} on ${r.id}: no sibling person entity_mention resolved in evidence item ${r.evidenceItemId}; skipped.`,
        );
        continue;
      }
      if (!targetId) {
        warnings.push(`${relType} on ${r.id}: ${targetKind} "${value}" never canonicalized as an entity; skipped.`);
        continue;
      }
      addContribution("ownership", person.id, targetId, true, r.evidenceItemId, r.id, `graph:ownership:${relType}`, r);
      continue;
    }

    if (relType === "phone_bound_to_imei") {
      const phoneValue = str(r.data, "subject");
      const imeiValue = str(r.data, "observedValue");
      if (!phoneValue || !imeiValue) continue;
      const phoneId = identifierEntityId.get(`phone:${phoneValue}`);
      const imeiId = identifierEntityId.get(`imei:${imeiValue}`);
      if (!phoneId || !imeiId) {
        warnings.push(`phone_bound_to_imei on ${r.id}: phone or imei never canonicalized; skipped.`);
        continue;
      }
      addContribution("ownership", phoneId, imeiId, true, r.evidenceItemId, r.id, "graph:ownership:phone_bound_to_imei", r);
      continue;
    }

    if (relType === "imei_bound_to_phone") {
      // Normalize direction to phone → imei so it aggregates with phone_bound_to_imei.
      const imeiValue = str(r.data, "subject");
      const phoneValue = str(r.data, "observedValue");
      if (!phoneValue || !imeiValue) continue;
      const phoneId = identifierEntityId.get(`phone:${phoneValue}`);
      const imeiId = identifierEntityId.get(`imei:${imeiValue}`);
      if (!phoneId || !imeiId) {
        warnings.push(`imei_bound_to_phone on ${r.id}: phone or imei never canonicalized; skipped.`);
        continue;
      }
      addContribution("ownership", phoneId, imeiId, true, r.evidenceItemId, r.id, "graph:ownership:imei_bound_to_phone", r);
      continue;
    }

    if (relType in IDENTIFIER_ANCHORED) {
      const kind = IDENTIFIER_ANCHORED[relType]!;
      const identifierValue = str(r.data, "subject");
      const personName = str(r.data, "observedValue");
      if (!identifierValue || !personName) continue;
      const targetId = identifierEntityId.get(`${kind}:${identifierValue}`);
      if (!targetId) {
        warnings.push(`${relType} on ${r.id}: ${kind} "${identifierValue}" never canonicalized; skipped.`);
        continue;
      }
      const personId = resolvePersonByNameLookup(personName);
      if (!personId) {
        warnings.push(`${relType} on ${r.id}: person name "${personName}" did not resolve to exactly one canonical entity; skipped.`);
        continue;
      }
      addContribution("ownership", personId, targetId, true, r.evidenceItemId, r.id, `graph:ownership:${relType}`, r);
      continue;
    }

    if (relType === "has_alias" || relType === "alias_of") continue; // resolution's job, never a graph edge

    warnings.push(`Unsupported relationship_mention type "${relType}" on ${r.id}; skipped.`);
  }

  // --- Locations (from location entity_mentions) ----------------------

  const locations: LocationCandidate[] = [];
  const locationIdByLabel = new Map<string, string>();
  for (const r of [...locationMentions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const label = str(r.data, "observedValue");
    if (!label) continue;
    if (locationIdByLabel.has(label)) continue;
    const id = makeContentId("location", [label]);
    locationIdByLabel.set(label, id);
    const rawType = r.data.locationType;
    const locationType = (
      typeof rawType === "string" && ["address", "cell_tower", "crime_scene", "other"].includes(rawType) ? rawType : "other"
    ) as LocationCandidate["locationType"];
    locations.push({
      id,
      investigationId,
      label,
      locationType,
      latitude: num(r.data, "latitude") ?? 0,
      longitude: num(r.data, "longitude") ?? 0,
      provenance: {
        source: r.id,
        location: r.provenance.location,
        method: "graph:location",
        confidence: CONFIDENCE.direct,
        processingHistory: [...r.provenance.processingHistory, "graph:location_created"],
        timestamp: synthesizedAt,
      },
    });
  }

  // --- Events: communication + financial ------------------------------

  const communicationEvents: CommunicationEventCandidate[] = [];
  const financialTransactions: FinancialTransactionCandidate[] = [];

  for (const r of eventMentions) {
    const kind = str(r.data, "eventKind");

    if (kind === "communication") {
      const callerNumber = str(r.data, "callerNumber");
      const calleeNumber = str(r.data, "calleeNumber");
      const startedAt = str(r.data, "startedAt");
      if (!callerNumber || !calleeNumber || !startedAt) continue;
      const callerId = identifierEntityId.get(`phone:${callerNumber}`);
      const calleeId = identifierEntityId.get(`phone:${calleeNumber}`);
      const cellTower = str(r.data, "cellTower");
      const cellLocationId = cellTower ? locationIdByLabel.get(cellTower) : undefined;

      communicationEvents.push({
        id: makeContentId("communication_event", [r.id]),
        investigationId,
        callerPhone: callerNumber,
        calleePhone: calleeNumber,
        callerEntityId: callerId,
        calleeEntityId: calleeId,
        occurredAt: startedAt,
        durationSeconds: num(r.data, "durationSeconds") ?? 0,
        cellLocationId,
        provenance: {
          source: r.id,
          location: r.provenance.location,
          method: "graph:communication_event",
          confidence: CONFIDENCE.direct,
          processingHistory: [...r.provenance.processingHistory, "graph:communication_event_created"],
          timestamp: synthesizedAt,
        },
      });

      if (!callerId || !calleeId) {
        warnings.push(`communication event ${r.id}: caller or callee phone never canonicalized; no communication edge added.`);
      } else {
        addContribution("communication", callerId, calleeId, true, r.evidenceItemId, r.id, "graph:communication", r, {
          occurredAt: startedAt,
          durationSeconds: num(r.data, "durationSeconds"),
        });
        if (cellLocationId) {
          addContribution("co_location", callerId, cellLocationId, false, r.evidenceItemId, r.id, "graph:co_location", r, {
            occurredAt: startedAt,
          });
          addContribution("co_location", calleeId, cellLocationId, false, r.evidenceItemId, r.id, "graph:co_location", r, {
            occurredAt: startedAt,
          });
        }
        // derived person↔person communication edge, via ownership chain
        const callerOwner = ownerOf.get(callerId);
        const calleeOwner = ownerOf.get(calleeId);
        if (callerOwner && calleeOwner && callerOwner.personId !== calleeOwner.personId) {
          addContribution(
            "communication",
            callerOwner.personId,
            calleeOwner.personId,
            true,
            r.evidenceItemId,
            r.id,
            "graph:communication_inferred",
            r,
            { occurredAt: startedAt, durationSeconds: num(r.data, "durationSeconds") },
            { classification: "ai_inference", confidence: CONFIDENCE.derivedPersonEdge },
          );
        }
      }
      continue;
    }

    if (kind === "financial_transaction") {
      const fromAccount = str(r.data, "fromAccount");
      const toAccount = str(r.data, "toAccount");
      const amount = num(r.data, "amount");
      const valueDate = str(r.data, "valueDate");
      if (!fromAccount || !toAccount || amount === undefined || !valueDate) continue;
      const fromId = identifierEntityId.get(`bank_account:${fromAccount}`);
      const toId = identifierEntityId.get(`bank_account:${toAccount}`);

      financialTransactions.push({
        id: makeContentId("financial_transaction", [r.id]),
        investigationId,
        fromAccountEntityId: fromId,
        toAccountEntityId: toId,
        amount,
        currency: str(r.data, "currency") ?? "INR",
        occurredAt: valueDate,
        provenance: {
          source: r.id,
          location: r.provenance.location,
          method: "graph:financial_transaction",
          confidence: CONFIDENCE.direct,
          processingHistory: [...r.provenance.processingHistory, "graph:financial_transaction_created"],
          timestamp: synthesizedAt,
        },
      });

      if (!fromId || !toId) {
        warnings.push(`financial transaction ${r.id}: from/to account never canonicalized; no financial edge added.`);
      } else {
        addContribution("financial", fromId, toId, true, r.evidenceItemId, r.id, "graph:financial", r, {
          occurredAt: valueDate,
          amount,
          currency: str(r.data, "currency"),
        });
        const fromOwner = ownerOf.get(fromId);
        const toOwner = ownerOf.get(toId);
        if (fromOwner && toOwner && fromOwner.personId !== toOwner.personId) {
          addContribution(
            "financial",
            fromOwner.personId,
            toOwner.personId,
            true,
            r.evidenceItemId,
            r.id,
            "graph:financial_inferred",
            r,
            { occurredAt: valueDate, amount, currency: str(r.data, "currency") },
            { classification: "ai_inference", confidence: CONFIDENCE.derivedPersonEdge },
          );
        }
      }
      continue;
    }
    // crime_event and any other eventKind: out of scope for this milestone (see docs/data/graph.md limitations).
  }

  // --- finalize relationships ------------------------------------------

  const relationships: RelationshipCandidate[] = [];
  for (const acc of accByKey.values()) {
    const evidenceItemIds = [...acc.evidenceItemIds].sort();
    const extractedRecordIds = [...acc.extractedRecordIds].sort();
    const classification: EvidenceClassification =
      acc.forcedClassification ?? (evidenceItemIds.length >= 2 ? "corroborated_fact" : "observed_fact");
    const confidence = acc.forcedConfidence ?? CONFIDENCE.direct;
    const attributes: Record<string, unknown> = {};
    if (acc.attributesAcc.count > 1 || acc.relationshipType !== "ownership") attributes.eventCount = acc.attributesAcc.count;
    if (acc.attributesAcc.firstObservedAt) attributes.firstObservedAt = acc.attributesAcc.firstObservedAt;
    if (acc.attributesAcc.lastObservedAt) attributes.lastObservedAt = acc.attributesAcc.lastObservedAt;
    if (acc.attributesAcc.totalDurationSeconds !== undefined) attributes.totalDurationSeconds = acc.attributesAcc.totalDurationSeconds;
    if (acc.attributesAcc.totalAmount !== undefined) attributes.totalAmount = acc.attributesAcc.totalAmount;
    if (acc.attributesAcc.currency) attributes.currency = acc.attributesAcc.currency;

    relationships.push({
      id: makeContentId("relationship", [acc.relationshipType, acc.sourceEntityId, acc.targetEntityId]),
      investigationId,
      sourceEntityId: acc.sourceEntityId,
      targetEntityId: acc.targetEntityId,
      relationshipType: acc.relationshipType,
      directed: acc.directed,
      evidenceItemIds,
      extractedRecordIds,
      conflicts: [],
      attributes,
      classification,
      provenance: {
        source: acc.primaryRecordId,
        location: acc.primaryProvenance.location,
        method: acc.method,
        confidence,
        processingHistory: [...acc.primaryProvenance.processingHistory, "graph:edge_constructed"],
        timestamp: synthesizedAt,
      },
    });
  }

  return { locations, communicationEvents, financialTransactions, relationships, warnings };
}
