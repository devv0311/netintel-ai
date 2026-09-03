import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { EntityKind } from "@/lib/domain/entity";
import { makeContentId } from "@/lib/domain/ids";
import type { Provenance } from "@/lib/domain/provenance";
import type { ResolutionStatus, ResolutionType } from "@/lib/domain/resolution";

/**
 * The entity-resolution core: deterministic, evidence-only identity
 * clustering over P5.3's extracted records. Per this milestone's brief,
 * every decision here is justified by structural evidence explicitly
 * present in the extracted records themselves — never by fuzzy string
 * similarity, never by re-parsing free text (attribute_mention
 * `statement_text` is never read here), and never by peeking at ground
 * truth. Two tiers of merge evidence, in order of strength:
 *
 *   Tier A — shared identifier: two person mentions merge when their OWN
 *   evidence item states the same phone/account/vehicle identifier (a
 *   `has_phone`/`has_account`/`has_vehicle` relationship_mention from
 *   that same evidence item) — the exact "SYN-PHONE-001 belongs to
 *   suspect_record SYN-SUSPECT-001" pattern this milestone's brief
 *   calls out as a legitimate observed-source fact to act on.
 *
 *   Tier B — exact name match: a person mention with NO identifier
 *   evidence of its own (a FIR's `accused` entry, a witness statement's
 *   `aboutNames` entry) merges into a Tier-A cluster only when its exact
 *   name string matches exactly one such cluster. Matching two or more
 *   distinct clusters is left unmerged and flagged ambiguous — this is
 *   what keeps two structurally-distinct same-name mentions apart
 *   (docs/contracts/agent-contracts.md, Agent 2: "an entity that cannot
 *   be confidently resolved is retained as an unresolved/ambiguous
 *   entity, never dropped and never force-merged").
 *
 * Nothing here builds a relationship between two DIFFERENT canonical
 * entities (e.g. a person↔phone edge) — assembling those is graph
 * synthesis's job (a later milestone), not resolution's.
 */

// --- deterministic confidence scale (never inflated, never merged with classification) ---
export const CONFIDENCE = {
  canonicalizedIdentifier: 1,
  sharedIdentifierMerge: 0.95,
  newEntityFromOwnIdentifiers: 1,
  newEntityIsolatedMention: 0.5,
  exactNameMatch: 0.6,
  ambiguousConflict: 0.2,
} as const;

export interface EntityCandidate {
  id: string;
  investigationId: string;
  kind: EntityKind;
  canonicalLabel: string;
  attributes: Record<string, unknown>;
  provenance: Provenance;
}

export interface AliasCandidate {
  id: string;
  entityId: string;
  aliasValue: string;
  provenance: Provenance;
}

export interface DecisionCandidate {
  id: string;
  investigationId: string;
  canonicalEntityId: string;
  extractedRecordIds: string[];
  resolutionType: ResolutionType;
  status: ResolutionStatus;
  candidateEntityIds: string[];
  conflicts: string[];
  reason: string;
  classification: "ai_inference";
  provenance: Provenance;
}

export interface ResolutionOutput {
  entities: EntityCandidate[];
  aliases: AliasCandidate[];
  decisions: DecisionCandidate[];
  warnings: string[];
}

const IDENTIFIER_MENTION_KINDS = ["phone", "imei", "vehicle", "bank_account"] as const;
const IDENTITY_RELATIONSHIP_TYPES = [
  "has_phone",
  "has_account",
  "has_vehicle",
  /**
   * A registry identifier stated by a public_record about its own
   * subject — an LEI, a Wikidata QID, an ISIN. Structurally identical to
   * "this evidence item says this person holds this phone": the item
   * states an identifier for the subject it is about, which is exactly
   * the Tier-A evidence this resolver already acts on.
   */
  "has_identifier",
] as const;

/**
 * The mention kinds that name a SUBJECT rather than an identifier, and
 * therefore resolve by the two-tier clustering below rather than by
 * canonicalizing an identifier value.
 *
 * `organisation` joins `person` here for the public-data milestone. The
 * clustering code is run once per kind with its own union-find and its
 * own name index, so an organisation can never be merged with a person
 * however similar the strings — and, because entity ids are content-
 * addressed over (kind, members), every existing person entity id is
 * byte-identical to what it was before this list had a second entry.
 */
const NAMED_SUBJECT_KINDS = ["person", "organisation"] as const;

/** Minimal deterministic union-find over string keys (lexicographically-smallest root wins, for reproducibility). */
class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    if (!this.parent.has(x)) {
      this.parent.set(x, x);
      return x;
    }
    const stored = this.parent.get(x)!;
    if (stored === x) return x;
    const root = this.find(stored);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Builds a resolution-layer provenance object whose `source` is the
 * immediate upstream item (the extracted record this decision/entity/
 * alias was derived from) — not the evidence item further back, which
 * remains reachable via `processingHistory` (extended, never replaced).
 */
function buildProvenance(
  sourceRecordId: string,
  base: Provenance,
  method: string,
  confidence: number,
  step: string,
  timestamp: string,
): Provenance {
  return {
    source: sourceRecordId,
    location: base.location,
    method,
    confidence,
    processingHistory: [...base.processingHistory, step],
    timestamp,
  };
}

export function resolveEntities(
  records: ExtractedRecord[],
  investigationId: string,
  resolvedAt: string,
): ResolutionOutput {
  const entities: EntityCandidate[] = [];
  const aliases: AliasCandidate[] = [];
  const decisions: DecisionCandidate[] = [];
  const warnings: string[] = [];

  // Deterministic base order for everything downstream.
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const entityMentions = sorted.filter((r) => r.recordType === "entity_mention");
  const relationshipMentions = sorted.filter((r) => r.recordType === "relationship_mention");
  const attributeMentions = sorted.filter((r) => r.recordType === "attribute_mention");

  // relationship_mentions grouped by their own evidence item id, for
  // "what identifiers/aliases does THIS record's own source state".
  const relationshipsByItem = new Map<string, ExtractedRecord[]>();
  for (const r of relationshipMentions) {
    const list = relationshipsByItem.get(r.evidenceItemId) ?? [];
    list.push(r);
    relationshipsByItem.set(r.evidenceItemId, list);
  }

  // attribute_mention "note" fields, by evidence item — used only to
  // prefer a non-variant-flagged mention as an entity's canonical label
  // (a literal, structured field the source itself carries — never
  // free text like a witness statement's `text`).
  const noteByItem = new Map<string, string>();
  for (const r of attributeMentions) {
    if (r.data.attribute === "note") {
      const note = str(r.data, "observedValue");
      if (note) noteByItem.set(r.evidenceItemId, note);
    }
  }
  const isVariantRecord = (evidenceItemId: string): boolean =>
    (noteByItem.get(evidenceItemId) ?? "").toLowerCase().includes("variant");

  // --- Phase 1: canonicalize identifier entities (phone/imei/vehicle/bank_account) ---

  const identifierGroups = new Map<string, ExtractedRecord[]>();
  for (const r of entityMentions) {
    const kind = str(r.data, "mentionKind");
    if (!kind || !(IDENTIFIER_MENTION_KINDS as readonly string[]).includes(kind)) continue;
    const value = str(r.data, "observedValue");
    if (!value) continue;
    const key = `${kind}:${value}`;
    const list = identifierGroups.get(key) ?? [];
    list.push(r);
    identifierGroups.set(key, list);
  }

  for (const [key, members] of [...identifierGroups.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    const kind = key.split(":")[0] as EntityKind;
    const value = str(members[0]!.data, "observedValue")!;
    const entityId = makeContentId("entity", [kind, value]);
    const primary = members[0]!;
    entities.push({
      id: entityId,
      investigationId,
      kind,
      canonicalLabel: value,
      attributes: {},
      provenance: buildProvenance(
        primary.id,
        primary.provenance,
        "resolution:canonicalized_identifier",
        CONFIDENCE.canonicalizedIdentifier,
        "resolution:canonicalized_identifier",
        resolvedAt,
      ),
    });
    for (const m of members) {
      decisions.push({
        id: makeContentId("resolution_decision", [m.id]),
        investigationId,
        canonicalEntityId: entityId,
        extractedRecordIds: [m.id],
        resolutionType: "canonicalized_identifier",
        status: "resolved",
        candidateEntityIds: [],
        conflicts: [],
        reason: `Canonicalized ${kind} identifier "${value}" from its own evidence item.`,
        classification: "ai_inference",
        provenance: buildProvenance(
          m.id,
          m.provenance,
          "resolution:canonicalized_identifier",
          CONFIDENCE.canonicalizedIdentifier,
          "resolution:canonicalized_identifier",
          resolvedAt,
        ),
      });
    }
  }

  // --- Phase 2: Tier-A clustering of named-subject mentions via shared identifiers ---
  // Run once per named subject kind, each with its own union-find and
  // name index, so kinds can never cluster into one another.

  for (const subjectKind of NAMED_SUBJECT_KINDS) {
    const personMentions = entityMentions.filter((r) => str(r.data, "mentionKind") === subjectKind);
    const uf = new UnionFind();
    const linkedIdentifiersByMention = new Map<string, string[]>();
    const tierAMentionIds = new Set<string>();

    for (const mention of personMentions) {
      const siblingRelationships = relationshipsByItem.get(mention.evidenceItemId) ?? [];
      const identifierValues = siblingRelationships
        .filter((r) =>
          (IDENTITY_RELATIONSHIP_TYPES as readonly string[]).includes(
            str(r.data, "relationshipType") ?? "",
          ),
        )
        .map((r) => str(r.data, "observedValue"))
        .filter((v): v is string => Boolean(v))
        .sort();
      if (identifierValues.length === 0) continue;

      linkedIdentifiersByMention.set(mention.id, identifierValues);
      tierAMentionIds.add(mention.id);
      for (const idValue of identifierValues) {
        uf.union(`mention:${mention.id}`, `id:${idValue}`);
      }
    }

    const clustersByRoot = new Map<string, string[]>();
    for (const mentionId of [...tierAMentionIds].sort()) {
      const root = uf.find(`mention:${mentionId}`);
      const list = clustersByRoot.get(root) ?? [];
      list.push(mentionId);
      clustersByRoot.set(root, list);
    }

    const mentionById = new Map(personMentions.map((m) => [m.id, m]));
    // name string -> set of Tier-A cluster entity ids that contain it.
    const nameToClusterEntities = new Map<string, Set<string>>();
    const clusterEntityIdByRoot = new Map<string, string>();

    for (const [root, memberIds] of [...clustersByRoot.entries()].sort(([a], [b]) =>
      a < b ? -1 : a > b ? 1 : 0,
    )) {
      const sortedMemberIds = [...memberIds].sort();
      const entityId = makeContentId("entity", [subjectKind, sortedMemberIds.join(",")]);
      clusterEntityIdByRoot.set(root, entityId);

      const members = sortedMemberIds.map((id) => mentionById.get(id)!);
      const nonVariant = members.filter((m) => !isVariantRecord(m.evidenceItemId));
      const canonicalPool = nonVariant.length > 0 ? nonVariant : members;
      const canonical = [...canonicalPool].sort((a, b) => {
        const av = str(a.data, "observedValue") ?? "";
        const bv = str(b.data, "observedValue") ?? "";
        return av < bv ? -1 : av > bv ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
      })[0]!;
      const canonicalLabel = str(canonical.data, "observedValue")!;

      const distinctNames = new Set(members.map((m) => str(m.data, "observedValue")!));
      for (const name of distinctNames) {
        const set = nameToClusterEntities.get(name) ?? new Set<string>();
        set.add(entityId);
        nameToClusterEntities.set(name, set);
      }

      const primary = members[0]!;
      const confidence =
        members.length > 1 ? CONFIDENCE.sharedIdentifierMerge : CONFIDENCE.newEntityFromOwnIdentifiers;

      entities.push({
        id: entityId,
        investigationId,
        kind: subjectKind,
        canonicalLabel,
        attributes: {},
        provenance: buildProvenance(
          primary.id,
          primary.provenance,
          `resolution:${subjectKind}_cluster`,
          confidence,
          "resolution:entity_created",
          resolvedAt,
        ),
      });

      // aliases: every distinct name in this cluster other than the canonical label.
      const aliasSourceByName = new Map<string, ExtractedRecord>();
      for (const m of members) {
        const name = str(m.data, "observedValue")!;
        if (name === canonicalLabel) continue;
        const existing = aliasSourceByName.get(name);
        if (!existing || m.id < existing.id) aliasSourceByName.set(name, m);
      }
      // explicit alias/nickname relationship_mentions (has_alias) from any member's own evidence item.
      for (const m of members) {
        const siblingRelationships = relationshipsByItem.get(m.evidenceItemId) ?? [];
        for (const r of siblingRelationships) {
          if (!["has_alias","alias_of"].includes(str(r.data, "relationshipType") ?? "")) continue;
          const aliasValue = str(r.data, "observedValue");
          if (!aliasValue || aliasValue === canonicalLabel) continue;
          const existing = aliasSourceByName.get(aliasValue);
          if (!existing || r.id < existing.id) aliasSourceByName.set(aliasValue, r);
        }
      }
      for (const [aliasValue, source] of [...aliasSourceByName.entries()].sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )) {
        aliases.push({
          id: makeContentId("alias", [entityId, aliasValue]),
          entityId,
          aliasValue,
          provenance: buildProvenance(source.id, source.provenance, "resolution:alias", 1, "resolution:alias", resolvedAt),
        });
      }

      for (const m of members) {
        const linked = linkedIdentifiersByMention.get(m.id) ?? [];
        const resolutionType: ResolutionType =
          members.length > 1 ? "shared_identifier_merge" : "new_entity";
        const reason =
          members.length > 1
            ? `Merged with ${members.length - 1} other mention(s) via shared identifier(s): ${linked.join(", ")}.`
            : `Established as a new entity from its own directly-linked identifier(s): ${linked.join(", ")}.`;
        decisions.push({
          id: makeContentId("resolution_decision", [m.id]),
          investigationId,
          canonicalEntityId: entityId,
          extractedRecordIds: [m.id],
          resolutionType,
          status: "resolved",
          candidateEntityIds: [],
          conflicts: [],
          reason,
          classification: "ai_inference",
          provenance: buildProvenance(m.id, m.provenance, `resolution:${resolutionType}`, confidence, `resolution:${resolutionType}`, resolvedAt),
        });
      }
    }

    // --- Phase 3: Tier-B — resolve every remaining (identifier-less) subject mention ---

    for (const mention of [...personMentions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (tierAMentionIds.has(mention.id)) continue; // already resolved in Phase 2
      const name = str(mention.data, "observedValue")!;
      const candidates = [...(nameToClusterEntities.get(name) ?? new Set<string>())].sort();

      if (candidates.length === 1) {
        decisions.push({
          id: makeContentId("resolution_decision", [mention.id]),
          investigationId,
          canonicalEntityId: candidates[0]!,
          extractedRecordIds: [mention.id],
          resolutionType: "exact_name_match",
          status: "resolved",
          candidateEntityIds: [],
          conflicts: [],
          reason: `Exact name match to an existing identifier-anchored entity (no identifier evidence of its own from this mention's source).`,
          classification: "ai_inference",
          provenance: buildProvenance(
            mention.id,
            mention.provenance,
            "resolution:exact_name_match",
            CONFIDENCE.exactNameMatch,
            "resolution:exact_name_match",
            resolvedAt,
          ),
        });
        continue;
      }

      if (candidates.length >= 2) {
        const standaloneId = makeContentId("entity", [subjectKind, mention.id]);
        entities.push({
          id: standaloneId,
          investigationId,
          kind: subjectKind,
          canonicalLabel: name,
          attributes: {},
          provenance: buildProvenance(
            mention.id,
            mention.provenance,
            "resolution:ambiguous_name_conflict",
            CONFIDENCE.ambiguousConflict,
            "resolution:entity_created",
            resolvedAt,
          ),
        });
        const conflictMsg = `Name "${name}" exactly matches ${candidates.length} distinct identifier-anchored entities (${candidates.join(", ")}); not merged into any of them.`;
        decisions.push({
          id: makeContentId("resolution_decision", [mention.id]),
          investigationId,
          canonicalEntityId: standaloneId,
          extractedRecordIds: [mention.id],
          resolutionType: "ambiguous_name_conflict",
          status: "ambiguous",
          candidateEntityIds: candidates,
          conflicts: [conflictMsg],
          reason: `Kept as its own unresolved entity — ambiguous name match, never force-merged.`,
          classification: "ai_inference",
          provenance: buildProvenance(
            mention.id,
            mention.provenance,
            "resolution:ambiguous_name_conflict",
            CONFIDENCE.ambiguousConflict,
            "resolution:ambiguous_name_conflict",
            resolvedAt,
          ),
        });
        warnings.push(conflictMsg);
        continue;
      }

      // candidates.length === 0 — a lone, unlinked mention with no corroboration anywhere.
      const standaloneId = makeContentId("entity", [subjectKind, mention.id]);
      entities.push({
        id: standaloneId,
        investigationId,
        kind: subjectKind,
        canonicalLabel: name,
        attributes: {},
        provenance: buildProvenance(
          mention.id,
          mention.provenance,
          "resolution:new_entity",
          CONFIDENCE.newEntityIsolatedMention,
          "resolution:entity_created",
          resolvedAt,
        ),
      });
      decisions.push({
        id: makeContentId("resolution_decision", [mention.id]),
        investigationId,
        canonicalEntityId: standaloneId,
        extractedRecordIds: [mention.id],
        resolutionType: "new_entity",
        status: "resolved",
        candidateEntityIds: [],
        conflicts: [],
        reason: `No corroborating identifier or matching cluster; treated as its own entity from a single, unlinked mention.`,
        classification: "ai_inference",
        provenance: buildProvenance(
          mention.id,
          mention.provenance,
          "resolution:new_entity",
          CONFIDENCE.newEntityIsolatedMention,
          "resolution:new_entity",
          resolvedAt,
        ),
      });
    }
  } // end: for (const subjectKind of NAMED_SUBJECT_KINDS)

  return { entities, aliases, decisions, warnings };
}
