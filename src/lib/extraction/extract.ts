import type { EvidenceItem, EvidenceItemType } from "@/lib/domain/evidence";
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
