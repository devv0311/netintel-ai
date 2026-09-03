import { createHash } from "node:crypto";

import type { CorroborationFinding } from "@/lib/domain/corroboration";
import {
  EMPTY_DOSSIER_REFERENCES,
  emptyClassificationCensus,
  type DossierFinding,
  type DossierReferences,
  type DossierSection,
  type DossierSectionKind,
} from "@/lib/domain/dossier";
import type { Entity } from "@/lib/domain/entity";
import { isIdOfKind, makeContentId } from "@/lib/domain/ids";
import type { EvidenceClassification, Provenance } from "@/lib/domain/provenance";
import type { Relationship } from "@/lib/domain/relationship";

import type { DossierSnapshot } from "./load";

/**
 * Deterministic dossier assembly — blueprint task H2.
 *
 * Everything here is a pure function of the persisted snapshot plus the
 * `generatedAt` stamp the caller supplies. There is no `Date.now()`, no
 * randomness, no model call, and no iteration over an unordered
 * structure without an explicit sort, so the same case state always
 * produces byte-identical sections and therefore the same content
 * digest, the same report version, and the same dossier id.
 *
 * `generatedAt` is deliberately excluded from the content digest: when
 * a report is regenerated the wall clock has moved, but the CASE has
 * not, and it is the case the identity is supposed to describe.
 *
 * The assembler never classifies anything itself. Every finding carries
 * the classification and confidence of the row it was read from, and
 * the section it lands in constrains which classifications are even
 * representable (`SECTION_ALLOWED_CLASSIFICATIONS` in
 * src/lib/domain/dossier.ts). Statement wording follows from the
 * classification too: established-fact phrasing is reserved for
 * Observed and Corroborated Facts, and everything else is attributed to
 * the system that produced it (docs/requirements.md §7).
 */

// --- selection limits ---------------------------------------------------

/**
 * A dossier is a briefing, not a database dump: an investigator cannot
 * read 1,820 evidence rows, and a report that tried would bury the
 * findings that matter. Each section therefore reports the strongest N
 * of its kind, in a documented deterministic order, and states the full
 * population it was drawn from so nothing is silently dropped. The full
 * set stays one click away on the existing Evidence / Graph / Analytics
 * / Corroboration screens.
 */
export const SECTION_LIMITS = {
  keyEntities: 12,
  keyRelationships: 15,
  analyticalSignals: 15,
  corroboration: 15,
  contradictions: 20,
  leads: 15,
  copilotClaims: 6,
} as const;

/** Per-array cap on ids carried on a single finding, so one roll-up cannot inline thousands of ids. */
export const MAX_REFERENCED_IDS = 25;

/** Classification strength, strongest first — shared with the Copilot contract's reading rule. */
const CLASSIFICATION_STRENGTH: Record<EvidenceClassification, number> = {
  corroborated_fact: 5,
  observed_fact: 4,
  algorithmic_signal: 3,
  ai_inference: 2,
  investigative_lead: 1,
};

// --- small helpers ------------------------------------------------------

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

/** Deterministic, capped id list: always the lexicographically-first N, never "whatever came back first". */
function capIds(values: readonly string[]): string[] {
  return sortedUnique(values).slice(0, MAX_REFERENCED_IDS);
}

function refs(partial: Partial<DossierReferences>): DossierReferences {
  return {
    evidenceSourceIds: capIds(partial.evidenceSourceIds ?? []),
    evidenceItemIds: capIds(partial.evidenceItemIds ?? []),
    extractedRecordIds: capIds(partial.extractedRecordIds ?? []),
    entityIds: capIds(partial.entityIds ?? []),
    locationIds: capIds(partial.locationIds ?? []),
    resolutionDecisionIds: capIds(partial.resolutionDecisionIds ?? []),
    communicationEventIds: capIds(partial.communicationEventIds ?? []),
    relationshipIds: capIds(partial.relationshipIds ?? []),
    analyticalSignalIds: capIds(partial.analyticalSignalIds ?? []),
    corroborationFindingIds: capIds(partial.corroborationFindingIds ?? []),
  };
}

/**
 * Splits a mixed id list by the deterministic `${kind}_` prefix
 * src/lib/domain/ids.ts stamps on every identifier.
 *
 * Several upstream fields are deliberately heterogeneous: the P5.6
 * analysis graph carries locations as nodes alongside entities (so a
 * community's `memberEntityIds` or a signal's `targetEntityId` may be
 * either), and a P5.7 finding's `supportingRecordIds` mixes
 * `communication_events` rows with `extracted_records` rows. Filing
 * them all under one reference array would make an id that cannot
 * resolve look as though it had — the exact class of untraceable claim
 * the report is supposed to make impossible.
 */
function partitionNodeIds(ids: readonly string[]): { entityIds: string[]; locationIds: string[] } {
  return {
    entityIds: ids.filter((id) => isIdOfKind(id, "entity")),
    locationIds: ids.filter((id) => isIdOfKind(id, "location")),
  };
}

function partitionSupportingRecordIds(
  ids: readonly string[],
): { extractedRecordIds: string[]; communicationEventIds: string[] } {
  return {
    extractedRecordIds: ids.filter((id) => isIdOfKind(id, "extracted_record")),
    communicationEventIds: ids.filter((id) => isIdOfKind(id, "communication_event")),
  };
}

/**
 * Provenance for an assembled finding. The upstream row's own
 * processing history is carried forward and this stage appended, so the
 * chain back to source evidence stays reconstructable —
 * docs/requirements.md §8: provenance "may be aggregated or referenced,
 * but the underlying chain must remain reconstructable".
 */
function findingProvenance(args: {
  source: string;
  location: string;
  method: string;
  confidence: number;
  upstreamHistory: readonly string[];
  generatedAt: string;
}): Provenance {
  return {
    source: args.source,
    location: args.location,
    method: args.method,
    confidence: args.confidence,
    processingHistory: [...args.upstreamHistory, "dossier:assemble"],
    timestamp: args.generatedAt,
  };
}

function findingId(sectionKind: DossierSectionKind, parts: readonly string[], graphVersion: string): string {
  return makeContentId("dossier_finding", [sectionKind, ...parts, graphVersion]);
}

function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}

function labelOf(entityById: Map<string, Entity>, id: string): string {
  return entityById.get(id)?.canonicalLabel ?? id;
}

function numberFrom(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

// --- sections -----------------------------------------------------------

function caseSummarySection(s: DossierSnapshot): DossierSection {
  const accepted = s.evidenceItems.filter((i) => i.validationStatus === "accepted").length;
  const rejected = s.evidenceItems.length - accepted;
  const contradictions = s.corroborationFindings.filter(
    (f) => f.findingType === "spatiotemporal_contradiction",
  ).length;
  const corroborated = s.corroborationFindings.filter((f) => f.classification === "corroborated_fact").length;
  const ambiguous = s.resolutionDecisions.filter((d) => d.status === "ambiguous").length;

  return {
    kind: "case_summary",
    title: "Case summary",
    summary:
      `${s.investigationName} is a synthetic investigation assembled from ${s.evidenceItems.length.toLocaleString("en-US")} ` +
      `evidence ${plural(s.evidenceItems.length, "item")} across ${s.evidenceSources.length} ${plural(s.evidenceSources.length, "source")}. ` +
      `Extraction produced ${s.extractedRecords.length.toLocaleString("en-US")} structured ${plural(s.extractedRecords.length, "record")}, ` +
      `entity resolution produced ${s.entities.length} resolved ${plural(s.entities.length, "entity", "entities")}, ` +
      `and graph synthesis produced ${s.relationships.length} ${plural(s.relationships.length, "relationship")}. ` +
      `Against graph version ${s.graphVersion} the case carries ${s.analyticalSignals.length} analytical ${plural(s.analyticalSignals.length, "signal")}, ` +
      `${corroborated} corroborated ${plural(corroborated, "finding")}, and ${contradictions} flagged ${plural(contradictions, "contradiction")}.`,
    sourceStages: [
      "P5.2 evidence ingestion",
      "P5.3 extraction",
      "P5.4 entity resolution",
      "P5.5 graph synthesis",
      "P5.6 topology analytics",
      "P5.7 spatial/temporal corroboration",
    ],
    findings: [],
    notes: [
      `Investigation id: ${s.investigationId} · status: ${s.investigationStatus}.`,
      `Graph version this report describes: ${s.graphVersion}. Every derived finding below was computed against exactly this graph state.`,
      `Evidence acceptance: ${accepted.toLocaleString("en-US")} accepted, ${rejected.toLocaleString("en-US")} not accepted.`,
      `${ambiguous} entity ${plural(ambiguous, "mention")} could not be resolved unambiguously and ${ambiguous === 1 ? "is" : "are"} carried into the leads section rather than merged.`,
      "Synthetic data only — every person, phone, account, vehicle, location and event in this case is fabricated. No real investigation, individual, or record is represented.",
      "This report is decision support for a human reviewer. Nothing in it is a finished investigative conclusion.",
    ],
  };
}

function evidenceInventorySection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const itemsBySource = new Map<string, typeof s.evidenceItems>();
  for (const item of s.evidenceItems) {
    const bucket = itemsBySource.get(item.evidenceSourceId);
    if (bucket) bucket.push(item);
    else itemsBySource.set(item.evidenceSourceId, [item]);
  }

  const sources = [...s.evidenceSources].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const findings: DossierFinding[] = sources.map((source) => {
    const items = itemsBySource.get(source.id) ?? [];
    const accepted = items.filter((i) => i.validationStatus === "accepted").length;
    const rejected = items.length - accepted;
    const meanConfidence =
      items.length === 0 ? 1 : items.reduce((sum, i) => sum + i.confidence, 0) / items.length;

    return {
      id: findingId("evidence_inventory", [source.id], s.graphVersion),
      sectionKind: "evidence_inventory",
      // Observed fact: this is a count of rows that are actually in the
      // store, not an interpretation of them.
      statement:
        `${source.label} (${source.sourceType.replace(/_/g, " ")}) contributed ${items.length.toLocaleString("en-US")} evidence ` +
        `${plural(items.length, "item")} — ${accepted.toLocaleString("en-US")} accepted, ${rejected.toLocaleString("en-US")} not accepted.`,
      classification: "observed_fact",
      // A count of persisted rows is exact; the ingestion confidence of
      // the items themselves is reported in the explanation instead of
      // being conflated with it.
      confidence: 1,
      derivationMethod: "dossier:evidence_inventory",
      explanation:
        `Counted directly from the persisted evidence_items rows carrying evidence_source_id ${source.id}, ingested ${source.ingestedAt}. ` +
        `Mean per-item ingestion confidence ${meanConfidence.toFixed(2)}. ` +
        `${Math.min(items.length, MAX_REFERENCED_IDS)} of ${items.length.toLocaleString("en-US")} item ids are listed as references; the full set is on the Evidence screen.`,
      references: refs({
        evidenceSourceIds: [source.id],
        evidenceItemIds: items.map((i) => i.id),
      }),
      provenance: findingProvenance({
        source: source.id,
        location: `evidence_sources/${source.id}`,
        method: "dossier:evidence_inventory",
        confidence: 1,
        upstreamHistory: [`ingestion:${source.sourceType}`],
        generatedAt,
      }),
    };
  });

  return {
    kind: "evidence_inventory",
    title: "Evidence inventory",
    summary:
      `The case rests on ${s.evidenceItems.length.toLocaleString("en-US")} evidence ${plural(s.evidenceItems.length, "item")} ` +
      `drawn from ${sources.length} ${plural(sources.length, "source")}. Each row below is a direct count of persisted evidence, not an interpretation of it.`,
    sourceStages: ["P5.2 evidence ingestion"],
    findings,
    notes: [
      "Every item was labelled synthetic at ingestion and carries its own provenance (source, location, method, confidence, processing history, timestamp).",
      "An item that failed validation was rejected with a specific reason and never entered extraction; rejection does not remove it from this inventory.",
    ],
  };
}

function keyEntitiesSection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const entityById = new Map(s.entities.map((e) => [e.id, e]));

  const aliasesByEntity = new Map<string, string[]>();
  for (const alias of s.aliases) {
    const bucket = aliasesByEntity.get(alias.entityId);
    if (bucket) bucket.push(alias.aliasValue);
    else aliasesByEntity.set(alias.entityId, [alias.aliasValue]);
  }

  const decisionsByEntity = new Map<string, typeof s.resolutionDecisions>();
  for (const decision of s.resolutionDecisions) {
    const bucket = decisionsByEntity.get(decision.canonicalEntityId);
    if (bucket) bucket.push(decision);
    else decisionsByEntity.set(decision.canonicalEntityId, [decision]);
  }

  const edgeCount = new Map<string, number>();
  for (const rel of s.relationships) {
    edgeCount.set(rel.sourceEntityId, (edgeCount.get(rel.sourceEntityId) ?? 0) + 1);
    edgeCount.set(rel.targetEntityId, (edgeCount.get(rel.targetEntityId) ?? 0) + 1);
  }

  // Ordered by the P5.6 investigative ranking — the dossier reuses that
  // ordering rather than inventing a second, competing notion of
  // "important", which would be a new analysis rather than a report.
  const ranking = s.analyticalSignals
    .filter((sig) => sig.signalType === "ranking" && sig.targetEntityId)
    .map((sig) => ({
      signal: sig,
      entityId: sig.targetEntityId as string,
      rank: numberFrom(sig.value.rank) ?? Number.MAX_SAFE_INTEGER,
      score: numberFrom(sig.value.score) ?? 0,
    }))
    .filter((r) => entityById.has(r.entityId))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.entityId < b.entityId ? -1 : 1))
    .slice(0, SECTION_LIMITS.keyEntities);

  const findings: DossierFinding[] = ranking.map(({ signal, entityId, rank, score }) => {
    const entity = entityById.get(entityId) as Entity;
    const aliases = sortedUnique(aliasesByEntity.get(entityId) ?? []);
    const decisions = (decisionsByEntity.get(entityId) ?? []).slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const mergeConfidence =
      decisions.length === 0
        ? signal.provenance.confidence
        : decisions.reduce((min, d) => Math.min(min, d.provenance.confidence), 1);
    const mentionCount = decisions.reduce((n, d) => n + d.extractedRecordIds.length, 0);

    return {
      id: findingId("key_entities", [entityId], s.graphVersion),
      sectionKind: "key_entities",
      // Attributed, never asserted: an entity is entity resolution's
      // conclusion about identity, not a directly observed fact.
      statement:
        `The system resolves ${entity.canonicalLabel} (${entity.kind.replace(/_/g, " ")}) as a single identity` +
        `${aliases.length > 0 ? `, also appearing as ${aliases.slice(0, 4).join(", ")}${aliases.length > 4 ? ` and ${aliases.length - 4} more` : ""}` : ""}` +
        `, drawn from ${mentionCount} source ${plural(mentionCount, "mention")} and carrying ${edgeCount.get(entityId) ?? 0} graph ${plural(edgeCount.get(entityId) ?? 0, "relationship")}.`,
      classification: "ai_inference",
      confidence: mergeConfidence,
      derivationMethod: "dossier:key_entities",
      explanation:
        `Selected as rank ${rank} of the P5.6 investigative ranking (score ${score.toFixed(4)}), which combines betweenness centrality, degree centrality and bridge score — ` +
        `a statement about network position, never about involvement. Identity comes from ${decisions.length} P5.4 resolution ${plural(decisions.length, "decision")}; ` +
        `confidence shown is the weakest of those merges. ${decisions[0]?.reason ?? "No merge rationale recorded."}`,
      references: refs({
        entityIds: [entityId],
        resolutionDecisionIds: decisions.map((d) => d.id),
        extractedRecordIds: decisions.flatMap((d) => d.extractedRecordIds),
        analyticalSignalIds: [signal.id],
      }),
      provenance: findingProvenance({
        source: entityId,
        location: `entities/${entityId}`,
        method: "dossier:key_entities",
        confidence: mergeConfidence,
        upstreamHistory: [...entity.provenance.processingHistory, `analytics:ranking:${signal.id}`],
        generatedAt,
      }),
    };
  });

  return {
    kind: "key_entities",
    title: "Key entities",
    summary:
      `${findings.length} of ${s.entities.length} resolved ${plural(s.entities.length, "entity", "entities")} are shown, ordered by the structural ranking computed in analytics. ` +
      `Each is an inferred identity — the system's conclusion about which mentions refer to the same synthetic subject, not a directly observed fact.`,
    sourceStages: ["P5.4 entity resolution", "P5.6 topology analytics"],
    findings,
    notes: [
      "Every entity here is an AI Inference by the project's own definition: entity resolution goes beyond what any single source directly states, however deterministic the matching rule was.",
      "Confidence shown is the weakest merge confidence contributing to that identity, so an identity is never presented as better established than its shakiest merge.",
      "Ordering reflects position in the network only. A high rank is not an allegation.",
    ],
  };
}

function keyRelationshipsSection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const entityById = new Map(s.entities.map((e) => [e.id, e]));

  const ranked = [...s.relationships].sort((a, b) => {
    const strength = CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification];
    if (strength !== 0) return strength;
    const evidence = b.evidenceItemIds.length - a.evidenceItemIds.length;
    if (evidence !== 0) return evidence;
    const events = (numberFrom(b.attributes.eventCount) ?? 0) - (numberFrom(a.attributes.eventCount) ?? 0);
    if (events !== 0) return events;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const selected = ranked.slice(0, SECTION_LIMITS.keyRelationships);

  const findings: DossierFinding[] = selected.map((rel: Relationship) => {
    const from = labelOf(entityById, rel.sourceEntityId);
    const to = labelOf(entityById, rel.targetEntityId);
    const type = rel.relationshipType.replace(/_/g, " ");
    const eventCount = numberFrom(rel.attributes.eventCount);
    const asserted = rel.classification === "observed_fact" || rel.classification === "corroborated_fact";

    return {
      id: findingId("key_relationships", [rel.id], s.graphVersion),
      sectionKind: "key_relationships",
      statement: asserted
        ? `${from} and ${to} are linked by a ${type} relationship recorded in ${rel.evidenceItemIds.length} distinct evidence ${plural(rel.evidenceItemIds.length, "item")}` +
          `${eventCount !== null ? ` across ${eventCount.toLocaleString("en-US")} ${plural(eventCount, "event")}` : ""}.`
        : `The system infers a ${type} relationship between ${from} and ${to} from ${rel.evidenceItemIds.length} evidence ${plural(rel.evidenceItemIds.length, "item")}` +
          `${eventCount !== null ? ` across ${eventCount.toLocaleString("en-US")} ${plural(eventCount, "event")}` : ""}; it is not directly stated by any single source.`,
      classification: rel.classification,
      confidence: rel.provenance.confidence,
      derivationMethod: rel.provenance.method,
      explanation:
        `Graph edge ${rel.id} (${rel.directed ? "directed" : "undirected"}), synthesized in P5.5 from ${rel.extractedRecordIds.length} extracted ${plural(rel.extractedRecordIds.length, "record")}. ` +
        `Classified ${rel.classification.replace(/_/g, " ")} because ${
          rel.classification === "corroborated_fact"
            ? "two or more distinct evidence items independently support it"
            : rel.classification === "observed_fact"
              ? "a single source states it directly"
              : "it was derived from correlated activity rather than stated by a source"
        }.` +
        `${rel.conflicts.length > 0 ? ` ${rel.conflicts.length} conflict ${plural(rel.conflicts.length, "flag")} recorded on this edge — see the leads section.` : ""}`,
      references: refs({
        relationshipIds: [rel.id],
        // A co_location edge's target is a location, not an entity.
        ...partitionNodeIds([rel.sourceEntityId, rel.targetEntityId]),
        evidenceItemIds: rel.evidenceItemIds,
        extractedRecordIds: rel.extractedRecordIds,
      }),
      provenance: findingProvenance({
        source: rel.id,
        location: `relationships/${rel.id}`,
        method: "dossier:key_relationships",
        confidence: rel.provenance.confidence,
        upstreamHistory: rel.provenance.processingHistory,
        generatedAt,
      }),
    };
  });

  const byClass = new Map<EvidenceClassification, number>();
  for (const rel of s.relationships) byClass.set(rel.classification, (byClass.get(rel.classification) ?? 0) + 1);

  return {
    kind: "key_relationships",
    title: "Key relationships",
    summary:
      `${findings.length} of ${s.relationships.length} ${plural(s.relationships.length, "relationship")} are shown, strongest evidence first. ` +
      `Each edge carries its own classification: some are stated directly by a source, some are independently corroborated, and some are inferred from correlated activity.`,
    sourceStages: ["P5.5 graph synthesis"],
    findings,
    notes: [
      `Across the whole graph: ${[...byClass.entries()]
        .sort((a, b) => CLASSIFICATION_STRENGTH[b[0]] - CLASSIFICATION_STRENGTH[a[0]])
        .map(([c, n]) => `${n} ${c.replace(/_/g, " ")}`)
        .join(", ")}.`,
      "An inferred edge is the system's conclusion from correlated data, not something any source states. It is labelled AI Inference and must be verified before being relied on.",
      "Ordering is by classification strength, then by how many distinct evidence items support the edge — never by how interesting the edge looks.",
    ],
  };
}

function analyticalSignalsSection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const entityById = new Map(s.entities.map((e) => [e.id, e]));

  // Bridges first (the structurally most informative signal), then
  // communities, then the strongest centrality scores.
  const rank = (signalType: string): number =>
    signalType === "bridge" ? 0 : signalType === "community" ? 1 : signalType === "centrality" ? 2 : 3;

  const selected = s.analyticalSignals
    .filter((sig) => sig.signalType !== "ranking")
    .sort((a, b) => {
      const byType = rank(a.signalType) - rank(b.signalType);
      if (byType !== 0) return byType;
      const scoreA = numberFrom(a.value.bridgeScore) ?? numberFrom(a.value.size) ?? numberFrom(a.value.score) ?? 0;
      const scoreB = numberFrom(b.value.bridgeScore) ?? numberFrom(b.value.size) ?? numberFrom(b.value.score) ?? 0;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, SECTION_LIMITS.analyticalSignals);

  const findings: DossierFinding[] = selected.map((sig) => {
    const target = sig.targetEntityId ? labelOf(entityById, sig.targetEntityId) : null;
    const supportingEdgeIds = stringArrayFrom(sig.value.supportingEdgeIds ?? sig.value.internalEdgeIds);
    const memberIds = stringArrayFrom(sig.value.memberEntityIds);

    let statement: string;
    if (sig.signalType === "bridge") {
      const before = numberFrom(sig.value.componentsBefore) ?? 0;
      const after = numberFrom(sig.value.componentsAfter) ?? 0;
      statement =
        `The system computes ${target ?? "this node"} as a structural bridge: removing it would split the network from ` +
        `${before} into ${after} connected ${plural(after, "component")}.`;
    } else if (sig.signalType === "community") {
      const size = numberFrom(sig.value.size) ?? memberIds.length;
      const representatives = stringArrayFrom(sig.value.representativeEntityIds)
        .slice(0, 3)
        .map((id) => labelOf(entityById, id));
      statement =
        `The system detects a structural grouping of ${size} ${plural(size, "entity", "entities")}` +
        `${representatives.length > 0 ? `, including ${representatives.join(", ")}` : ""}. ` +
        `This is a modularity cluster in the graph, not an identified organization.`;
    } else {
      const score = numberFrom(sig.value.score) ?? 0;
      statement =
        `The system computes a ${sig.method.replace("analytics:", "").replace(/_/g, " ")} score of ${score.toFixed(4)} for ` +
        `${target ?? "this node"} — a description of its position in the graph, not a claim about it.`;
    }

    return {
      id: findingId("analytical_signals", [sig.id], s.graphVersion),
      sectionKind: "analytical_signals",
      statement,
      // Fixed by the analytics contract: a topology calculation
      // describes the graph and is never itself a claim about the world.
      classification: "algorithmic_signal",
      confidence: sig.provenance.confidence,
      derivationMethod: sig.method,
      explanation: `${sig.explanation} Computed against graph version ${sig.graphVersion}.`,
      references: refs({
        analyticalSignalIds: [sig.id],
        ...partitionNodeIds([...(sig.targetEntityId ? [sig.targetEntityId] : []), ...memberIds]),
        relationshipIds: supportingEdgeIds,
      }),
      provenance: findingProvenance({
        source: sig.id,
        location: `analytical_signals/${sig.id}`,
        method: "dossier:analytical_signals",
        confidence: sig.provenance.confidence,
        upstreamHistory: sig.provenance.processingHistory,
        generatedAt,
      }),
    };
  });

  return {
    kind: "analytical_signals",
    title: "Analytical signals",
    summary:
      `${findings.length} of ${s.analyticalSignals.length} topology ${plural(s.analyticalSignals.length, "signal")} computed against graph version ${s.graphVersion} are shown. ` +
      `Every one of them describes the shape of the data. None of them is a claim about a person.`,
    sourceStages: ["P5.6 topology analytics"],
    findings,
    notes: [
      "All signals are Algorithmic Signals and remain so throughout this report. A centrality score, a bridge, or a community is a property of the graph — it can never be read as evidence of conduct.",
      "A signal is only as good as the graph it was computed over; an edge missing from the graph is missing from every signal too.",
    ],
  };
}

function corroborationSection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const entityById = new Map(s.entities.map((e) => [e.id, e]));

  const nonContradictions = s.corroborationFindings.filter(
    (f) => f.findingType !== "spatiotemporal_contradiction",
  );

  const selected = [...nonContradictions]
    .sort((a, b) => {
      const strength = CLASSIFICATION_STRENGTH[b.classification] - CLASSIFICATION_STRENGTH[a.classification];
      if (strength !== 0) return strength;
      const evidence = b.evidenceItemIds.length - a.evidenceItemIds.length;
      if (evidence !== 0) return evidence;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, SECTION_LIMITS.corroboration);

  const findings: DossierFinding[] = selected.map((f: CorroborationFinding) => {
    const subjects = f.entityIds.map((id) => labelOf(entityById, id));
    const corroborated = f.classification === "corroborated_fact";

    return {
      id: findingId("corroboration", [f.id], s.graphVersion),
      sectionKind: "corroboration",
      statement: corroborated
        ? `${subjects.join(" and ")} ${subjects.length === 1 ? "is" : "are"} independently placed together by ${f.evidenceItemIds.length} distinct evidence ${plural(f.evidenceItemIds.length, "item")}` +
          `${f.window ? ` within the window starting ${f.window.start}` : ""}.`
        : `The system computes a ${f.findingType.replace(/_/g, " ")} involving ${subjects.length > 0 ? subjects.join(" and ") : "persisted case locations"}` +
          `${f.window ? ` within the window starting ${f.window.start}` : ""}. This describes where and when activity was recorded — it is not a claim that anyone was together, in contact, or acting in concert.`,
      classification: f.classification,
      confidence: f.provenance.confidence,
      derivationMethod: f.method,
      explanation:
        `${f.explanation} ${
          corroborated
            ? `Raised to Corroborated Fact because ${f.evidenceItemIds.length} independent evidence items agree.`
            : "Remains an Algorithmic Signal: it was derived by computation rather than independently attested."
        }`,
      references: refs({
        corroborationFindingIds: [f.id],
        entityIds: f.entityIds,
        locationIds: f.locationIds,
        evidenceItemIds: f.evidenceItemIds,
        ...partitionSupportingRecordIds(f.supportingRecordIds),
      }),
      provenance: findingProvenance({
        source: f.id,
        location: `corroboration_findings/${f.id}`,
        method: "dossier:corroboration",
        confidence: f.provenance.confidence,
        upstreamHistory: f.provenance.processingHistory,
        generatedAt,
      }),
    };
  });

  const corroboratedTotal = nonContradictions.filter((f) => f.classification === "corroborated_fact").length;

  return {
    kind: "corroboration",
    title: "Spatial & temporal corroboration",
    summary:
      `${findings.length} of ${nonContradictions.length} corroboration ${plural(nonContradictions.length, "finding")} are shown, ` +
      `${corroboratedTotal} of which reach Corroborated Fact through independent multi-source agreement. The remainder are computed overlaps and stay Algorithmic Signals.`,
    sourceStages: ["P5.7 spatial/temporal corroboration"],
    findings,
    notes: [
      "A Corroborated Fact here means two or more distinct evidence items agree — that raises confidence in what was recorded, not in what it means.",
      "Shared location or shared time window is never treated as contact, association, or causation. Two people at the same tower in the same half hour is exactly that and nothing more.",
    ],
  };
}

function contradictionsSection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const entityById = new Map(s.entities.map((e) => [e.id, e]));

  const contradictions = s.corroborationFindings
    .filter((f) => f.findingType === "spatiotemporal_contradiction")
    .sort((a, b) => {
      const speedA = numberFrom(a.value.impliedSpeedMps) ?? 0;
      const speedB = numberFrom(b.value.impliedSpeedMps) ?? 0;
      if (speedA !== speedB) return speedB - speedA;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, SECTION_LIMITS.contradictions);

  const findings: DossierFinding[] = contradictions.map((f) => {
    const subject = f.entityIds.map((id) => labelOf(entityById, id)).join(", ") || "an unresolved subject";
    const speed = numberFrom(f.value.impliedSpeedMps);

    return {
      id: findingId("contradictions", [f.id], s.graphVersion),
      sectionKind: "contradictions",
      statement:
        `Two sources cannot both be right about ${subject}: their recorded placements imply a travel speed of ` +
        `${speed !== null ? `${speed.toFixed(1)} m/s` : "an implausible magnitude"}, above the plausibility ceiling. ` +
        `Both records are cited; neither is presumed correct.`,
      // A flagged inconsistency is never itself a fact — enforced by both
      // the corroboration contract and this section's allowed set.
      classification: "algorithmic_signal",
      confidence: f.provenance.confidence,
      derivationMethod: f.method,
      explanation: `${f.explanation} This conflict is reported, not resolved: the dossier does not choose a side, and neither source has been discarded.`,
      references: refs({
        corroborationFindingIds: [f.id],
        entityIds: f.entityIds,
        locationIds: f.locationIds,
        evidenceItemIds: f.evidenceItemIds,
        ...partitionSupportingRecordIds(f.supportingRecordIds),
      }),
      provenance: findingProvenance({
        source: f.id,
        location: `corroboration_findings/${f.id}`,
        method: "dossier:contradictions",
        confidence: f.provenance.confidence,
        upstreamHistory: f.provenance.processingHistory,
        generatedAt,
      }),
    };
  });

  const edgeConflicts = s.relationships.filter((r) => r.conflicts.length > 0).length;
  const ambiguous = s.resolutionDecisions.filter((d) => d.status === "ambiguous").length;
  const total = s.corroborationFindings.filter((f) => f.findingType === "spatiotemporal_contradiction").length;

  return {
    kind: "contradictions",
    title: "Contradictions",
    summary:
      total === 0
        ? "No spatial or temporal contradiction was detected between sources at this graph version. That is the result of a check that ran, not an absence of checking."
        : `${findings.length} of ${total} detected ${plural(total, "contradiction")} are shown, most severe first. Each is reported as a conflict and left unresolved.`,
    sourceStages: ["P5.7 spatial/temporal corroboration"],
    findings,
    notes: [
      "A contradiction is always an Algorithmic Signal. Flagging that two sources disagree is not itself a finding of fact about either of them, and this report never silently resolves one in favour of the other.",
      `Source-level conflict flags recorded elsewhere in the pipeline — ${edgeConflicts} on graph ${plural(edgeConflicts, "edge")} and ${ambiguous} ambiguous entity ${plural(ambiguous, "resolution")} — are surfaced as human-verification items in the leads section rather than reclassified as contradictions here.`,
    ],
  };
}

function investigativeLeadsSection(s: DossierSnapshot, generatedAt: string): DossierSection {
  const entityById = new Map(s.entities.map((e) => [e.id, e]));
  const candidates: DossierFinding[] = [];

  // (a) Ambiguous identity — the mention was NOT merged, and a human
  //     has to decide. Surfacing this is the whole point of Agent 2's
  //     "surface, never force-merge" rule.
  const ambiguous = [...s.resolutionDecisions]
    .filter((d) => d.status === "ambiguous")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const decision of ambiguous) {
    const subject = labelOf(entityById, decision.canonicalEntityId);
    const others = decision.candidateEntityIds.map((id) => labelOf(entityById, id));
    candidates.push({
      id: findingId("investigative_leads", ["ambiguity", decision.id], s.graphVersion),
      sectionKind: "investigative_leads",
      statement:
        `Verify which identity "${subject}" refers to: the same name also matches ${others.length} other resolved ` +
        `${plural(others.length, "entity", "entities")}${others.length > 0 ? ` (${others.slice(0, 3).join(", ")}${others.length > 3 ? ", …" : ""})` : ""}. ` +
        `The system deliberately did not merge them.`,
      classification: "investigative_lead",
      confidence: decision.provenance.confidence,
      derivationMethod: "dossier:leads:ambiguous_resolution",
      explanation: `P5.4 recorded this mention as ${decision.resolutionType.replace(/_/g, " ")}: ${decision.reason} A lead is a prompt to check, never a claim of fact at any confidence.`,
      references: refs({
        resolutionDecisionIds: [decision.id],
        entityIds: [decision.canonicalEntityId, ...decision.candidateEntityIds],
        extractedRecordIds: decision.extractedRecordIds,
      }),
      provenance: findingProvenance({
        source: decision.id,
        location: `resolution_decisions/${decision.id}`,
        method: "dossier:leads:ambiguous_resolution",
        confidence: decision.provenance.confidence,
        upstreamHistory: decision.provenance.processingHistory,
        generatedAt,
      }),
    });
  }

  // (b) Conflict flags recorded on a graph edge.
  const conflicted = [...s.relationships]
    .filter((r) => r.conflicts.length > 0)
    .sort((a, b) => (b.conflicts.length !== a.conflicts.length ? b.conflicts.length - a.conflicts.length : a.id < b.id ? -1 : 1));
  for (const rel of conflicted) {
    candidates.push({
      id: findingId("investigative_leads", ["edge_conflict", rel.id], s.graphVersion),
      sectionKind: "investigative_leads",
      statement:
        `Review the ${rel.conflicts.length} conflict ${plural(rel.conflicts.length, "flag")} recorded on the ${rel.relationshipType.replace(/_/g, " ")} link between ` +
        `${labelOf(entityById, rel.sourceEntityId)} and ${labelOf(entityById, rel.targetEntityId)}: ${rel.conflicts.slice(0, 2).join("; ")}`,
      classification: "investigative_lead",
      confidence: rel.provenance.confidence,
      derivationMethod: "dossier:leads:edge_conflict",
      explanation: `P5.5 attached these conflict flags while synthesizing edge ${rel.id}; they were never resolved automatically. A lead is a prompt to check, never a claim of fact at any confidence.`,
      references: refs({
        relationshipIds: [rel.id],
        ...partitionNodeIds([rel.sourceEntityId, rel.targetEntityId]),
        evidenceItemIds: rel.evidenceItemIds,
      }),
      provenance: findingProvenance({
        source: rel.id,
        location: `relationships/${rel.id}`,
        method: "dossier:leads:edge_conflict",
        confidence: rel.provenance.confidence,
        upstreamHistory: rel.provenance.processingHistory,
        generatedAt,
      }),
    });
  }

  // (c) Each detected contradiction is also a thing a human must settle.
  const contradictions = s.corroborationFindings
    .filter((f) => f.findingType === "spatiotemporal_contradiction")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const f of contradictions) {
    const subject = f.entityIds.map((id) => labelOf(entityById, id)).join(", ") || "the flagged subject";
    candidates.push({
      id: findingId("investigative_leads", ["contradiction", f.id], s.graphVersion),
      sectionKind: "investigative_leads",
      statement: `Establish which of the two conflicting placements for ${subject} is correct — the system has flagged the conflict but cannot settle it.`,
      classification: "investigative_lead",
      confidence: f.provenance.confidence,
      derivationMethod: "dossier:leads:contradiction",
      explanation: `Arises from corroboration finding ${f.id}. Resolving it requires going back to the two source records; the system will not choose between them. A lead is a prompt to check, never a claim of fact at any confidence.`,
      references: refs({
        corroborationFindingIds: [f.id],
        entityIds: f.entityIds,
        evidenceItemIds: f.evidenceItemIds,
      }),
      provenance: findingProvenance({
        source: f.id,
        location: `corroboration_findings/${f.id}`,
        method: "dossier:leads:contradiction",
        confidence: f.provenance.confidence,
        upstreamHistory: f.provenance.processingHistory,
        generatedAt,
      }),
    });
  }

  const findings = candidates.slice(0, SECTION_LIMITS.leads);

  return {
    kind: "investigative_leads",
    title: "Investigative leads & human verification",
    summary:
      candidates.length === 0
        ? "No ambiguity, edge conflict, or contradiction requiring human verification was recorded at this graph version."
        : `${findings.length} of ${candidates.length} ${plural(candidates.length, "item")} requiring human verification are shown: unresolved identity ambiguities, conflict flags on graph edges, and detected contradictions.`,
    sourceStages: ["P5.4 entity resolution", "P5.5 graph synthesis", "P5.7 spatial/temporal corroboration"],
    findings,
    notes: [
      "Every item here is an Investigative Lead: a suggestion for further work, explicitly not a claim of fact at any confidence level (docs/requirements.md §7).",
      "The confidence shown on a lead is carried from the record that raised it and describes how firmly the system flags it as worth checking — never how likely anything is to be true.",
      "Nothing in this section has been acted on, resolved, or decided by the system.",
    ],
  };
}

function provenanceIndexSection(s: DossierSnapshot, methods: readonly string[]): DossierSection {
  return {
    kind: "provenance_index",
    title: "Provenance & traceability",
    summary:
      "Every substantive finding in this report resolves to persisted records. No finding was generated without at least one reference, and none of them inlines a copy of the evidence it cites.",
    sourceStages: ["P5.9 dossier assembly"],
    findings: [],
    notes: [
      "Each finding lists the ids it rests on — evidence sources, evidence items, extracted records, entities, resolution decisions, relationships, analytical signals and corroboration findings — and each of those ids resolves to a live row through the existing Evidence, Graph, Analytics and Corroboration screens.",
      "Each finding also carries the six required provenance fields: source, location/reference, derivation method, confidence, processing history, and timestamp (docs/requirements.md §8).",
      `The processing history on every finding ends with "dossier:assemble", preceded by the upstream chain of the row it was read from — so the path back to source evidence stays reconstructable.`,
      `Derivation methods used in this report: ${methods.join(", ")}.`,
      `All derived findings were computed against graph version ${s.graphVersion}. A finding stamped with any other graph version is stale by definition and is not included.`,
    ],
  };
}

function classificationSection(
  s: DossierSnapshot,
  byClassification: Record<EvidenceClassification, number>,
): DossierSection {
  const census = Object.entries(byClassification)
    .filter(([, n]) => n > 0)
    .sort(
      (a, b) =>
        CLASSIFICATION_STRENGTH[b[0] as EvidenceClassification] -
        CLASSIFICATION_STRENGTH[a[0] as EvidenceClassification],
    )
    .map(([c, n]) => `${n} ${c.replace(/_/g, " ")}`)
    .join(", ");

  return {
    kind: "classification_confidence",
    title: "Classification & confidence",
    summary: `Every finding in this report carries exactly one evidence classification and its own confidence. Census: ${census || "no findings"}.`,
    sourceStages: ["P5.9 dossier assembly"],
    findings: [],
    notes: [
      "Observed Fact — stated directly in a single source, with no inference applied.",
      "Corroborated Fact — an observed fact independently supported by two or more distinct sources, or by spatial/temporal corroboration.",
      "Algorithmic Signal — the output of an analytical method. It describes the data; it is not a claim about the world.",
      "AI Inference — a conclusion that goes beyond directly observed evidence. Provisional; must be verified.",
      "Investigative Lead — a suggestion for further investigation. Explicitly not a claim of fact at any confidence level.",
      "Confidence is a value from 0 to 1 and is kept separate from classification on purpose: classification says what kind of claim this is, confidence says how sure the system is of it. A high confidence does not upgrade an inference into a fact.",
      "Read any group of findings at the level of its weakest classification. Established-fact wording in this report is reserved for Observed and Corroborated Facts; everything else is attributed to the system that produced it.",
      `This report describes graph version ${s.graphVersion} only.`,
    ],
  };
}

function limitationsSection(limitations: readonly string[]): DossierSection {
  return {
    kind: "limitations",
    title: "Limitations & non-conclusions",
    summary: "What this report does not establish. These limits are part of the report, not a disclaimer attached to it.",
    sourceStages: ["P5.9 dossier assembly"],
    findings: [],
    notes: [...limitations],
  };
}

function buildLimitations(s: DossierSnapshot, aiSynthesisAvailable: boolean): string[] {
  const ambiguous = s.resolutionDecisions.filter((d) => d.status === "ambiguous").length;
  const contradictions = s.corroborationFindings.filter(
    (f) => f.findingType === "spatiotemporal_contradiction",
  ).length;

  return [
    "This case is entirely synthetic. Every person, phone, account, vehicle, location, transaction and event in it is fabricated, and no real investigation, individual, agency or record is represented or implied.",
    "This report is decision support for a human reviewer. It establishes nothing on its own and is not a finished investigative conclusion, a charging document, or a basis for action.",
    "The report describes what the system extracted, resolved, connected, computed and corroborated. It does not establish that any of the underlying evidence is true — only what the evidence says and where the sources agree or conflict.",
    "Entity identities are inferences. Where mentions were merged, the merge is the system's conclusion; where they were ambiguous the system declined to merge and flagged them instead" +
      `${ambiguous > 0 ? ` (${ambiguous} such ${plural(ambiguous, "mention")} in this case)` : ""}.`,
    "Analytical signals describe the structure of the graph. Centrality, bridging and community membership are properties of the data and can never be read as evidence of conduct or involvement.",
    "Co-location and temporal overlap are not contact, association, or causation. Two subjects recorded at the same place or in the same time window is precisely that, and nothing more.",
    `Contradictions are reported and left unresolved${contradictions > 0 ? ` (${contradictions} in this case)` : ""}. The system does not decide which of two conflicting sources is correct, and including a contradiction here is not a judgement against either source.`,
    `This report describes graph version ${s.graphVersion} and no other. If the graph is re-synthesized, the report becomes stale and must be regenerated rather than re-read.`,
    "Sections show the strongest findings of their kind, in a documented deterministic order, with the full population stated. The full sets remain available on the Evidence, Graph, Analytics and Corroboration screens; nothing was discarded, only not printed here.",
    aiSynthesisAvailable
      ? "Copilot material in this report was worded by a language model over a deterministically retrieved, guardrail-checked claim set. The grounding, citations, classifications and confidences are not model-authored; only the wording is."
      : "No AI provider key was configured for this report, so no AI synthesis was performed. Copilot material, where present, uses the deterministic narration of the same grounded claim set — no model output was generated, and none was invented in its place.",
    "The evaluation ground truth for this synthetic case is deliberately held out of the reporting path. Nothing in this report was checked against, or informed by, the answer key.",
  ];
}

// --- digest & identity ---------------------------------------------------

/**
 * Content digest over the deterministic body only.
 *
 * Excluded on purpose: `generatedAt` and every provenance timestamp
 * (wall-clock movement is not a change to the case), and the Copilot
 * excerpts (their wording depends on whether a model was reachable,
 * which is a property of the environment, not of the evidence). What IS
 * included is every finding id — and finding ids are themselves
 * content-addressed over the rows they were assembled from, so any real
 * change upstream changes the digest.
 */
export function dossierContentDigest(
  investigationId: string,
  graphVersion: string,
  sections: readonly DossierSection[],
  limitations: readonly string[],
): string {
  // ASCII record / unit / group separators. They cannot occur in any of
  // the joined values, so no combination of section text can forge a
  // field boundary and collide with a different report.
  const RS = "";
  const US = "";
  const GS = "";
  const canonical = [
    investigationId,
    graphVersion,
    ...sections.map((s) =>
      [s.kind, s.title, s.summary, s.notes.join(US), s.findings.map((f) => f.id).join(",")].join(RS),
    ),
    limitations.join(US),
  ].join(GS);
  return createHash("sha256").update(canonical).digest("hex");
}

export interface AssembledDossier {
  sections: DossierSection[];
  limitations: string[];
  contentDigest: string;
  reportVersion: string;
  dossierId: string;
  derivationMethods: string[];
  byClassification: Record<EvidenceClassification, number>;
  findingCount: number;
  warnings: string[];
}

/**
 * Assembles every deterministic section of the report. The Copilot
 * material section is NOT built here — it depends on a service call and
 * is attached afterwards by ./service.ts, deliberately outside the
 * identity digest.
 */
export function assembleDeterministicSections(
  snapshot: DossierSnapshot,
  generatedAt: string,
  aiSynthesisAvailable: boolean,
): AssembledDossier {
  const warnings: string[] = [];

  const evidenceInventory = evidenceInventorySection(snapshot, generatedAt);
  const keyEntities = keyEntitiesSection(snapshot, generatedAt);
  const keyRelationships = keyRelationshipsSection(snapshot, generatedAt);
  const analyticalSignals = analyticalSignalsSection(snapshot, generatedAt);
  const corroboration = corroborationSection(snapshot, generatedAt);
  const contradictions = contradictionsSection(snapshot, generatedAt);
  const leads = investigativeLeadsSection(snapshot, generatedAt);

  const findingSections = [
    evidenceInventory,
    keyEntities,
    keyRelationships,
    analyticalSignals,
    corroboration,
    contradictions,
    leads,
  ];

  if (keyEntities.findings.length === 0) {
    warnings.push("No ranked entity signal was available, so the key entities section is empty.");
  }
  if (contradictions.findings.length === 0) {
    warnings.push("No contradiction was detected at this graph version — a completed check, not an unchecked one.");
  }

  const allFindings = findingSections.flatMap((s) => s.findings);
  const byClassification = emptyClassificationCensus();
  for (const f of allFindings) byClassification[f.classification] += 1;
  const derivationMethods = sortedUnique(allFindings.map((f) => f.derivationMethod));

  const limitations = buildLimitations(snapshot, aiSynthesisAvailable);

  const sections: DossierSection[] = [
    caseSummarySection(snapshot),
    ...findingSections,
    provenanceIndexSection(snapshot, derivationMethods),
    classificationSection(snapshot, byClassification),
    limitationsSection(limitations),
  ];

  const contentDigest = dossierContentDigest(
    snapshot.investigationId,
    snapshot.graphVersion,
    sections,
    limitations,
  );

  return {
    sections,
    limitations,
    contentDigest,
    reportVersion: `dossier.v1.${contentDigest.slice(0, 12)}`,
    dossierId: makeContentId("dossier", [snapshot.investigationId, snapshot.graphVersion, contentDigest]),
    derivationMethods,
    byClassification,
    findingCount: allFindings.length,
    warnings,
  };
}

export { EMPTY_DOSSIER_REFERENCES, refs as dossierRefs, capIds as capReferenceIds };
