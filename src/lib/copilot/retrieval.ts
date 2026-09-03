import type { Alias, Entity } from "@/lib/domain/entity";
import type { CommunicationEvent, FinancialTransaction } from "@/lib/domain/events";
import type { CorroborationFinding } from "@/lib/domain/corroboration";
import type { AnalyticalSignal } from "@/lib/domain/derived";
import type { EvidenceItem } from "@/lib/domain/evidence";
import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { Location } from "@/lib/domain/location";
import type { EvidenceClassification } from "@/lib/domain/provenance";
import type { Relationship } from "@/lib/domain/relationship";
import type { ResolutionDecision } from "@/lib/domain/resolution";

import { CLASSIFICATION_STRENGTH, type CopilotClaim, type CopilotConflict, type RelatedViews } from "./contract";
import type { QuestionGrounding } from "./types";

/**
 * Deterministic structured retrieval and grounded-claim construction —
 * the Copilot's source of truth.
 *
 * Everything an answer can possibly assert is built HERE, in ordinary
 * TypeScript, out of records that are already persisted: evidence
 * items, extracted records, resolved entities and aliases, graph edges,
 * analytical signals and corroboration findings. A language model never
 * contributes a fact, an identifier, a classification, or a confidence
 * — it only re-words the claim set this module produces (see
 * ./synthesize.ts), and its wording is discarded if it strays (see
 * ./verify.ts).
 *
 * Three rules hold throughout:
 *
 *   1. A claim's evidence classification is CARRIED OVER from the
 *      record it cites (a relationship's own `classification`, a
 *      corroboration finding's own `classification`, `algorithmic_signal`
 *      for an analytics signal, `observed_fact` for a directly-stated
 *      evidence/extracted record). It is never chosen to make an answer
 *      read better.
 *   2. A statement ABOUT THE GRAPH is phrased about the graph. "No
 *      direct edge exists between A and B at graph version V" is an
 *      algorithmic signal; "A and B are unconnected" would be a claim
 *      about the world and is never made.
 *   3. Co-location, timing, and traversal never become contact or
 *      causation. Corroboration findings are reported with the wording
 *      P5.7 already gave them.
 */

// --- inputs ------------------------------------------------------------

export interface CorpusSnapshot {
  investigationId: string;
  investigationName: string;
  graphVersion: string;
  evidenceItems: EvidenceItem[];
  extractedRecords: ExtractedRecord[];
  entities: Entity[];
  aliases: Alias[];
  locations: Location[];
  relationships: Relationship[];
  communicationEvents: CommunicationEvent[];
  financialTransactions: FinancialTransaction[];
  analyticalSignals: AnalyticalSignal[];
  corroborationFindings: CorroborationFinding[];
  resolutionDecisions: ResolutionDecision[];
}

// --- the handle-addressed evidence pack ---------------------------------

export const PACK_KINDS = [
  "evidence_item",
  "extracted_record",
  "entity",
  "relationship",
  "analytical_signal",
  "corroboration_finding",
] as const;
export type PackKind = (typeof PACK_KINDS)[number];

const HANDLE_PREFIX: Record<PackKind, string> = {
  evidence_item: "EV",
  extracted_record: "XR",
  entity: "EN",
  relationship: "RE",
  analytical_signal: "AS",
  corroboration_finding: "CF",
};

export interface PackEntry {
  handle: string;
  kind: PackKind;
  /** The persisted record id — minted by the pipeline, never by a model. */
  id: string;
  label: string;
  /** A one-line rendering of the record's substance, as shown to the model. */
  detail: string;
  classification: EvidenceClassification;
  confidence: number;
}

export interface EvidencePack {
  entries: PackEntry[];
  byHandle: Map<string, PackEntry>;
  byId: Map<string, PackEntry>;
}

interface PackBuilder {
  add(entry: Omit<PackEntry, "handle">): PackEntry;
  build(): EvidencePack;
}

function createPackBuilder(): PackBuilder {
  const entries: PackEntry[] = [];
  const byId = new Map<string, PackEntry>();
  const counters: Record<PackKind, number> = {
    evidence_item: 0,
    extracted_record: 0,
    entity: 0,
    relationship: 0,
    analytical_signal: 0,
    corroboration_finding: 0,
  };
  return {
    add(entry) {
      const existing = byId.get(entry.id);
      if (existing) return existing;
      counters[entry.kind] += 1;
      const withHandle: PackEntry = { ...entry, handle: `${HANDLE_PREFIX[entry.kind]}${counters[entry.kind]}` };
      entries.push(withHandle);
      byId.set(withHandle.id, withHandle);
      return withHandle;
    },
    build() {
      return { entries, byHandle: new Map(entries.map((e) => [e.handle, e])), byId };
    },
  };
}

// --- output -------------------------------------------------------------

export interface RetrievalOutput {
  pack: EvidencePack;
  claims: CopilotClaim[];
  conflicts: CopilotConflict[];
  caveats: string[];
  relatedViews: RelatedViews;
  warnings: string[];
}

/**
 * Absence of a graph edge is a statement about the synthesized graph,
 * not about the world; the confidence reflects the graph's own
 * completeness, and the wording never claims real-world absence.
 */
const ABSENCE_CONFIDENCE = 0.7;
/** Traversal over >1 hop is an algorithmic derivation, never an observation. */
const TRAVERSAL_CONFIDENCE = 0.8;
/** A pair of witness statements flagged for review is a lead, never a finding. */
const STATEMENT_CONFLICT_CONFIDENCE = 0.5;

const MAX_CLAIMS = 28;
const MAX_ITEMS_PER_GROUP = 6;

/** Explicit exclusion/denial markers used to flag incompatible witness accounts. */
const DENIAL_MARKERS = [
  "could not have been",
  "was not",
  "were not",
  "did not",
  "denies",
  "denied",
  "no involvement",
  "not present",
  "unrelated",
  "a different individual",
  "independently",
];

// --- small helpers ------------------------------------------------------

function weaker(a: EvidenceClassification, b: EvidenceClassification): EvidenceClassification {
  return CLASSIFICATION_STRENGTH[a] <= CLASSIFICATION_STRENGTH[b] ? a : b;
}

function emptyCitations(): CopilotClaim["citations"] {
  return {
    evidenceItemIds: [],
    extractedRecordIds: [],
    entityIds: [],
    relationshipIds: [],
    analyticalSignalIds: [],
    corroborationFindingIds: [],
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function truncate(value: string, max = 220): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function contentString(content: Record<string, unknown>, key: string): string | null {
  const value = content[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function contentStringArray(content: Record<string, unknown>, key: string): string[] {
  const value = content[key];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// --- indexes ------------------------------------------------------------

interface SnapshotIndex {
  entityById: Map<string, Entity>;
  locationById: Map<string, Location>;
  aliasesByEntity: Map<string, Alias[]>;
  evidenceById: Map<string, EvidenceItem>;
  recordById: Map<string, ExtractedRecord>;
  recordsByEvidence: Map<string, ExtractedRecord[]>;
  relationshipById: Map<string, Relationship>;
  relationshipsByEntity: Map<string, Relationship[]>;
  signalsByEntity: Map<string, AnalyticalSignal[]>;
  findingsByEntity: Map<string, CorroborationFinding[]>;
  /** Resolved entity id → the evidence items whose extracted records resolved into it. */
  evidenceIdsByEntity: Map<string, string[]>;
  recordIdsByEntity: Map<string, string[]>;
  personEntities: Entity[];
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) existing.push(value);
  else map.set(key, [value]);
}

export function indexSnapshot(snapshot: CorpusSnapshot): SnapshotIndex {
  const entityById = new Map(snapshot.entities.map((e) => [e.id, e]));
  const recordById = new Map(snapshot.extractedRecords.map((r) => [r.id, r]));

  const aliasesByEntity = new Map<string, Alias[]>();
  for (const a of snapshot.aliases) pushInto(aliasesByEntity, a.entityId, a);

  const recordsByEvidence = new Map<string, ExtractedRecord[]>();
  for (const r of snapshot.extractedRecords) pushInto(recordsByEvidence, r.evidenceItemId, r);

  const relationshipsByEntity = new Map<string, Relationship[]>();
  for (const r of snapshot.relationships) {
    pushInto(relationshipsByEntity, r.sourceEntityId, r);
    if (r.targetEntityId !== r.sourceEntityId) pushInto(relationshipsByEntity, r.targetEntityId, r);
  }

  const signalsByEntity = new Map<string, AnalyticalSignal[]>();
  for (const s of snapshot.analyticalSignals) {
    if (s.targetEntityId) pushInto(signalsByEntity, s.targetEntityId, s);
  }

  const findingsByEntity = new Map<string, CorroborationFinding[]>();
  for (const f of snapshot.corroborationFindings) {
    for (const id of f.entityIds) pushInto(findingsByEntity, id, f);
  }

  const evidenceIdsByEntity = new Map<string, string[]>();
  const recordIdsByEntity = new Map<string, string[]>();
  for (const d of snapshot.resolutionDecisions) {
    for (const recordId of d.extractedRecordIds) {
      pushInto(recordIdsByEntity, d.canonicalEntityId, recordId);
      const record = recordById.get(recordId);
      if (record) pushInto(evidenceIdsByEntity, d.canonicalEntityId, record.evidenceItemId);
    }
  }

  return {
    entityById,
    locationById: new Map(snapshot.locations.map((l) => [l.id, l])),
    aliasesByEntity,
    evidenceById: new Map(snapshot.evidenceItems.map((i) => [i.id, i])),
    recordById,
    recordsByEvidence,
    relationshipById: new Map(snapshot.relationships.map((r) => [r.id, r])),
    relationshipsByEntity,
    signalsByEntity,
    findingsByEntity,
    evidenceIdsByEntity: new Map([...evidenceIdsByEntity].map(([k, v]) => [k, uniqueSorted(v)])),
    recordIdsByEntity: new Map([...recordIdsByEntity].map(([k, v]) => [k, uniqueSorted(v)])),
    personEntities: snapshot.entities.filter((e) => e.kind === "person").sort((a, b) => (a.id < b.id ? -1 : 1)),
  };
}

// --- graph traversal ----------------------------------------------------

export interface GraphPath {
  nodeIds: string[];
  relationshipIds: string[];
}

/**
 * Deterministic breadth-first search over the persisted relationships.
 * Neighbours are visited in sorted relationship-id order so the same
 * graph always yields the same path. Never invents an edge.
 */
export function findPath(
  relationships: readonly Relationship[],
  fromId: string,
  toId: string,
  allowedTypes?: ReadonlySet<string>,
): GraphPath | null {
  if (fromId === toId) return { nodeIds: [fromId], relationshipIds: [] };
  const adjacency = new Map<string, { via: Relationship; to: string }[]>();
  const usable = relationships
    .filter((r) => !allowedTypes || allowedTypes.has(r.relationshipType))
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const r of usable) {
    pushInto(adjacency, r.sourceEntityId, { via: r, to: r.targetEntityId });
    pushInto(adjacency, r.targetEntityId, { via: r, to: r.sourceEntityId });
  }

  const previous = new Map<string, { node: string; via: Relationship }>();
  const seen = new Set([fromId]);
  let frontier = [fromId];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const edge of adjacency.get(node) ?? []) {
        if (seen.has(edge.to)) continue;
        seen.add(edge.to);
        previous.set(edge.to, { node, via: edge.via });
        if (edge.to === toId) {
          const nodeIds = [toId];
          const relationshipIds: string[] = [];
          let cursor = toId;
          while (cursor !== fromId) {
            const step = previous.get(cursor);
            if (!step) break;
            relationshipIds.unshift(step.via.id);
            nodeIds.unshift(step.node);
            cursor = step.node;
          }
          return { nodeIds, relationshipIds };
        }
        next.push(edge.to);
      }
    }
    frontier = next;
  }
  return null;
}

// --- pack population ----------------------------------------------------

function labelForEntity(entity: Entity): string {
  return `${entity.canonicalLabel} (${entity.kind.replace(/_/g, " ")})`;
}

function describeEvidenceItem(item: EvidenceItem): string {
  const c = item.content;
  const ref = contentString(c, "recordRef") ?? item.id;
  switch (item.itemType) {
    case "fir":
      return `FIR ${contentString(c, "firNumber") ?? ref} filed ${contentString(c, "filedAt") ?? "—"}: ${contentString(c, "summary") ?? ""} Accused named: ${contentStringArray(c, "accused").join(", ") || "none"}.`;
    case "witness_statement":
      return `Witness statement ${contentString(c, "statementId") ?? ref} about ${contentStringArray(c, "aboutNames").join(", ") || "—"}: ${contentString(c, "text") ?? ""}`;
    case "crime_event":
      return `Crime event ${contentString(c, "eventId") ?? ref} at ${contentString(c, "occurredAt") ?? "—"}, scene ${contentString(c, "sceneLabel") ?? "—"}, nearest tower ${contentString(c, "nearestTower") ?? "—"}: ${contentString(c, "summary") ?? ""}`;
    case "suspect_record":
      return `Suspect record ${ref}: ${contentString(c, "name") ?? "—"}, role ${contentString(c, "role") ?? "—"}, aliases ${contentStringArray(c, "knownAliases").join(", ") || "none"}, phones ${contentStringArray(c, "phones").join(", ") || "none"}, accounts ${contentStringArray(c, "accounts").join(", ") || "none"}.`;
    case "alias_record":
      return `Alias record ${ref}: “${contentString(c, "alias") ?? "—"}” recorded as an alias of ${contentString(c, "primaryName") ?? "—"}.`;
    default:
      return `${item.itemType} ${ref}: ${truncate(JSON.stringify(c), 200)}`;
  }
}

function describeRelationship(r: Relationship, index: SnapshotIndex): string {
  const source = index.entityById.get(r.sourceEntityId)?.canonicalLabel ?? index.locationById.get(r.sourceEntityId)?.label ?? r.sourceEntityId;
  const target = index.entityById.get(r.targetEntityId)?.canonicalLabel ?? index.locationById.get(r.targetEntityId)?.label ?? r.targetEntityId;
  const arrow = r.directed ? "→" : "↔";
  const attrs = Object.entries(r.attributes)
    .filter(([, v]) => v !== null && v !== undefined && typeof v !== "object")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
  return `${source} ${arrow} ${target} · ${r.relationshipType}${attrs ? ` · ${attrs}` : ""} · classified ${r.classification} · ${r.evidenceItemIds.length} supporting evidence item(s)`;
}

function describeSignal(s: AnalyticalSignal, index: SnapshotIndex): string {
  const target = s.targetEntityId
    ? (index.entityById.get(s.targetEntityId)?.canonicalLabel ?? index.locationById.get(s.targetEntityId)?.label ?? s.targetEntityId)
    : "the whole graph";
  const value = Object.entries(s.value)
    .filter(([, v]) => typeof v === "number" || typeof v === "string")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(", ");
  return `${s.signalType} signal on ${target} (${s.method})${value ? ` · ${value}` : ""} — ${s.explanation}`;
}

function describeFinding(f: CorroborationFinding, index: SnapshotIndex): string {
  const entities = f.entityIds.map((id) => index.entityById.get(id)?.canonicalLabel ?? id).join(" ↔ ");
  const locations = f.locationIds.map((id) => index.locationById.get(id)?.label ?? id).join(" ~ ");
  const window = f.window ? `${f.window.start}${f.window.end ? ` → ${f.window.end}` : ""}` : "no window";
  return `${f.findingType} (${f.classification}) ${entities || "—"}${locations ? ` at ${locations}` : ""} · ${window} · ${f.method} — ${f.explanation}`;
}

/** " at <site> (window)" — what distinguishes one finding about a pair from the next. */
function describePlaceAndWindow(f: CorroborationFinding, ctx: ClaimContext): string {
  const places = f.locationIds.map((id) => ctx.index.locationById.get(id)?.label ?? id);
  const where = places.length > 0 ? ` at ${places.join(" and ")}` : "";
  const when = f.window ? ` (${f.window.start}${f.window.end ? ` → ${f.window.end}` : ""})` : "";
  return `${where}${when}`;
}

function describeRecord(r: ExtractedRecord): string {
  const data = r.data;
  const parts = ["factType", "subject", "attribute", "observedValue", "recordRef"]
    .map((k) => (typeof data[k] === "string" || typeof data[k] === "number" ? `${k}=${String(data[k])}` : null))
    .filter((p): p is string => p !== null);
  return `${r.recordType} at ${r.provenance.location} · ${parts.join(", ")}`;
}

// --- claim assembly -----------------------------------------------------

interface ClaimContext {
  snapshot: CorpusSnapshot;
  index: SnapshotIndex;
  pack: PackBuilder;
  claims: CopilotClaim[];
  conflicts: CopilotConflict[];
  caveats: string[];
  warnings: string[];
  related: { entityIds: Set<string>; relationshipIds: Set<string>; signalIds: Set<string>; findingIds: Set<string> };
}

function addEvidence(ctx: ClaimContext, id: string): string[] {
  const item = ctx.index.evidenceById.get(id);
  if (!item) return [];
  ctx.pack.add({
    kind: "evidence_item",
    id: item.id,
    label: `${item.itemType} ${contentString(item.content, "recordRef") ?? item.id}`,
    detail: describeEvidenceItem(item),
    classification: "observed_fact",
    confidence: item.confidence,
  });
  return [item.id];
}

function addEntity(ctx: ClaimContext, id: string): string[] {
  const entity = ctx.index.entityById.get(id);
  if (!entity) return [];
  const aliases = (ctx.index.aliasesByEntity.get(id) ?? []).map((a) => a.aliasValue).sort();
  ctx.pack.add({
    kind: "entity",
    id: entity.id,
    label: labelForEntity(entity),
    detail: `${labelForEntity(entity)}${aliases.length > 0 ? ` · aliases: ${aliases.join(", ")}` : ""} · resolved entity (identity resolution output)`,
    // A resolved entity is entity-resolution output — AI inference by the
    // project's own definition (src/lib/domain/resolution.ts), however
    // deterministic the clustering rule was.
    classification: "ai_inference",
    confidence: entity.provenance.confidence,
  });
  ctx.related.entityIds.add(entity.id);
  return [entity.id];
}

function addRelationship(ctx: ClaimContext, id: string): string[] {
  const r = ctx.index.relationshipById.get(id);
  if (!r) return [];
  ctx.pack.add({
    kind: "relationship",
    id: r.id,
    label: `${r.relationshipType} edge`,
    detail: describeRelationship(r, ctx.index),
    classification: r.classification,
    confidence: r.provenance.confidence,
  });
  ctx.related.relationshipIds.add(r.id);
  return [r.id];
}

function addSignal(ctx: ClaimContext, s: AnalyticalSignal): string[] {
  ctx.pack.add({
    kind: "analytical_signal",
    id: s.id,
    label: `${s.signalType} signal`,
    detail: describeSignal(s, ctx.index),
    classification: "algorithmic_signal",
    confidence: s.provenance.confidence,
  });
  ctx.related.signalIds.add(s.id);
  return [s.id];
}

function addFinding(ctx: ClaimContext, f: CorroborationFinding): string[] {
  ctx.pack.add({
    kind: "corroboration_finding",
    id: f.id,
    label: `${f.findingType}`,
    detail: describeFinding(f, ctx.index),
    classification: f.classification,
    confidence: f.provenance.confidence,
  });
  ctx.related.findingIds.add(f.id);
  return [f.id];
}

function addRecord(ctx: ClaimContext, id: string): string[] {
  const r = ctx.index.recordById.get(id);
  if (!r) return [];
  ctx.pack.add({
    kind: "extracted_record",
    id: r.id,
    label: `${r.recordType}`,
    detail: describeRecord(r),
    classification: r.classification,
    confidence: r.provenance.confidence,
  });
  return [r.id];
}

interface ClaimInput {
  statement: string;
  classification: EvidenceClassification;
  confidence: number;
  derivation: "retrieved" | "derived";
  explanation: string;
  citations: Partial<CopilotClaim["citations"]>;
}

function pushClaim(ctx: ClaimContext, input: ClaimInput): CopilotClaim | null {
  if (ctx.claims.length >= MAX_CLAIMS) return null;
  const citations = { ...emptyCitations(), ...input.citations };
  const total =
    citations.evidenceItemIds.length +
    citations.extractedRecordIds.length +
    citations.entityIds.length +
    citations.relationshipIds.length +
    citations.analyticalSignalIds.length +
    citations.corroborationFindingIds.length;
  if (total === 0) {
    ctx.warnings.push(`Dropped an uncited claim: “${truncate(input.statement, 80)}”`);
    return null;
  }
  const claim: CopilotClaim = {
    id: `C${ctx.claims.length + 1}`,
    statement: input.statement,
    classification: input.classification,
    confidence: Math.max(0, Math.min(1, input.confidence)),
    derivation: input.derivation,
    explanation: input.explanation,
    citations: {
      evidenceItemIds: uniqueSorted(citations.evidenceItemIds),
      extractedRecordIds: uniqueSorted(citations.extractedRecordIds),
      entityIds: uniqueSorted(citations.entityIds),
      relationshipIds: uniqueSorted(citations.relationshipIds),
      analyticalSignalIds: uniqueSorted(citations.analyticalSignalIds),
      corroborationFindingIds: uniqueSorted(citations.corroborationFindingIds),
    },
  };
  ctx.claims.push(claim);
  return claim;
}

// --- per-intent retrieval ------------------------------------------------

function suspectRecordsFor(ctx: ClaimContext, entity: Entity): EvidenceItem[] {
  const label = entity.canonicalLabel.toLowerCase();
  return ctx.snapshot.evidenceItems
    .filter(
      (i) =>
        (i.itemType === "suspect_record" && (contentString(i.content, "name") ?? "").toLowerCase() === label) ||
        (i.itemType === "fir" && contentStringArray(i.content, "accused").some((n) => n.toLowerCase() === label)),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function aliasRecordsFor(ctx: ClaimContext, entity: Entity): EvidenceItem[] {
  const label = entity.canonicalLabel.toLowerCase();
  return ctx.snapshot.evidenceItems
    .filter((i) => i.itemType === "alias_record" && (contentString(i.content, "primaryName") ?? "").toLowerCase() === label)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

function retrieveSuspectsOverview(ctx: ClaimContext): void {
  const named = ctx.index.personEntities
    .map((entity) => ({ entity, sources: suspectRecordsFor(ctx, entity) }))
    .filter((x) => x.sources.length > 0)
    .sort((a, b) => (a.entity.canonicalLabel < b.entity.canonicalLabel ? -1 : 1));

  if (named.length === 0) {
    ctx.warnings.push("No evidence item names any person as a suspect or an accused.");
    return;
  }

  // Headline first: the claim that actually answers the question, cited
  // to every record it rolls up. Everything below elaborates it.
  pushClaim(ctx, {
    statement: `The case evidence names ${named.length} people as suspects or accused: ${named.map((n) => n.entity.canonicalLabel).join(", ")}.`,
    classification: "observed_fact",
    confidence: Math.min(...named.flatMap((n) => n.sources.map((s) => s.confidence))),
    derivation: "derived",
    explanation:
      "Every person below is named as a suspect in a suspect record or as an accused in a FIR; the list is the union of those directly-stated names, with no one added by inference.",
    citations: { evidenceItemIds: named.flatMap((n) => n.sources.slice(0, 1).flatMap((src) => addEvidence(ctx, src.id))) },
  });

  for (const { entity, sources } of named) {
    const aliasItems = aliasRecordsFor(ctx, entity);
    const aliases = uniqueSorted((ctx.index.aliasesByEntity.get(entity.id) ?? []).map((a) => a.aliasValue));
    const evidenceIds = sources.flatMap((s) => addEvidence(ctx, s.id));
    const aliasEvidenceIds = aliasItems.slice(0, MAX_ITEMS_PER_GROUP).flatMap((s) => addEvidence(ctx, s.id));
    const entityIds = addEntity(ctx, entity.id);
    const role = sources
      .map((s) => contentString(s.content, "role"))
      .find((r): r is string => typeof r === "string" && r.length > 0);

    pushClaim(ctx, {
      statement: `The case evidence names ${entity.canonicalLabel} as a suspect${role ? ` in the role “${role}”` : ""}.`,
      classification: "observed_fact",
      confidence: Math.min(...sources.map((s) => s.confidence)),
      derivation: "retrieved",
      explanation: `Stated directly in ${sources.length} evidence item(s) (${sources.map((s) => s.itemType).join(", ")}); read verbatim, with no inference applied.`,
      citations: { evidenceItemIds: evidenceIds },
    });

    if (aliases.length > 0) {
      pushClaim(ctx, {
        statement: `${entity.canonicalLabel} is recorded under the alias(es) ${aliases.join(", ")}.`,
        classification: aliasEvidenceIds.length > 0 ? "observed_fact" : "ai_inference",
        confidence: entity.provenance.confidence,
        derivation: "retrieved",
        explanation:
          aliasEvidenceIds.length > 0
            ? `Each alias is stated directly in an alias record; identity resolution attached them to one resolved entity.`
            : `Attached by identity resolution rather than stated directly in a single evidence item.`,
        citations: { evidenceItemIds: aliasEvidenceIds, entityIds },
      });
    }
  }
}

function retrieveEntityProfile(ctx: ClaimContext, entityId: string): void {
  const entity = ctx.index.entityById.get(entityId);
  if (!entity) return;
  const entityIds = addEntity(ctx, entity.id);
  const aliases = uniqueSorted((ctx.index.aliasesByEntity.get(entity.id) ?? []).map((a) => a.aliasValue));
  const sourceEvidenceIds = (ctx.index.evidenceIdsByEntity.get(entity.id) ?? []).slice(0, MAX_ITEMS_PER_GROUP);
  const evidenceIds = sourceEvidenceIds.flatMap((id) => addEvidence(ctx, id));

  pushClaim(ctx, {
    statement: `${entity.canonicalLabel} is a resolved ${entity.kind.replace(/_/g, " ")} entity in this case${aliases.length > 0 ? `, recorded under the alias(es) ${aliases.join(", ")}` : ""}.`,
    classification: "ai_inference",
    confidence: entity.provenance.confidence,
    derivation: "retrieved",
    explanation: `Identity resolution merged ${(ctx.index.recordIdsByEntity.get(entity.id) ?? []).length} extracted mention(s) into this entity; a merge is an inference, not a directly observed fact.`,
    citations: { entityIds, evidenceItemIds: evidenceIds },
  });

  const edges = (ctx.index.relationshipsByEntity.get(entity.id) ?? [])
    .slice()
    .sort((a, b) => CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification] || (a.id < b.id ? -1 : 1))
    .slice(0, MAX_ITEMS_PER_GROUP);
  for (const edge of edges) {
    const other = edge.sourceEntityId === entity.id ? edge.targetEntityId : edge.sourceEntityId;
    const otherLabel = ctx.index.entityById.get(other)?.canonicalLabel ?? ctx.index.locationById.get(other)?.label ?? other;
    pushClaim(ctx, {
      statement: `The synthesized graph records a ${edge.relationshipType.replace(/_/g, " ")} relationship between ${entity.canonicalLabel} and ${otherLabel}.`,
      classification: edge.classification,
      confidence: edge.provenance.confidence,
      derivation: "retrieved",
      explanation: `Graph edge built by ${edge.provenance.method} from ${edge.evidenceItemIds.length} evidence item(s) and ${edge.extractedRecordIds.length} extracted record(s); the edge carries its own evidence classification.`,
      citations: {
        relationshipIds: addRelationship(ctx, edge.id),
        evidenceItemIds: edge.evidenceItemIds.slice(0, 4).flatMap((id) => addEvidence(ctx, id)),
      },
    });
  }

  const signals = (ctx.index.signalsByEntity.get(entity.id) ?? [])
    .filter((s) => s.signalType === "ranking" || s.signalType === "bridge")
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, 2);
  for (const s of signals) {
    pushClaim(ctx, {
      statement: `Topology analytics reports a ${s.signalType} signal for ${entity.canonicalLabel} — a structural property of the graph, not a claim about conduct.`,
      classification: "algorithmic_signal",
      confidence: s.provenance.confidence,
      derivation: "retrieved",
      explanation: s.explanation,
      citations: { analyticalSignalIds: addSignal(ctx, s), entityIds },
    });
  }

  const findings = (ctx.index.findingsByEntity.get(entity.id) ?? [])
    .sort((a, b) => CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification] || (a.id < b.id ? -1 : 1))
    .slice(0, 3);
  for (const f of findings) {
    pushClaim(ctx, {
      statement: `Spatial/temporal corroboration reports ${f.findingType.replace(/_/g, " ")} involving ${f.entityIds.map((id) => ctx.index.entityById.get(id)?.canonicalLabel ?? id).join(" and ")}${describePlaceAndWindow(f, ctx)}.`,
      classification: f.classification,
      confidence: f.provenance.confidence,
      derivation: "retrieved",
      explanation: f.explanation,
      citations: { corroborationFindingIds: addFinding(ctx, f), evidenceItemIds: f.evidenceItemIds.slice(0, 4).flatMap((id) => addEvidence(ctx, id)) },
    });
  }
}

function retrieveRelationshipBetween(
  ctx: ClaimContext,
  aId: string,
  bId: string,
  allowedTypes?: ReadonlySet<string>,
  framing: "relationship" | "financial" = "relationship",
): void {
  const a = ctx.index.entityById.get(aId);
  const b = ctx.index.entityById.get(bId);
  if (!a || !b) return;
  addEntity(ctx, aId);
  addEntity(ctx, bId);

  const direct = ctx.snapshot.relationships
    .filter(
      (r) =>
        ((r.sourceEntityId === aId && r.targetEntityId === bId) || (r.sourceEntityId === bId && r.targetEntityId === aId)) &&
        (!allowedTypes || allowedTypes.has(r.relationshipType)),
    )
    .sort((r1, r2) => (r1.id < r2.id ? -1 : 1));

  for (const edge of direct) {
    pushClaim(ctx, {
      statement: `The synthesized graph records a direct ${edge.relationshipType.replace(/_/g, " ")} relationship between ${a.canonicalLabel} and ${b.canonicalLabel}.`,
      classification: edge.classification,
      confidence: edge.provenance.confidence,
      derivation: "retrieved",
      explanation: `Edge built by ${edge.provenance.method} from ${edge.evidenceItemIds.length} evidence item(s).`,
      citations: {
        relationshipIds: addRelationship(ctx, edge.id),
        evidenceItemIds: edge.evidenceItemIds.slice(0, 4).flatMap((id) => addEvidence(ctx, id)),
      },
    });
  }

  if (direct.length === 0) {
    pushClaim(ctx, {
      statement: `No direct ${framing === "financial" ? "financial " : ""}edge between ${a.canonicalLabel} and ${b.canonicalLabel} exists in the synthesized graph at version ${ctx.snapshot.graphVersion}.`,
      classification: "algorithmic_signal",
      confidence: ABSENCE_CONFIDENCE,
      derivation: "derived",
      explanation:
        "Computed by scanning every persisted relationship for an edge joining these two entities. This describes the graph built from the ingested evidence; it is not a claim that no such connection exists in the world.",
      citations: { entityIds: [aId, bId] },
    });
    ctx.caveats.push(
      "Absence of an edge in the synthesized graph reflects the ingested evidence only — it is not evidence of absence.",
    );
  }

  const path = findPath(ctx.snapshot.relationships, aId, bId, allowedTypes);
  if (path && path.relationshipIds.length > 1) {
    const edges = path.relationshipIds.map((id) => ctx.index.relationshipById.get(id)).filter((r): r is Relationship => !!r);
    const hops = path.nodeIds.map(
      (id) => ctx.index.entityById.get(id)?.canonicalLabel ?? ctx.index.locationById.get(id)?.label ?? id,
    );
    const weakest = edges.reduce<EvidenceClassification>((acc, e) => weaker(acc, e.classification), "corroborated_fact");
    pushClaim(ctx, {
      statement: `${a.canonicalLabel} and ${b.canonicalLabel} are connected indirectly in the graph over ${path.relationshipIds.length} hop(s): ${hops.join(" → ")}.`,
      classification: weaker("algorithmic_signal", weakest),
      confidence: Math.min(TRAVERSAL_CONFIDENCE, ...edges.map((e) => e.provenance.confidence)),
      derivation: "derived",
      explanation: `Shortest path found by deterministic breadth-first search over persisted relationships${allowedTypes ? ` restricted to ${[...allowedTypes].join("/")} edges` : ""}. A traversal is a structural result; it is not itself evidence that the endpoints interacted.`,
      citations: {
        relationshipIds: path.relationshipIds.flatMap((id) => addRelationship(ctx, id)),
        entityIds: [aId, bId],
      },
    });
  } else if (!path) {
    pushClaim(ctx, {
      statement: `No path of any length connects ${a.canonicalLabel} and ${b.canonicalLabel}${allowedTypes ? ` over ${[...allowedTypes].join("/")} edges` : ""} in the graph at version ${ctx.snapshot.graphVersion}.`,
      classification: "algorithmic_signal",
      confidence: ABSENCE_CONFIDENCE,
      derivation: "derived",
      explanation: "Exhaustive breadth-first search over persisted relationships returned no route between the two entities.",
      citations: { entityIds: [aId, bId] },
    });
  }

  const pairFindings = ctx.snapshot.corroborationFindings
    .filter((f) => f.entityIds.includes(aId) && f.entityIds.includes(bId))
    .sort((f1, f2) => CLASSIFICATION_STRENGTH[f2.classification] - CLASSIFICATION_STRENGTH[f1.classification] || (f1.id < f2.id ? -1 : 1))
    .slice(0, 3);
  for (const f of pairFindings) {
    pushClaim(ctx, {
      statement: `Spatial/temporal corroboration reports ${f.findingType.replace(/_/g, " ")} for ${a.canonicalLabel} and ${b.canonicalLabel}${describePlaceAndWindow(f, ctx)}.`,
      classification: f.classification,
      confidence: f.provenance.confidence,
      derivation: "retrieved",
      explanation: f.explanation,
      citations: { corroborationFindingIds: addFinding(ctx, f), evidenceItemIds: f.evidenceItemIds.slice(0, 4).flatMap((id) => addEvidence(ctx, id)) },
    });
  }
}

/** The bank_account entities an ownership edge ties to `personId`. */
export function accountsOwnedBy(relationships: readonly Relationship[], index: SnapshotIndex, personId: string): string[] {
  const owned = new Set<string>();
  for (const r of relationships) {
    if (r.relationshipType !== "ownership") continue;
    const other = r.sourceEntityId === personId ? r.targetEntityId : r.targetEntityId === personId ? r.sourceEntityId : null;
    if (other && index.entityById.get(other)?.kind === "bank_account") owned.add(other);
  }
  return [...owned].sort();
}

/**
 * The account-level money trail: A's accounts → … → B's accounts over
 * `financial` edges only. This is what recovers a mule chain, which a
 * person-level traversal collapses into a single hop and hides.
 */
export function findMoneyChain(
  relationships: readonly Relationship[],
  index: SnapshotIndex,
  aId: string,
  bId: string,
): GraphPath | null {
  const financialOnly = new Set(["financial"]);
  let best: GraphPath | null = null;
  for (const from of accountsOwnedBy(relationships, index, aId)) {
    for (const to of accountsOwnedBy(relationships, index, bId)) {
      const path = findPath(relationships, from, to, financialOnly);
      if (!path || path.relationshipIds.length === 0) continue;
      if (!best || path.relationshipIds.length > best.relationshipIds.length) best = path;
    }
  }
  return best;
}

function retrieveFinancialPath(ctx: ClaimContext, aId: string, bId: string): void {
  const a = ctx.index.entityById.get(aId);
  const b = ctx.index.entityById.get(bId);

  const chain = findMoneyChain(ctx.snapshot.relationships, ctx.index, aId, bId);
  if (chain && a && b) {
    const accountIds = chain.nodeIds.filter((id) => ctx.index.entityById.get(id)?.kind === "bank_account");
    const labels = accountIds.map((id) => ctx.index.entityById.get(id)?.canonicalLabel ?? id);
    const edges = chain.relationshipIds
      .map((id) => ctx.index.relationshipById.get(id))
      .filter((r): r is Relationship => r !== undefined);
    const weakest = edges.reduce<EvidenceClassification>((acc, e) => weaker(acc, e.classification), "corroborated_fact");

    pushClaim(ctx, {
      statement: `A funds route links ${a.canonicalLabel} to ${b.canonicalLabel} across ${chain.relationshipIds.length} transfer hop(s): ${labels.join(" → ")}.`,
      classification: weaker("algorithmic_signal", weakest),
      confidence: Math.min(TRAVERSAL_CONFIDENCE, ...edges.map((e) => e.provenance.confidence)),
      derivation: "derived",
      explanation:
        "Breadth-first search over persisted financial relationships between the accounts each person owns. The route is a structural result over recorded transfers; it is not itself evidence that the same funds travelled the whole chain.",
      citations: {
        relationshipIds: chain.relationshipIds.flatMap((id) => addRelationship(ctx, id)),
        entityIds: [...accountIds.flatMap((id) => addEntity(ctx, id)), ...addEntity(ctx, aId), ...addEntity(ctx, bId)],
      },
    });

    const onChain = new Set(accountIds);
    const transfers = ctx.snapshot.financialTransactions.filter(
      (t) => t.fromAccountEntityId && t.toAccountEntityId && onChain.has(t.fromAccountEntityId) && onChain.has(t.toAccountEntityId),
    );
    if (transfers.length > 0) {
      const total = transfers.reduce((sum, t) => sum + t.amount, 0);
      const currency = transfers[0]?.currency ?? "";
      pushClaim(ctx, {
        statement: `${transfers.length} persisted transaction(s) totalling ${total.toFixed(2)} ${currency} move between the accounts on that chain.`,
        classification: "algorithmic_signal",
        confidence: TRAVERSAL_CONFIDENCE,
        derivation: "derived",
        explanation:
          "Summed deterministically over persisted financial transactions whose endpoints both lie on the traversed chain. The aggregate is a computed figure over the ingested records, not a claim that the funds are the same funds throughout.",
        citations: {
          relationshipIds: chain.relationshipIds.flatMap((id) => addRelationship(ctx, id)),
          entityIds: accountIds,
        },
      });
    }
  } else if (a && b) {
    pushClaim(ctx, {
      statement: `No route of financial transfers connects any account owned by ${a.canonicalLabel} to any account owned by ${b.canonicalLabel} in the graph at version ${ctx.snapshot.graphVersion}.`,
      classification: "algorithmic_signal",
      confidence: ABSENCE_CONFIDENCE,
      derivation: "derived",
      explanation:
        "Exhaustive breadth-first search over persisted financial relationships between the accounts each person owns returned no route. This describes the ingested transaction records; it is not proof that no such transfer occurred.",
      citations: { entityIds: [...addEntity(ctx, aId), ...addEntity(ctx, bId)] },
    });
  }

  retrieveRelationshipBetween(ctx, aId, bId, new Set(["financial", "ownership"]), "financial");
}

function retrieveColocation(ctx: ClaimContext, focusEntityIds: readonly string[]): void {
  const isPerson = (id: string) => ctx.index.entityById.get(id)?.kind === "person";
  const relevant = ctx.snapshot.corroborationFindings
    .filter((f) => f.findingType === "spatial_co_location" || f.findingType === "repeated_spatiotemporal_overlap")
    .filter((f) => focusEntityIds.length === 0 || f.entityIds.some((id) => focusEntityIds.includes(id)))
    .sort(
      (a, b) =>
        // A question about suspects wants person-to-person placements
        // first; a handset-to-person pairing is real but less useful.
        Number(b.entityIds.every(isPerson)) - Number(a.entityIds.every(isPerson)) ||
        CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification] ||
        Number(b.value.occurrenceCount ?? 0) - Number(a.value.occurrenceCount ?? 0) ||
        (a.id < b.id ? -1 : 1),
    )
    .slice(0, MAX_ITEMS_PER_GROUP);

  if (relevant.length === 0) {
    ctx.warnings.push("No spatial co-location or repeated-overlap finding matches the entities in the question.");
    return;
  }

  const corroboratedCount = relevant.filter((f) => f.classification === "corroborated_fact").length;
  pushClaim(ctx, {
    statement: `${relevant.length} corroboration finding(s) place pairs of case entities in the same recorded window at the same site — ${corroboratedCount} of them corroborated across two or more independent evidence items.`,
    classification: "algorithmic_signal",
    confidence: Math.min(...relevant.map((f) => f.provenance.confidence)),
    derivation: "derived",
    explanation:
      "Counted over the persisted corroboration findings for the current graph version. Shared registration at a cell tower inside a shared window is co-occurrence of recorded activity — never evidence that the parties met.",
    citations: { corroborationFindingIds: relevant.flatMap((f) => addFinding(ctx, f)) },
  });

  for (const f of relevant) {
    const labels = f.entityIds.map((id) => ctx.index.entityById.get(id)?.canonicalLabel ?? id);
    const places = f.locationIds.map((id) => ctx.index.locationById.get(id)?.label ?? id);
    pushClaim(ctx, {
      statement: `Corroboration places ${labels.join(" and ")} active at ${places.join(" and ") || "the same site"} within the same observed window${f.window ? ` (${f.window.start}${f.window.end ? ` → ${f.window.end}` : ""})` : ""}.`,
      classification: f.classification,
      confidence: f.provenance.confidence,
      derivation: "retrieved",
      explanation: `${f.explanation} Shared cell-tower activity in a shared window is co-occurrence of recorded activity; it is not evidence of physical contact between the parties.`,
      citations: {
        corroborationFindingIds: addFinding(ctx, f),
        evidenceItemIds: f.evidenceItemIds.slice(0, 4).flatMap((id) => addEvidence(ctx, id)),
      },
    });
  }
  const crimeEvents = ctx.snapshot.evidenceItems
    .filter((i) => i.itemType === "crime_event")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const event of crimeEvents.slice(0, 4)) {
    pushClaim(ctx, {
      statement: `Crime event ${contentString(event.content, "eventId") ?? event.id} is recorded at ${contentString(event.content, "occurredAt") ?? "an unstated time"}, scene “${contentString(event.content, "sceneLabel") ?? "—"}”, nearest cell tower ${contentString(event.content, "nearestTower") ?? "—"}.`,
      classification: "observed_fact",
      confidence: event.confidence,
      derivation: "retrieved",
      explanation: "Read verbatim from the ingested crime-event record — the reference times the placements above are compared against.",
      citations: { evidenceItemIds: addEvidence(ctx, event.id) },
    });
  }

  ctx.caveats.push(
    "Cell-tower co-location shows two handsets registered to the same tower in the same window — it does not establish that the people met.",
  );
}

/**
 * Attribute-level conflicts: two extracted attribute mentions asserting
 * DIFFERENT values for the same (subject, attribute) pair. Purely
 * structural, so it can never invent a conflict that the records do not
 * literally contain.
 */
function findAttributeConflicts(ctx: ClaimContext): { subject: string; attribute: string; records: ExtractedRecord[] }[] {
  const groups = new Map<string, ExtractedRecord[]>();
  for (const r of ctx.snapshot.extractedRecords) {
    if (r.recordType !== "attribute_mention") continue;
    const data = r.data;
    const subject = data.subject;
    const attribute = data.attribute;
    const value = data.observedValue;
    if (typeof subject !== "string" || typeof attribute !== "string" || typeof value !== "string") continue;
    pushInto(groups, `${subject} ${attribute}`, r);
  }
  const conflicts: { subject: string; attribute: string; records: ExtractedRecord[] }[] = [];
  for (const [key, records] of [...groups].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const values = new Set(records.map((r) => String((r.data as Record<string, unknown>).observedValue).toLowerCase()));
    if (values.size < 2) continue;
    const [subject, attribute] = key.split(" ") as [string, string];
    conflicts.push({ subject, attribute, records: records.slice().sort((a, b) => (a.id < b.id ? -1 : 1)) });
  }
  return conflicts;
}

/**
 * Witness statements about the same resolved subject where one carries
 * an explicit exclusion/denial marker and another does not. Reported as
 * an INVESTIGATIVE LEAD — "these two accounts may be incompatible,
 * review them" — never as an established contradiction, and never
 * resolved in favour of either side.
 */
function findStatementConflicts(ctx: ClaimContext): { entityId: string; positive: EvidenceItem; denial: EvidenceItem }[] {
  const statements = ctx.snapshot.evidenceItems
    .filter((i) => i.itemType === "witness_statement")
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const byName = new Map<string, EvidenceItem[]>();
  for (const s of statements) {
    for (const name of contentStringArray(s.content, "aboutNames")) pushInto(byName, name.toLowerCase(), s);
  }

  const out: { entityId: string; positive: EvidenceItem; denial: EvidenceItem }[] = [];
  for (const entity of ctx.index.personEntities) {
    const group = byName.get(entity.canonicalLabel.toLowerCase()) ?? [];
    if (group.length < 2) continue;
    const isDenial = (i: EvidenceItem) => {
      const text = (contentString(i.content, "text") ?? "").toLowerCase();
      return DENIAL_MARKERS.some((m) => text.includes(m));
    };
    const denials = group.filter(isDenial);
    const positives = group.filter((i) => !isDenial(i));
    for (const denial of denials) {
      for (const positive of positives) out.push({ entityId: entity.id, positive, denial });
    }
  }
  return out.sort((a, b) => (a.denial.id < b.denial.id ? -1 : 1)).slice(0, MAX_ITEMS_PER_GROUP);
}

function retrieveContradictions(ctx: ClaimContext, focusEntityIds: readonly string[]): void {
  const spatiotemporal = ctx.snapshot.corroborationFindings
    .filter((f) => f.findingType === "spatiotemporal_contradiction")
    .filter((f) => focusEntityIds.length === 0 || f.entityIds.some((id) => focusEntityIds.includes(id)))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, MAX_ITEMS_PER_GROUP);
  const attributeConflicts = findAttributeConflicts(ctx).slice(0, MAX_ITEMS_PER_GROUP);
  const statementConflicts = findStatementConflicts(ctx).filter(
    (c) => focusEntityIds.length === 0 || focusEntityIds.includes(c.entityId),
  );

  const totalConflicts = spatiotemporal.length + attributeConflicts.length + statementConflicts.length;
  if (totalConflicts > 0) {
    pushClaim(ctx, {
      statement: `${totalConflicts} conflict(s) were detected: ${spatiotemporal.length} travel-speed contradiction(s) in the corroboration findings, ${attributeConflicts.length} attribute disagreement(s) between extracted records, and ${statementConflicts.length} pair(s) of witness statements whose accounts may not both hold. None has been resolved in favour of either side.`,
      classification: "algorithmic_signal",
      confidence: 1,
      derivation: "derived",
      explanation:
        "Counted over three deterministic checks: persisted spatiotemporal_contradiction findings, extracted attribute mentions that disagree on the same subject and attribute, and witness statements about the same resolved subject where one carries an explicit exclusion phrase.",
      citations: {
        corroborationFindingIds: spatiotemporal.flatMap((f) => addFinding(ctx, f)),
        evidenceItemIds: statementConflicts.flatMap((c) => [
          ...addEvidence(ctx, c.positive.id),
          ...addEvidence(ctx, c.denial.id),
        ]),
        extractedRecordIds: attributeConflicts.flatMap((c) => c.records.flatMap((r) => addRecord(ctx, r.id))),
      },
    });
  }

  for (const f of spatiotemporal) {
    const label = f.entityIds.map((id) => ctx.index.entityById.get(id)?.canonicalLabel ?? id).join(", ");
    const places = f.locationIds.map((id) => ctx.index.locationById.get(id)?.label ?? id);
    pushClaim(ctx, {
      statement: `Corroboration flags a travel-speed contradiction for ${label}: recorded at ${places.join(" and ")} within a window the separation makes implausible.`,
      classification: f.classification,
      confidence: f.provenance.confidence,
      derivation: "retrieved",
      explanation: `${f.explanation} The conflict is reported, not resolved — neither placement is preferred over the other.`,
      citations: {
        corroborationFindingIds: addFinding(ctx, f),
        evidenceItemIds: f.evidenceItemIds.slice(0, 4).flatMap((id) => addEvidence(ctx, id)),
      },
    });
  }

  for (const conflict of attributeConflicts) {
    const values = conflict.records.map((r) => String(r.data.observedValue));
    const claim = pushClaim(ctx, {
      statement: `Sources disagree on the ${conflict.attribute} of ${conflict.subject}: ${uniqueSorted(values).join(" vs ")}.`,
      classification: "algorithmic_signal",
      confidence: Math.min(...conflict.records.map((r) => r.provenance.confidence)),
      derivation: "derived",
      explanation:
        "Detected by comparing every extracted attribute mention sharing the same subject and attribute. Both readings are reported; neither source is preferred.",
      citations: {
        extractedRecordIds: conflict.records.flatMap((r) => addRecord(ctx, r.id)),
        evidenceItemIds: conflict.records.flatMap((r) => addEvidence(ctx, r.evidenceItemId)),
      },
    });
    if (claim) {
      const evidenceItemIds = uniqueSorted(conflict.records.map((r) => r.evidenceItemId));
      if (evidenceItemIds.length >= 2) {
        ctx.conflicts.push({
          summary: `Conflicting ${conflict.attribute} recorded for ${conflict.subject}.`,
          claimIds: [claim.id],
          evidenceItemIds,
        });
      }
    }
  }

  for (const conflict of statementConflicts) {
    const subject = ctx.index.entityById.get(conflict.entityId)?.canonicalLabel ?? conflict.entityId;
    const positiveId = contentString(conflict.positive.content, "statementId") ?? conflict.positive.id;
    const denialId = contentString(conflict.denial.content, "statementId") ?? conflict.denial.id;
    const claim = pushClaim(ctx, {
      statement: `Statements ${positiveId} and ${denialId} give accounts of ${subject} that may not both hold; flagged for review, not resolved.`,
      classification: "investigative_lead",
      confidence: STATEMENT_CONFLICT_CONFIDENCE,
      derivation: "derived",
      explanation:
        "Both statements name the same resolved subject and one carries an explicit exclusion/denial phrase. This is a prompt to examine the two accounts — it is not a determination that either is false.",
      citations: {
        evidenceItemIds: [...addEvidence(ctx, conflict.positive.id), ...addEvidence(ctx, conflict.denial.id)],
        entityIds: addEntity(ctx, conflict.entityId),
      },
    });
    if (claim) {
      ctx.conflicts.push({
        summary: `Statements ${positiveId} and ${denialId} describe ${subject} incompatibly.`,
        claimIds: [claim.id],
        evidenceItemIds: uniqueSorted([conflict.positive.id, conflict.denial.id]),
      });
    }
  }

  if (totalConflicts === 0) {
    // "Checked, none found" is a different statement from "insufficient
    // data" (docs/contracts/agent-contracts.md, Agent 5) — say which.
    ctx.warnings.push(
      "All three contradiction checks ran against the current graph version and found nothing in scope — this is 'checked, none found', not 'insufficient data'.",
    );
  }
}

function retrieveStructuralSignificance(ctx: ClaimContext): void {
  const ranked = ctx.snapshot.analyticalSignals
    .filter((s) => s.signalType === "ranking" && typeof s.value.rank === "number")
    .sort((a, b) => Number(a.value.rank) - Number(b.value.rank))
    .slice(0, 3);
  for (const s of ranked) {
    const label = s.targetEntityId
      ? (ctx.index.entityById.get(s.targetEntityId)?.canonicalLabel ?? ctx.index.locationById.get(s.targetEntityId)?.label ?? s.targetEntityId)
      : "an unnamed node";
    pushClaim(ctx, {
      statement: `Topology analytics ranks ${label} at position ${String(s.value.rank)} for structural prominence (score ${String(s.value.score)}) — a property of the graph, not a finding about conduct.`,
      classification: "algorithmic_signal",
      confidence: s.provenance.confidence,
      derivation: "retrieved",
      explanation: s.explanation,
      citations: {
        analyticalSignalIds: addSignal(ctx, s),
        entityIds: s.targetEntityId ? addEntity(ctx, s.targetEntityId) : [],
      },
    });
  }

  // The ranking is over every graph node, so its top entries are often
  // handsets. An investigator asking "which entity" also needs the
  // highest-ranked PERSON, which is otherwise buried.
  const topPerson = ctx.snapshot.analyticalSignals
    .filter(
      (s) =>
        s.signalType === "ranking" &&
        typeof s.value.rank === "number" &&
        s.targetEntityId &&
        ctx.index.entityById.get(s.targetEntityId)?.kind === "person",
    )
    .sort((a, b) => Number(a.value.rank) - Number(b.value.rank))[0];
  if (topPerson?.targetEntityId && !ranked.some((s) => s.id === topPerson.id)) {
    const label = ctx.index.entityById.get(topPerson.targetEntityId)?.canonicalLabel ?? topPerson.targetEntityId;
    pushClaim(ctx, {
      statement: `The highest-ranked person in the same prominence ranking is ${label}, at position ${String(topPerson.value.rank)} overall.`,
      classification: "algorithmic_signal",
      confidence: topPerson.provenance.confidence,
      derivation: "retrieved",
      explanation: `${topPerson.explanation} The ranking covers every graph node, so positions above this one may be handsets or accounts rather than people.`,
      citations: { analyticalSignalIds: addSignal(ctx, topPerson), entityIds: addEntity(ctx, topPerson.targetEntityId) },
    });
  }

  const bridges = ctx.snapshot.analyticalSignals
    .filter((s) => s.signalType === "bridge")
    .sort((a, b) => Number(b.value.componentsAfter ?? 0) - Number(a.value.componentsAfter ?? 0) || (a.id < b.id ? -1 : 1))
    .slice(0, 2);
  for (const s of bridges) {
    const label = s.targetEntityId ? (ctx.index.entityById.get(s.targetEntityId)?.canonicalLabel ?? s.targetEntityId) : "a node";
    pushClaim(ctx, {
      statement: `${label} is an articulation point: removing it would split the graph into more components.`,
      classification: "algorithmic_signal",
      confidence: s.provenance.confidence,
      derivation: "retrieved",
      explanation: s.explanation,
      citations: { analyticalSignalIds: addSignal(ctx, s), entityIds: s.targetEntityId ? addEntity(ctx, s.targetEntityId) : [] },
    });
  }

  if (ranked.length === 0 && bridges.length === 0) {
    ctx.warnings.push("No ranking or bridge signal is persisted for the current graph version.");
  }
}

function retrieveIntermediaryLinks(ctx: ClaimContext, focusEntityIds: readonly string[]): void {
  const bridgePeople = ctx.snapshot.analyticalSignals
    .filter((s) => s.signalType === "bridge" && s.targetEntityId && ctx.index.entityById.get(s.targetEntityId)?.kind === "person")
    .filter((s) => focusEntityIds.length === 0 || focusEntityIds.includes(s.targetEntityId as string))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .slice(0, 3);

  for (const s of bridgePeople) {
    const entityId = s.targetEntityId as string;
    const label = ctx.index.entityById.get(entityId)?.canonicalLabel ?? entityId;
    pushClaim(ctx, {
      statement: `${label} is flagged by topology analytics as a bridge between otherwise separate parts of the network.`,
      classification: "algorithmic_signal",
      confidence: s.provenance.confidence,
      derivation: "retrieved",
      explanation: s.explanation,
      citations: { analyticalSignalIds: addSignal(ctx, s), entityIds: addEntity(ctx, entityId) },
    });

    const seenPartners = new Set<string>();
    const partners = (ctx.index.relationshipsByEntity.get(entityId) ?? [])
      .filter((r) => r.relationshipType === "communication")
      .map((r) => ({ edge: r, other: r.sourceEntityId === entityId ? r.targetEntityId : r.sourceEntityId }))
      .filter(({ other }) => ctx.index.entityById.get(other)?.kind === "person")
      .sort((a, b) => (a.edge.id < b.edge.id ? -1 : 1))
      // One claim per counterpart: the graph holds a directed edge each
      // way, and two identically-worded claims would read as two
      // independent findings when they are one relationship.
      .filter(({ other }) => (seenPartners.has(other) ? false : (seenPartners.add(other), true)))
      .slice(0, MAX_ITEMS_PER_GROUP);

    for (const { edge, other } of partners) {
      const otherLabel = ctx.index.entityById.get(other)?.canonicalLabel ?? other;
      const eventCount = typeof edge.attributes.eventCount === "number" ? edge.attributes.eventCount : null;
      pushClaim(ctx, {
        statement: `The graph records ${eventCount === null ? "recurring" : `${eventCount}`} communication event(s) between ${label} and ${otherLabel}.`,
        classification: edge.classification,
        confidence: edge.provenance.confidence,
        derivation: "retrieved",
        explanation: `Edge built by ${edge.provenance.method} from ${edge.evidenceItemIds.length} CDR evidence item(s).`,
        citations: {
          relationshipIds: addRelationship(ctx, edge.id),
          evidenceItemIds: edge.evidenceItemIds.slice(0, 3).flatMap((id) => addEvidence(ctx, id)),
        },
      });
    }
  }

  if (bridgePeople.length === 0) ctx.warnings.push("No person entity is flagged as a bridge for the current graph version.");
}

function retrieveCaseSummary(ctx: ClaimContext): void {
  const corroborated = ctx.snapshot.corroborationFindings.filter((f) => f.classification === "corroborated_fact");
  const signals = ctx.snapshot.corroborationFindings.filter((f) => f.classification === "algorithmic_signal");
  const inferenceEdges = ctx.snapshot.relationships.filter((r) => r.classification === "ai_inference");
  const factEdges = ctx.snapshot.relationships.filter((r) => r.classification === "corroborated_fact" || r.classification === "observed_fact");

  const sampleFacts = corroborated.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 3);
  const sampleInferences = inferenceEdges.slice().sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, 3);

  if (factEdges.length > 0) {
    pushClaim(ctx, {
      statement: `${factEdges.length} of the ${ctx.snapshot.relationships.length} graph relationships are classified as observed or corroborated fact.`,
      classification: "algorithmic_signal",
      confidence: 1,
      derivation: "derived",
      explanation: "Counted over the persisted relationships for the current graph version.",
      citations: { relationshipIds: factEdges.slice(0, 3).flatMap((r) => addRelationship(ctx, r.id)) },
    });
  }
  for (const f of sampleFacts) {
    pushClaim(ctx, {
      statement: `Corroborated: ${f.explanation}`,
      classification: f.classification,
      confidence: f.provenance.confidence,
      derivation: "retrieved",
      explanation: `Independent agreement across ${f.evidenceItemIds.length} distinct evidence items raised this to a corroborated fact.`,
      citations: { corroborationFindingIds: addFinding(ctx, f), evidenceItemIds: f.evidenceItemIds.slice(0, 3).flatMap((id) => addEvidence(ctx, id)) },
    });
  }
  for (const r of sampleInferences) {
    pushClaim(ctx, {
      statement: `Inferred (not observed): ${describeRelationship(r, ctx.index)}.`,
      classification: "ai_inference",
      confidence: r.provenance.confidence,
      derivation: "retrieved",
      explanation: `This edge was derived rather than read from a single source; it carries the ai_inference classification the graph stage assigned it.`,
      citations: { relationshipIds: addRelationship(ctx, r.id) },
    });
  }
  if (signals.length > 0) {
    pushClaim(ctx, {
      statement: `${signals.length} corroboration findings remain algorithmic signals — derived patterns, not established facts.`,
      classification: "algorithmic_signal",
      confidence: 1,
      derivation: "derived",
      explanation: "Counted over the persisted corroboration findings for the current graph version.",
      citations: { corroborationFindingIds: signals.slice(0, 3).flatMap((f) => addFinding(ctx, f)) },
    });
  }
}

// --- entry point ---------------------------------------------------------

export function retrieve(snapshot: CorpusSnapshot, grounding: QuestionGrounding): RetrievalOutput {
  const index = indexSnapshot(snapshot);
  const ctx: ClaimContext = {
    snapshot,
    index,
    pack: createPackBuilder(),
    claims: [],
    conflicts: [],
    caveats: [],
    warnings: [],
    related: { entityIds: new Set(), relationshipIds: new Set(), signalIds: new Set(), findingIds: new Set() },
  };

  const focus = grounding.resolvedEntityIds.filter((id) => index.entityById.has(id));

  switch (grounding.intent) {
    case "suspects_overview":
      retrieveSuspectsOverview(ctx);
      break;
    case "relationship_between":
      if (focus.length >= 2) retrieveRelationshipBetween(ctx, focus[0] as string, focus[1] as string);
      else if (focus.length === 1) retrieveEntityProfile(ctx, focus[0] as string);
      break;
    case "financial_path":
      if (focus.length >= 2) retrieveFinancialPath(ctx, focus[0] as string, focus[1] as string);
      else if (focus.length === 1) retrieveEntityProfile(ctx, focus[0] as string);
      break;
    case "colocation_at_event":
      retrieveColocation(ctx, focus);
      break;
    case "contradictions":
      retrieveContradictions(ctx, focus);
      break;
    case "structural_significance":
      retrieveStructuralSignificance(ctx);
      break;
    case "intermediary_links":
      retrieveIntermediaryLinks(ctx, focus);
      break;
    case "case_summary":
      retrieveCaseSummary(ctx);
      break;
    case "entity_profile":
      for (const id of focus.slice(0, 2)) retrieveEntityProfile(ctx, id);
      break;
    case "open_question":
      for (const id of focus.slice(0, 2)) retrieveEntityProfile(ctx, id);
      if (focus.length === 0) {
        ctx.warnings.push(
          "The question names no entity, identifier, or analysis this case holds, so structured retrieval had nothing to select.",
        );
      }
      break;
  }

  for (const unknown of grounding.unknownReferences) {
    ctx.warnings.push(`“${unknown}” does not match any entity, alias, or identifier in this investigation.`);
  }

  // A named site is recognised by grounding but is not an entity, so it
  // cannot narrow entity-scoped retrieval. Say so rather than let the
  // question's wording imply a scope the answer does not have.
  const namedSites = grounding.resolvedEntityIds.filter((id) => !index.entityById.has(id) && snapshot.locations.some((l) => l.id === id));
  if (namedSites.length > 0 && (grounding.intent === "contradictions" || grounding.intent === "case_summary")) {
    const labels = namedSites.map((id) => snapshot.locations.find((l) => l.id === id)?.label ?? id);
    ctx.caveats.push(
      `The question named ${labels.join(", ")}. Conflict detection is scoped to the whole case rather than to a single site, so findings below may concern other locations too.`,
    );
  }

  return {
    pack: ctx.pack.build(),
    claims: ctx.claims,
    conflicts: ctx.conflicts,
    caveats: uniqueSorted(ctx.caveats),
    relatedViews: {
      entityIds: uniqueSorted([...ctx.related.entityIds]),
      relationshipIds: uniqueSorted([...ctx.related.relationshipIds]),
      analyticalSignalIds: uniqueSorted([...ctx.related.signalIds]),
      corroborationFindingIds: uniqueSorted([...ctx.related.findingIds]),
    },
    warnings: ctx.warnings,
  };
}
