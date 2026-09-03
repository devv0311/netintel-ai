import type { GroundTruth } from "@/lib/evaluation/ground-truth";
import type { SystemSnapshot } from "@/lib/evaluation/snapshot";
import type { AlignedMention } from "@/lib/evaluation/metrics/entity-resolution";
import {
  f1,
  precision,
  ratioMetric,
  recall,
  type MetricResult,
  type PrfCounts,
} from "@/lib/evaluation/types";

const GT_REL = "ground truth § expectedRelationships";
const SYS_REL = "relationships table (person↔person edges), endpoints mapped to ground-truth keys";

/** entityId -> ground-truth actor key, for person entities only. */
export function personKeyMap(aligned: AlignedMention[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of aligned) if (!map.has(m.systemCluster)) map.set(m.systemCluster, m.groundTruthKey);
  return map;
}

const undirected = (a: string, b: string, type: string): string =>
  [a, b].sort().join("~") + "::" + type;

/**
 * Relationship extraction accuracy, scored over person-to-person edges.
 *
 * Direction is deliberately ignored: ground truth lists a communication
 * between S1 and S2 once, while the graph may carry it as S1→S2, S2→S1,
 * or both depending on who dialled. Scoring direction would measure call
 * ordering, not whether the relationship was found. Direction agreement
 * is reported separately in details rather than folded into the score.
 */
export function relationshipMetrics(
  snapshot: SystemSnapshot,
  aligned: AlignedMention[],
  gt: GroundTruth,
): MetricResult[] {
  const keyOf = personKeyMap(aligned);

  const systemPairs = new Map<string, { classifications: Set<string>; count: number }>();
  let personEdges = 0;
  for (const rel of snapshot.relationships) {
    const a = keyOf.get(rel.sourceEntityId);
    const b = keyOf.get(rel.targetEntityId);
    if (!a || !b || a === b) continue;
    personEdges++;
    const id = undirected(a, b, rel.relationshipType);
    const entry = systemPairs.get(id) ?? { classifications: new Set<string>(), count: 0 };
    entry.classifications.add(rel.classification);
    entry.count++;
    systemPairs.set(id, entry);
  }

  const gtPairs = new Map<string, (typeof gt.expectedRelationships)[number]>();
  for (const rel of gt.expectedRelationships) {
    gtPairs.set(undirected(rel.sourceKey, rel.targetKey, rel.relationshipType), rel);
  }

  const counts: PrfCounts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  const missing: string[] = [];
  const spurious: string[] = [];
  for (const id of gtPairs.keys()) {
    if (systemPairs.has(id)) counts.truePositives++;
    else {
      counts.falseNegatives++;
      missing.push(id);
    }
  }
  for (const id of systemPairs.keys()) {
    if (!gtPairs.has(id)) {
      counts.falsePositives++;
      spurious.push(id);
    }
  }

  // Classification agreement over the edges both sides agree exist.
  let classificationAgreements = 0;
  const classificationDisagreements: Record<string, unknown>[] = [];
  for (const [id, gtRel] of gtPairs) {
    const sys = systemPairs.get(id);
    if (!sys) continue;
    if (sys.classifications.has(gtRel.classification)) classificationAgreements++;
    else {
      classificationDisagreements.push({
        edge: id,
        groundTruth: gtRel.classification,
        system: [...sys.classifications],
      });
    }
  }

  const byGtType: Record<string, { expected: number; found: number }> = {};
  for (const [id, rel] of gtPairs) {
    const bucket = (byGtType[rel.relationshipType] ??= { expected: 0, found: 0 });
    bucket.expected++;
    if (systemPairs.has(id)) bucket.found++;
  }

  const limits = [
    "Scored undirected. Direction is reported in details but not scored, because ground truth records a relationship once while the graph may carry both directions.",
    "Only edges whose BOTH endpoints map to a ground-truth actor key are scored. Ownership edges (person↔phone, person↔account) and co_location edges have no expectedRelationships entry and are excluded.",
    "An edge type the system never emits (e.g. `associate`) shows up as pure recall loss; that is a capability gap, not a scoring artefact.",
  ];
  const details = {
    groundTruthEdges: gtPairs.size,
    systemPersonEdges: personEdges,
    systemDistinctPersonPairs: systemPairs.size,
    byRelationshipType: byGtType,
    missing: missing.slice(0, 40),
    spurious: spurious.slice(0, 40),
    classificationDisagreements: classificationDisagreements.slice(0, 20),
  };

  const p = precision(counts);
  const r = recall(counts);

  return [
    ratioMetric({
      id: "rel.precision",
      name: "Relationship extraction — precision",
      category: "Relationship extraction accuracy",
      definition: "Of the person-to-person relationships the graph asserts, the fraction ground truth also lists.",
      numeratorDefinition: "(pair, type) edges present in both the graph and ground truth",
      denominatorDefinition: "distinct (pair, type) person edges in the graph",
      numerator: counts.truePositives,
      denominator: counts.truePositives + counts.falsePositives,
      groundTruthSource: GT_REL,
      systemInput: SYS_REL,
      limitations: limits,
      details,
    }),
    ratioMetric({
      id: "rel.recall",
      name: "Relationship extraction — recall",
      category: "Relationship extraction accuracy",
      definition: "Of the relationships ground truth lists, the fraction the graph recovered.",
      numeratorDefinition: "(pair, type) edges present in both the graph and ground truth",
      denominatorDefinition: "(pair, type) edges listed in ground truth",
      numerator: counts.truePositives,
      denominator: counts.truePositives + counts.falseNegatives,
      groundTruthSource: GT_REL,
      systemInput: SYS_REL,
      limitations: limits,
      details,
    }),
    {
      id: "rel.f1",
      name: "Relationship extraction — F1",
      category: "Relationship extraction accuracy",
      status: "measured",
      definition: "Harmonic mean of relationship precision and recall.",
      numeratorDefinition: "2 × precision × recall",
      denominatorDefinition: "precision + recall",
      numerator: p === null || r === null ? null : 2 * p * r,
      denominator: p === null || r === null ? null : p + r,
      value: f1(counts),
      unit: "ratio",
      groundTruthSource: GT_REL,
      systemInput: SYS_REL,
      threshold: null,
      passed: null,
      limitations: limits,
      details,
    },
    ratioMetric({
      id: "rel.classificationAgreement",
      name: "Relationship extraction — evidence-classification agreement",
      category: "Relationship extraction accuracy",
      definition:
        "Of the relationships both sides agree exist, the fraction where the graph's evidence classification matches ground truth's.",
      numeratorDefinition: "matched edges whose system classification set contains the ground-truth classification",
      denominatorDefinition: "matched edges",
      numerator: classificationAgreements,
      denominator: counts.truePositives,
      groundTruthSource: GT_REL,
      systemInput: SYS_REL,
      limitations: [
        "An edge carrying several classifications counts as agreeing if any of them matches. This is lenient by design; the disagreements are listed in full in details.",
        "Systematic disagreement here is expected and meaningful: src/lib/graph/build.ts classifies every DERIVED person↔person edge as `ai_inference`, whereas ground truth labels the same relationships `observed_fact`. That is a definitional difference between the two documents, not necessarily a defect — but it is exactly the kind of thing that must surface as a number rather than as an assumption.",
      ],
      details,
    }),
  ];
}

/**
 * Graph integrity — structural correctness, scored without ground truth
 * because it does not need one: an edge either resolves to persisted
 * endpoints and carries its evidence, or it does not.
 */
export function graphIntegrityMetrics(snapshot: SystemSnapshot): MetricResult[] {
  const entityIds = new Set(snapshot.entities.map((e) => e.id));
  const locationIds = new Set(snapshot.locations.map((l) => l.id));
  const validEndpoint = (id: string) => entityIds.has(id) || locationIds.has(id);

  const problems: Record<string, string[]> = {
    danglingEndpoint: [],
    selfLoop: [],
    noEvidenceItem: [],
    noExtractedRecord: [],
    duplicateEdge: [],
  };
  const seen = new Set<string>();
  for (const rel of snapshot.relationships) {
    if (!validEndpoint(rel.sourceEntityId) || !validEndpoint(rel.targetEntityId)) {
      problems.danglingEndpoint!.push(rel.id);
    }
    if (rel.sourceEntityId === rel.targetEntityId) problems.selfLoop!.push(rel.id);
    if (rel.evidenceItemIds.length === 0) problems.noEvidenceItem!.push(rel.id);
    if (rel.extractedRecordIds.length === 0) problems.noExtractedRecord!.push(rel.id);
    const signature = `${rel.relationshipType}|${rel.sourceEntityId}|${rel.targetEntityId}`;
    if (seen.has(signature)) problems.duplicateEdge!.push(rel.id);
    seen.add(signature);
  }
  const failing = new Set(Object.values(problems).flat());

  const signalProblems: string[] = [];
  for (const signal of snapshot.analyticalSignals) {
    if (signal.targetEntityId !== null && signal.targetEntityId !== undefined) {
      if (!validEndpoint(signal.targetEntityId)) signalProblems.push(signal.id);
    }
  }

  return [
    ratioMetric({
      id: "graph.integrity",
      name: "Graph integrity",
      category: "Graph integrity",
      definition:
        "Fraction of relationship rows that resolve to persisted endpoints, carry at least one evidence item and one extracted record, are not self-loops, and are not duplicates of another edge with the same type and endpoints.",
      numeratorDefinition: "relationship rows with no structural defect",
      denominatorDefinition: "relationship rows",
      numerator: snapshot.relationships.length - failing.size,
      denominator: snapshot.relationships.length,
      groundTruthSource: "none — structural invariants from docs/data/graph.md and the relationships schema",
      systemInput: "relationships, entities and locations tables",
      limitations: [
        "Checks structure, not truth. An edge can be perfectly well-formed and still wrong; that is what the relationship precision metric is for.",
        "Endpoint validity accepts either an entity id or a location id, matching the documented dual-target shape of relationships.source/target_entity_id.",
      ],
      details: {
        relationships: snapshot.relationships.length,
        failing: failing.size,
        problems: Object.fromEntries(
          Object.entries(problems).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 5) }]),
        ),
        analyticalSignalsWithUnresolvableTarget: signalProblems.length,
      },
    }),
  ];
}
