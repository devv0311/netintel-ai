import type { EvidenceItem, EvidenceItemType } from "@/lib/domain/evidence";
import { parsePublicRecord } from "@/lib/domain/public-record";
import type { ExtractedRecordType } from "@/lib/domain/extraction";
import { makeContentId } from "@/lib/domain/ids";
import type { Provenance } from "@/lib/domain/provenance";

/**
 * The extraction core: deterministic, structural field-reads from a
 * single EvidenceItem's `content`, per this milestone's brief. Every
 * function here reads only fields explicitly present in the evidence
 * item being processed — it never looks at any other evidence item,
 * never compares values across sources, and never resolves whether two
 * mentions name the same real-world entity. That is why "Rohan
 * Malhotra" (suspect:S1) and "R. Malhotra" (suspect:S1:var1) each
 * produce their own independent entity_mention here, with no link
 * between them — even though S1:var1's own `note` field literally says
 * "same individual", extraction reproduces that note as a plain
 * attribute_mention (an observed fact about what the source says) and
 * does nothing else with it. Merging identities is entity resolution's
 * job, a later milestone (docs/contracts/agent-contracts.md, Agent 2).
 */

export const EXTRACTION_METHOD_PREFIX = "extraction:field-read";

/** Thrown when an EvidenceItem's itemType has no registered extractor. */
export class UnsupportedEvidenceTypeError extends Error {
  readonly itemType: string;
  constructor(itemType: string) {
    super(`No extractor registered for evidence item type "${itemType}"`);
    this.name = "UnsupportedEvidenceTypeError";
    this.itemType = itemType;
  }
}

/** An extracted record before schema validation (stage 4 validates it). */
export interface ExtractedRecordCandidate {
  id: string;
  evidenceItemId: string;
  recordType: ExtractedRecordType;
  data: Record<string, unknown>;
  classification: "observed_fact";
  provenance: Provenance;
}

interface RawFact {
  recordType: ExtractedRecordType;
  /** Unique within one evidence item's content — the id/location key. */
  fieldPath: string;
  /** Human-facing fact category, shown in the extraction view. */
  factType: string;
  data: Record<string, unknown>;
  confidence: number;
}

function fact(
  recordType: ExtractedRecordType,
  fieldPath: string,
  factType: string,
  data: Record<string, unknown>,
  confidence = 1,
): RawFact {
  return { recordType, fieldPath, factType, data, confidence };
}

// --- content readers (never throw — a missing/mistyped field is simply
// not extracted as that fact; extraction reports what IS there) --------

type Content = Record<string, unknown>;

function str(content: Content, key: string): string | undefined {
  const v = content[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function num(content: Content, key: string): number | undefined {
  const v = content[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function strArray(content: Content, key: string): string[] {
  const v = content[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function obj(content: Content, key: string): Content | undefined {
  const v = content[key];
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Content) : undefined;
}

/**
 * A person named by a record that is *about* something else — a phone's
 * subscriber, an account's holder, a vehicle's registrant, the primary
 * name behind an alias.
 *
 * Before this existed, those fields produced only a relationship_mention
 * (`phone_subscriber`, `account_held_by`, …). The person named in them
 * therefore never became a person entity_mention, and so never became a
 * person entity at all: the three money mules M1/M2/M3 are named ONLY in
 * a phone record and a bank-account record, so the laundering chain was
 * built entirely out of account-to-account transfers with no human on
 * either end. The evaluation harness measures this as
 * `er.mentionCoverage` (docs/evaluation/evaluation-methodology.md).
 *
 * The fieldPath is suffixed `.person` because a fact's id is content-
 * addressed over (evidenceItemId, fieldPath) — reusing the bare field
 * name would collide with the relationship_mention already emitted from
 * it. The relationship_mention is deliberately kept: "this phone's
 * subscriber is X" and "X is a person named here" are two different
 * observed facts, and entity resolution consumes them differently.
 *
 * This is still a structural field-read. It asserts only that the field
 * names a person, which the source's own schema already states; it makes
 * no claim that this person is the same as any other mention of that name.
 */
function personMention(fieldPath: string, factType: string, name: string): RawFact {
  return fact("entity_mention", `${fieldPath}.person`, factType, {
    mentionKind: "person",
    observedValue: name,
  });
}

// --- per-evidence-type extractors --------------------------------------

function extractFir(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  strArray(content, "accused").forEach((name, i) => {
    facts.push(fact("entity_mention", `accused[${i}]`, "person_named", {
      mentionKind: "person",
      observedValue: name,
    }));
  });
  const firNumber = str(content, "firNumber");
  if (firNumber) {
    facts.push(fact("attribute_mention", "firNumber", "fir_number", {
      attribute: "fir_number",
      observedValue: firNumber,
    }));
  }
  const filedAt = str(content, "filedAt");
  if (filedAt) {
    facts.push(fact("attribute_mention", "filedAt", "fir_filed_at", {
      attribute: "filed_at",
      observedValue: filedAt,
    }));
  }
  const seized = obj(content, "seizedVehicle");
  if (seized) {
    const plate = str(seized, "plate");
    if (plate) {
      facts.push(fact("entity_mention", "seizedVehicle.plate", "vehicle_named", {
        mentionKind: "vehicle",
        observedValue: plate,
      }));
    }
    const colour = str(seized, "colour");
    if (colour) {
      facts.push(fact("attribute_mention", "seizedVehicle.colour", "vehicle_colour", {
        attribute: "colour",
        subject: plate ?? null,
        observedValue: colour,
      }));
    }
  }
  return facts;
}

const SUSPECT_ARRAY_RELATIONSHIPS: Record<string, string> = {
  phones: "has_phone",
  accounts: "has_account",
  vehicles: "has_vehicle",
  knownAliases: "has_alias",
};
const SUSPECT_SCALAR_RELATIONSHIPS: Record<string, string> = {
  linkedPhone: "has_phone",
};
const SUSPECT_SCALAR_ATTRIBUTES = ["role", "residence", "note"] as const;

function extractSuspectRecord(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  const name = str(content, "name");
  if (name) {
    facts.push(fact("entity_mention", "name", "person_named", {
      mentionKind: "person",
      observedValue: name,
    }));
  }
  for (const attribute of SUSPECT_SCALAR_ATTRIBUTES) {
    const value = str(content, attribute);
    if (value) {
      facts.push(fact("attribute_mention", attribute, `suspect_${attribute}`, {
        attribute,
        subject: name ?? null,
        observedValue: value,
      }));
    }
  }
  for (const [key, relationshipType] of Object.entries(SUSPECT_SCALAR_RELATIONSHIPS)) {
    const value = str(content, key);
    if (value) {
      facts.push(fact("relationship_mention", key, relationshipType, {
        relationshipType,
        subject: name ?? null,
        observedValue: value,
      }));
    }
  }
  for (const [key, relationshipType] of Object.entries(SUSPECT_ARRAY_RELATIONSHIPS)) {
    strArray(content, key).forEach((value, i) => {
      facts.push(fact("relationship_mention", `${key}[${i}]`, relationshipType, {
        relationshipType,
        subject: name ?? null,
        observedValue: value,
      }));
    });
  }
  return facts;
}

function extractAliasRecord(content: Content): RawFact[] {
  const alias = str(content, "alias");
  const primaryName = str(content, "primaryName");
  if (!alias || !primaryName) return [];
  return [
    fact("relationship_mention", "alias", "alias_of", {
      relationshipType: "alias_of",
      subject: primaryName,
      observedValue: alias,
    }),
    personMention("primaryName", "person_named_as_alias_subject", primaryName),
  ];
}

function extractPhoneRecord(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  const number = str(content, "number");
  if (number) {
    facts.push(fact("entity_mention", "number", "phone_named", {
      mentionKind: "phone",
      observedValue: number,
    }));
  }
  const imei = str(content, "imei");
  if (number && imei) {
    facts.push(fact("relationship_mention", "imei", "phone_bound_to_imei", {
      relationshipType: "phone_bound_to_imei",
      subject: number,
      observedValue: imei,
    }));
  }
  const subscriberName = str(content, "subscriberName");
  if (number && subscriberName) {
    facts.push(fact("relationship_mention", "subscriberName", "phone_subscriber", {
      relationshipType: "phone_subscriber",
      subject: number,
      observedValue: subscriberName,
    }));
    facts.push(personMention("subscriberName", "person_named_as_subscriber", subscriberName));
  }
  return facts;
}

function extractImeiRecord(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  const imei = str(content, "imei");
  if (imei) {
    facts.push(fact("entity_mention", "imei", "imei_named", {
      mentionKind: "imei",
      observedValue: imei,
    }));
  }
  const boundNumber = str(content, "boundNumber");
  if (imei && boundNumber) {
    facts.push(fact("relationship_mention", "boundNumber", "imei_bound_to_phone", {
      relationshipType: "imei_bound_to_phone",
      subject: imei,
      observedValue: boundNumber,
    }));
  }
  return facts;
}

function extractVehicleRecord(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  const plate = str(content, "plate");
  if (plate) {
    facts.push(fact("entity_mention", "plate", "vehicle_named", {
      mentionKind: "vehicle",
      observedValue: plate,
    }));
  }
  const colour = str(content, "colour");
  if (colour) {
    facts.push(fact("attribute_mention", "colour", "vehicle_colour", {
      attribute: "colour",
      subject: plate ?? null,
      observedValue: colour,
    }));
  }
  const registeredTo = str(content, "registeredTo");
  if (plate && registeredTo) {
    facts.push(fact("relationship_mention", "registeredTo", "vehicle_registered_to", {
      relationshipType: "vehicle_registered_to",
      subject: plate,
      observedValue: registeredTo,
    }));
    facts.push(personMention("registeredTo", "person_named_as_registrant", registeredTo));
  }
  return facts;
}

function extractBankAccountRecord(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  const account = str(content, "account");
  if (account) {
    facts.push(fact("entity_mention", "account", "bank_account_named", {
      mentionKind: "bank_account",
      observedValue: account,
    }));
  }
  const accountKind = str(content, "accountKind");
  if (accountKind) {
    facts.push(fact("attribute_mention", "accountKind", "account_kind", {
      attribute: "account_kind",
      subject: account ?? null,
      observedValue: accountKind,
    }));
  }
  const holderName = str(content, "holderName");
  if (account && holderName) {
    facts.push(fact("relationship_mention", "holderName", "account_held_by", {
      relationshipType: "account_held_by",
      subject: account,
      observedValue: holderName,
    }));
    facts.push(personMention("holderName", "person_named_as_account_holder", holderName));
  }
  return facts;
}

function extractLocationRecord(content: Content): RawFact[] {
  const label = str(content, "label");
  if (!label) return [];
  return [
    fact("entity_mention", "label", "location_named", {
      mentionKind: "location",
      observedValue: label,
      locationType: str(content, "locationType") ?? null,
      latitude: num(content, "latitude") ?? null,
      longitude: num(content, "longitude") ?? null,
    }),
  ];
}

function extractCdrEvent(content: Content): RawFact[] {
  const callerNumber = str(content, "callerNumber");
  const calleeNumber = str(content, "calleeNumber");
  const startedAt = str(content, "startedAt");
  if (!callerNumber || !calleeNumber || !startedAt) return [];
  return [
    fact("event_mention", "event", "communication_event", {
      eventKind: "communication",
      callerNumber,
      calleeNumber,
      startedAt,
      durationSeconds: num(content, "durationSeconds") ?? null,
      cellTower: str(content, "cellTower") ?? null,
      observedValue: `${callerNumber} → ${calleeNumber} @ ${startedAt}`,
    }),
  ];
}

function extractFinancialTransactionRecord(content: Content): RawFact[] {
  const txnRef = str(content, "txnRef");
  const fromAccount = str(content, "fromAccount");
  const toAccount = str(content, "toAccount");
  const amount = num(content, "amount");
  const valueDate = str(content, "valueDate");
  if (!txnRef || !fromAccount || !toAccount || amount === undefined || !valueDate) return [];
  return [
    fact("event_mention", "event", "financial_transaction_event", {
      eventKind: "financial_transaction",
      txnRef,
      fromAccount,
      toAccount,
      amount,
      currency: str(content, "currency") ?? null,
      valueDate,
      observedValue: `${fromAccount} → ${toAccount}: ${amount}`,
    }),
  ];
}

function extractWitnessStatement(content: Content): RawFact[] {
  const facts: RawFact[] = [];
  const text = str(content, "text");
  if (text) {
    facts.push(fact("attribute_mention", "text", "witness_statement_text", {
      attribute: "statement_text",
      statementId: str(content, "statementId") ?? null,
      observedValue: text,
    }));
  }
  strArray(content, "aboutNames").forEach((name, i) => {
    facts.push(fact("entity_mention", `aboutNames[${i}]`, "person_named", {
      mentionKind: "person",
      observedValue: name,
    }));
  });
  return facts;
}

function extractCrimeEvent(content: Content): RawFact[] {
  const eventId = str(content, "eventId");
  const occurredAt = str(content, "occurredAt");
  if (!eventId || !occurredAt) return [];
  return [
    fact("event_mention", "event", "crime_event", {
      eventKind: "crime_event",
      eventId,
      occurredAt,
      firNumber: str(content, "firNumber") ?? null,
      nearestTower: str(content, "nearestTower") ?? null,
      sceneLabel: str(content, "sceneLabel") ?? null,
      observedValue: eventId,
    }),
  ];
}

/**
 * Public register records — the one evidence type whose content shape is
 * schema-enforced rather than read field by field on trust.
 *
 * `parsePublicRecord` throws if the mandatory source/licence/retrieval
 * metadata is missing or malformed, so a record that cannot state where
 * it came from and under what terms produces NO facts at all rather than
 * partial ones. Extraction is the last gate before a fact becomes a row,
 * and an unlicensed row is worse than a missing one.
 *
 * Everything emitted here is still a structural field-read of what the
 * publisher stated. No name is normalised beyond what the publisher
 * wrote, no identifier is inferred, and no cross-record link is made:
 * `relations[]` records the publisher's own id for the other end, never
 * a NetIntel entity id. Deciding whether two records denote the same
 * subject is entity resolution's job, and leaving that decision entirely
 * to the existing resolver is the whole point of the public-data pilot.
 */
function extractPublicRecord(content: Content): RawFact[] {
  const record = parsePublicRecord(content);
  const facts: RawFact[] = [];

  facts.push(
    fact("entity_mention", "name", `${record.subjectKind}_named`, {
      mentionKind: record.subjectKind,
      observedValue: record.name,
      registry: record.registry,
    }),
  );

  record.identifiers?.forEach((identifier, i) => {
    facts.push(
      fact("relationship_mention", `identifiers[${i}]`, "subject_has_identifier", {
        relationshipType: "has_identifier",
        subject: record.name,
        // Scheme-qualified so an LEI and a QID with the same characters
        // can never be treated as the same identifier by the resolver.
        observedValue: `${identifier.scheme}:${identifier.value}`,
        scheme: identifier.scheme,
      }),
    );
  });

  record.aliases?.forEach((alias, i) => {
    facts.push(
      fact("relationship_mention", `aliases[${i}]`, "alias_of", {
        relationshipType: "alias_of",
        subject: record.name,
        observedValue: alias,
      }),
    );
  });

  record.relations?.forEach((relation, i) => {
    facts.push(
      fact("relationship_mention", `relations[${i}]`, "registry_relation", {
        relationshipType: relation.predicate,
        subject: record.registryRecordId,
        observedValue: relation.targetRegistryRecordId,
      }),
    );
  });

  // Licensing and retrieval are persisted as first-class attribute rows,
  // each with its own provenance, so a downstream export can filter by
  // licence without re-reading the source file.
  const attributes: [string, string, string | undefined][] = [
    ["registry", "public_record_registry", record.registry],
    ["registryRecordId", "public_record_registry_id", record.registryRecordId],
    ["license", "public_record_license", record.license],
    ["licenseUrl", "public_record_license_url", record.licenseUrl],
    ["sourceUrl", "public_record_source_url", record.sourceUrl],
    ["retrievedAt", "public_record_retrieved_at", record.retrievedAt],
    ["observedAt", "public_record_observed_at", record.observedAt],
    ["jurisdiction", "public_record_jurisdiction", record.jurisdiction],
    ["status", "public_record_status", record.status],
  ];
  for (const [field, factType, value] of attributes) {
    if (!value) continue;
    facts.push(
      fact("attribute_mention", field, factType, {
        attribute: factType,
        subject: record.name,
        observedValue: value,
      }),
    );
  }

  return facts;
}

const EXTRACTORS: Record<EvidenceItemType, (content: Content) => RawFact[]> = {
  fir: extractFir,
  suspect_record: extractSuspectRecord,
  alias_record: extractAliasRecord,
  phone_record: extractPhoneRecord,
  imei_record: extractImeiRecord,
  vehicle_record: extractVehicleRecord,
  bank_account_record: extractBankAccountRecord,
  location_record: extractLocationRecord,
  cdr_event: extractCdrEvent,
  financial_transaction_record: extractFinancialTransactionRecord,
  witness_statement: extractWitnessStatement,
  crime_event: extractCrimeEvent,
  public_record: extractPublicRecord,
};

/** Pure fact derivation for one evidence item's content. */
export function extractRawFacts(itemType: EvidenceItemType, content: Content): RawFact[] {
  const extractor = EXTRACTORS[itemType];
  if (!extractor) throw new UnsupportedEvidenceTypeError(itemType);
  return extractor(content);
}

/**
 * Builds unvalidated ExtractedRecord candidates for one evidence item —
 * every field-level fact this item explicitly states, each with a
 * deterministic content-addressed id (so re-running extraction on
 * unchanged evidence yields byte-identical ids) and full provenance
 * tracing back to this exact item and field.
 */
export function buildCandidatesForItem(
  item: EvidenceItem,
  extractedAt: string,
): ExtractedRecordCandidate[] {
  const recordRef = str(item.content, "recordRef") ?? item.id;
  const rawFacts = extractRawFacts(item.itemType, item.content);

  return rawFacts.map((raw) => {
    const id = makeContentId("extracted_record", [item.id, raw.fieldPath]);
    const provenance: Provenance = {
      source: item.id,
      location: `${recordRef}#${raw.fieldPath}`,
      method: `${EXTRACTION_METHOD_PREFIX}:${item.itemType}`,
      confidence: raw.confidence,
      processingHistory: [`evidence_item:${item.id}`, `extraction:${raw.factType}`],
      timestamp: extractedAt,
    };
    return {
      id,
      evidenceItemId: item.id,
      recordType: raw.recordType,
      data: { factType: raw.factType, recordRef, ...raw.data },
      classification: "observed_fact",
      provenance,
    };
  });
}
