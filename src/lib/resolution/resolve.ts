import type { ExtractedRecord } from "@/lib/domain/extraction";
import type { EntityKind } from "@/lib/domain/entity";
import { makeContentId } from "@/lib/domain/ids";
import type { Provenance } from "@/lib/domain/provenance";
import type { ResolutionStatus, ResolutionType } from "@/lib/domain/resolution";
import {
  applyIdentifierPolicy,
  describeConflict,
  REGISTRY_IDENTIFIER_RELATIONSHIP,
  type SchemeConflict,
} from "@/lib/resolution/identifier-authority";
import {
  describeNormalization,
  normalizeName,
  type NormalizedName,
} from "@/lib/resolution/name-normalization";

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
  /**
   * Strictly below exactNameMatch and far below any identifier merge.
   * A normalised match is real evidence - the strings agree once two
   * publishers' house styles are removed - but it is an inference about
   * naming convention, not an observation of a shared identifier, and
   * the confidence has to say so. Still above MERGE_CONFIDENCE_FLOOR
   * (0.5), so it is applied rather than merely proposed; that was the
   * approved decision, and it is the line that would move if a later
   * measurement showed normalised matching merging things it should not.
   */
  normalizedNameMatch: 0.55,
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

    // Mentions whose own record contradicts itself on a mergeable
    // identifier scheme. Held aside and flagged rather than merged.
    const conflictsByMention = new Map<string, SchemeConflict[]>();

    for (const mention of personMentions) {
      const siblingRelationships = relationshipsByItem.get(mention.evidenceItemId) ?? [];
      const identityRelationships = siblingRelationships.filter((r) =>
        (IDENTITY_RELATIONSHIP_TYPES as readonly string[]).includes(
          str(r.data, "relationshipType") ?? "",
        ),
      );
      const valuesOf = (rels: typeof identityRelationships) =>
        rels
          .map((r) => str(r.data, "observedValue"))
          .filter((v): v is string => Boolean(v))
          .sort();

      // The identifier-authority policy governs REGISTRY identifiers only
      // (`has_identifier`, stated by a public_record about its own
      // subject). Phone / account / vehicle identifiers keep their
      // existing behaviour exactly — they are single-valued observations
      // from an authorised source, not third-party cross-references, and
      // every non-public evidence type depends on them.
      const isRegistry = (r: (typeof identityRelationships)[number]) =>
        str(r.data, "relationshipType") === REGISTRY_IDENTIFIER_RELATIONSHIP;
      const directValues = valuesOf(identityRelationships.filter((r) => !isRegistry(r)));
      const registryValues = valuesOf(identityRelationships.filter(isRegistry));

      const policy = applyIdentifierPolicy(registryValues);
      if (policy.conflicts.length > 0) {
        conflictsByMention.set(mention.id, policy.conflicts);
      }

      // Reported identifiers include the withheld ones: the decision's
      // reason should say what the record stated, not only what was acted
      // on. Only `unionValues` may connect anything.
      const linkedIdentifiers = [...directValues, ...registryValues].sort();
      const unionValues = [...directValues, ...policy.mergeable].sort();
      if (unionValues.length === 0) continue;

      linkedIdentifiersByMention.set(mention.id, linkedIdentifiers);
      tierAMentionIds.add(mention.id);
      for (const idValue of unionValues) {
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
    // normalised name -> the same, for Tier B2. Kept as a SEPARATE index
    // rather than replacing the exact one, so an exact match always wins
    // and is always reported as an exact match.
    const normalizedNameToClusterEntities = new Map<string, Set<string>>();
    const normalizedFormByCluster = new Map<string, NormalizedName>();
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

        const normalized = normalizeName(name);
        if (normalized.normalized.length === 0) continue;
        const normSet =
          normalizedNameToClusterEntities.get(normalized.normalized) ?? new Set<string>();
        normSet.add(entityId);
        normalizedNameToClusterEntities.set(normalized.normalized, normSet);
        if (!normalizedFormByCluster.has(`${entityId}|${normalized.normalized}`)) {
          normalizedFormByCluster.set(`${entityId}|${normalized.normalized}`, normalized);
        }
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
      /**
       * Keyed by the alias's CANONICAL form, not its raw string.
       *
       * `makeContentId` trims and lower-cases its parts, so an alias id is
       * already case-insensitive: `PIONEER RAILCORP` and `Pioneer Railcorp`
       * are one row by design. Keying this map on the raw string let both
       * through, and persistence then tried to insert one id twice —
       * `UNIQUE constraint failed: aliases.id`, which took the whole
       * resolution stage down.
       *
       * The 257-record corpus never hit it because no entity there had two
       * case-variant aliases; GLEIF publishes exactly that for some
       * entities, so P6.19's 1,245-record corpus did. This makes the
       * emitter agree with the id scheme rather than changing either: the
       * winner is still the lowest source record id, and the publisher's
       * own casing is still what gets stored.
       */
      const aliasSourceByName = new Map<string, { value: string; source: ExtractedRecord }>();
      const aliasKey = (value: string) => value.trim().toLowerCase();
      const offer = (value: string, source: ExtractedRecord) => {
        const k = aliasKey(value);
        const existing = aliasSourceByName.get(k);
        if (!existing || source.id < existing.source.id) aliasSourceByName.set(k, { value, source });
      };
      for (const m of members) {
        const name = str(m.data, "observedValue")!;
        if (name === canonicalLabel) continue;
        offer(name, m);
      }
      // explicit alias/nickname relationship_mentions (has_alias) from any member's own evidence item.
      for (const m of members) {
        const siblingRelationships = relationshipsByItem.get(m.evidenceItemId) ?? [];
        for (const r of siblingRelationships) {
          if (!["has_alias","alias_of"].includes(str(r.data, "relationshipType") ?? "")) continue;
          const aliasValue = str(r.data, "observedValue");
          if (!aliasValue || aliasValue === canonicalLabel) continue;
          offer(aliasValue, r);
        }
      }
      for (const [, { value: aliasValue, source }] of [...aliasSourceByName.entries()].sort(([a], [b]) =>
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

    // --- Phase 2b: records that contradict themselves on a mergeable
    // identifier scheme. Flagged, never merged — the same treatment Tier B
    // already gives an ambiguous name, for the same reason: the evidence
    // supports two incompatible answers and choosing one would be a guess
    // carrying a merge's confidence.
    //
    // These mentions are also withheld from Tier B. A record whose own
    // identifiers contradict each other has not become better evidence by
    // having a name, and letting it merge on the name instead would
    // reintroduce the bridge through a lower-confidence door.

    const conflictedMentionIds = new Set(conflictsByMention.keys());
    for (const mentionId of [...conflictedMentionIds].sort()) {
      const mention = mentionById.get(mentionId);
      if (!mention) continue;
      const conflicts = conflictsByMention.get(mentionId)!;
      const name = str(mention.data, "observedValue")!;
      const registry = str(mention.data, "registry") ?? null;

      // The entities each contradictory value points at, where one exists.
      // Recorded as candidates so the conflict is reviewable: this is what
      // the record would have been merged into, had it named only one.
      const candidateEntityIds = [
        ...new Set(
          conflicts
            .flatMap((c) => c.values)
            .map((value) => clusterEntityIdByRoot.get(uf.find(`id:${value}`)))
            .filter((id): id is string => Boolean(id)),
        ),
      ].sort();

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
          "resolution:ambiguous_identifier_conflict",
          CONFIDENCE.ambiguousConflict,
          "resolution:entity_created",
          resolvedAt,
        ),
      });

      const conflictMessages = conflicts.map((c) => describeConflict(c, registry));
      decisions.push({
        id: makeContentId("resolution_decision", [mention.id]),
        investigationId,
        canonicalEntityId: standaloneId,
        extractedRecordIds: [mention.id],
        resolutionType: "ambiguous_identifier_conflict",
        status: "ambiguous",
        candidateEntityIds,
        conflicts: conflictMessages,
        reason: `Kept as its own unresolved entity — conflicting identifiers on one record, never force-merged.`,
        classification: "ai_inference",
        provenance: buildProvenance(
          mention.id,
          mention.provenance,
          "resolution:ambiguous_identifier_conflict",
          CONFIDENCE.ambiguousConflict,
          "resolution:ambiguous_identifier_conflict",
          resolvedAt,
        ),
      });
      for (const message of conflictMessages) {
        warnings.push(`"${name}": ${message}`);
      }
    }

        // --- Phase 3: Tier-B - resolve every remaining (identifier-less) subject mention ---
    //
    // B1 exact name match, then B2 normalised name match. The order is
    // the point: an exact match must never be reported as a normalised
    // one, and normalisation must never be able to overrule a string the
    // publishers already agree on.
    const unlinkedMentionIds: string[] = [];

    for (const mention of [...personMentions].sort((a, b) => (a.id < b.id ? -1 : 1))) {
      if (tierAMentionIds.has(mention.id)) continue; // already resolved in Phase 2
      if (conflictedMentionIds.has(mention.id)) continue; // flagged in Phase 2b
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

      // --- Tier B2: the same question, asked of the NORMALISED name ---
      //
      // Reached only when the exact string matched nothing at all. P6.16
      // measured 0 of 75 real pairs sharing a byte-identical name while
      // 53 of them differed only by capitalisation or a legal suffix, so
      // this is the branch those pairs need. It is deterministic: the
      // two strings either normalise to the same key or they do not.
      const normalized = normalizeName(name);
      const normalizedCandidates =
        normalized.normalized.length > 0
          ? [...(normalizedNameToClusterEntities.get(normalized.normalized) ?? new Set<string>())].sort()
          : [];

      if (normalizedCandidates.length === 1) {
        const targetId = normalizedCandidates[0]!;
        const clusterForm = normalizedFormByCluster.get(`${targetId}|${normalized.normalized}`);
        const how = clusterForm ? describeNormalization(normalized, clusterForm) : null;
        decisions.push({
          id: makeContentId("resolution_decision", [mention.id]),
          investigationId,
          canonicalEntityId: targetId,
          extractedRecordIds: [mention.id],
          resolutionType: "normalized_name_match",
          status: "resolved",
          candidateEntityIds: [],
          conflicts: [],
          reason:
            `Normalised name match to exactly one identifier-anchored entity: ` +
            `"${name}" and that entity's name both normalise to "${normalized.normalized}"` +
            `${how ? ` after ${how}` : ""}. Deterministic normalisation only - no fuzzy ` +
            `matching, no similarity threshold. Weaker evidence than a shared identifier, ` +
            `and recorded at lower confidence to say so.`,
          classification: "ai_inference",
          provenance: buildProvenance(
            mention.id,
            mention.provenance,
            "resolution:normalized_name_match",
            CONFIDENCE.normalizedNameMatch,
            "resolution:normalized_name_match",
            resolvedAt,
          ),
        });
        continue;
      }

      if (normalizedCandidates.length >= 2) {
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
            "resolution:ambiguous_normalized_name_conflict",
            CONFIDENCE.ambiguousConflict,
            "resolution:entity_created",
            resolvedAt,
          ),
        });
        const conflictMsg =
          `Name "${name}" normalises to "${normalized.normalized}", which matches ` +
          `${normalizedCandidates.length} distinct identifier-anchored entities ` +
          `(${normalizedCandidates.join(", ")}); not merged into any of them. The ambiguity ` +
          `was created by normalisation - the original strings did not collide - so the ` +
          `normalisation rules are what a reviewer should question first.`;
        decisions.push({
          id: makeContentId("resolution_decision", [mention.id]),
          investigationId,
          canonicalEntityId: standaloneId,
          extractedRecordIds: [mention.id],
          resolutionType: "ambiguous_normalized_name_conflict",
          status: "ambiguous",
          candidateEntityIds: normalizedCandidates,
          conflicts: [conflictMsg],
          reason: `Kept as its own unresolved entity - ambiguous normalised name match, never force-merged.`,
          classification: "ai_inference",
          provenance: buildProvenance(
            mention.id,
            mention.provenance,
            "resolution:ambiguous_normalized_name_conflict",
            CONFIDENCE.ambiguousConflict,
            "resolution:ambiguous_normalized_name_conflict",
            resolvedAt,
          ),
        });
        warnings.push(conflictMsg);
        continue;
      }

// Nothing corroborated this mention: no identifier of its own, no
      // exact name match, no normalised name match. It still becomes its
      // own entity - a mention is never dropped - but it is recorded as
      // UNRESOLVED, not as a confirmed new entity.
      //
      // P6.16 is why. On the real no-identifier corpus this branch fired
      // 257 times out of 257 and every decision said `resolved` /
      // `new_entity` with no warning, so a run that joined none of its 75
      // real pairs looked exactly like a perfect one. The reason string
      // below names the keys that were searched, so a reader can see WHY
      // a pair that should have joined did not.
      const normalizedForReason = normalizeName(name);
      unlinkedMentionIds.push(mention.id);
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
          "resolution:unlinked_mention",
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
        resolutionType: "unlinked_mention",
        status: "unresolved",
        candidateEntityIds: [],
        conflicts: [],
        reason:
          `Not corroborated by any evidence available to this resolver. Its own evidence item ` +
          `states no mergeable identifier; no identifier-anchored ${subjectKind} entity carries ` +
          `the exact name "${name}"; and none carries the normalised name ` +
          `"${normalizedForReason.normalized}". Kept as its own entity so the mention is never ` +
          `dropped, but recorded as UNRESOLVED - this is not a confirmed new entity.`,
        classification: "ai_inference",
        provenance: buildProvenance(
          mention.id,
          mention.provenance,
          "resolution:unlinked_mention",
          CONFIDENCE.newEntityIsolatedMention,
          "resolution:unlinked_mention",
          resolvedAt,
        ),
      });
    }
    // One aggregate warning, not one per mention. P6.11 removed 24
    // meaningless warnings for exactly this reason: a warning per record
    // buries the one that matters. The count is the signal; the
    // individual reasons are on the decisions.
    if (unlinkedMentionIds.length > 0) {
      warnings.push(
        `${unlinkedMentionIds.length} of ${personMentions.length} ${subjectKind} mention(s) did ` +
          `not resolve to any corroborated entity - no identifier evidence, no exact name match ` +
          `and no normalised name match. They are recorded as unlinked_mention / unresolved, ` +
          `NOT as confirmed new entities; see each decision's reason for the keys that were searched.`,
      );
    }
  } // end: for (const subjectKind of NAMED_SUBJECT_KINDS)

  return { entities, aliases, decisions, warnings };
}
