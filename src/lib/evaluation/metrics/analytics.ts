import type { GroundTruth } from "@/lib/evaluation/ground-truth";
import type { SystemSnapshot } from "@/lib/evaluation/snapshot";
import type { AlignedMention } from "@/lib/evaluation/metrics/entity-resolution";
import { personKeyMap } from "@/lib/evaluation/metrics/graph";
import {
  f1,
  ratioMetric,
  type MetricResult,
  type PrfCounts,
} from "@/lib/evaluation/types";

/**
 * Community detection agreement, scored pairwise over actors.
 *
 * Cluster labels are arbitrary — Louvain's "community 3" has no reason
 * to be ground truth's "vendor-cell" — so the comparison is over
 * co-membership of actor pairs, which is label-free. Note that ground
 * truth places X1 in two communities and S1 in two, so the reference
 * partition is not a partition at all; the metric treats a pair as
 * expected-together if ANY ground-truth community contains both, and
 * says so in its limitations.
 */
export function communityMetric(
  snapshot: SystemSnapshot,
  aligned: AlignedMention[],
  gt: GroundTruth,
): MetricResult {
  const keyOf = personKeyMap(aligned);
  const communitySignals = snapshot.analyticalSignals.filter((s) => s.signalType === "community");

  // A community signal is one row per cluster carrying `clusterId` and
  // `memberEntityIds`; it does not use target_entity_id. Reading the
  // target column instead (the shape every other signal type uses)
  // silently scores zero actors, so the membership array is read directly.
  const systemCommunityOf = new Map<string, string>();
  for (const signal of communitySignals) {
    const value = signal.value as Record<string, unknown>;
    const clusterId = value["clusterId"];
    const members = value["memberEntityIds"];
    if (typeof clusterId !== "string" || !Array.isArray(members)) continue;
    for (const member of members) {
      if (typeof member !== "string") continue;
      const actor = keyOf.get(member);
      if (actor) systemCommunityOf.set(actor, clusterId);
    }
  }

  const actors = [...systemCommunityOf.keys()].sort();
  const expectedTogether = (a: string, b: string): boolean =>
    gt.expectedCommunities.some((c) => c.members.includes(a) && c.members.includes(b));

  const counts: PrfCounts = { truePositives: 0, falsePositives: 0, falseNegatives: 0 };
  for (let i = 0; i < actors.length; i++) {
    for (let j = i + 1; j < actors.length; j++) {
      const a = actors[i]!;
      const b = actors[j]!;
      const sameSystem = systemCommunityOf.get(a) === systemCommunityOf.get(b);
      const sameGt = expectedTogether(a, b);
      if (sameGt && sameSystem) counts.truePositives++;
      else if (!sameGt && sameSystem) counts.falsePositives++;
      else if (sameGt && !sameSystem) counts.falseNegatives++;
    }
  }

  const limits = [
    "Ground truth's communities overlap — S1 and X1 each appear in two — so the reference is a cover, not a partition, while Louvain produces a strict partition. A perfect score is therefore impossible by construction, and the number should be read as agreement, not accuracy.",
    "Only actors that both appear in a community signal and map to a ground-truth key are scored.",
    "Louvain is resolution-dependent; a different resolution parameter would move this number without any code being more or less correct.",
  ];
  const details = {
    scoredActors: actors.length,
    systemCommunities: new Set(systemCommunityOf.values()).size,
    groundTruthCommunities: gt.expectedCommunities.length,
    ...counts,
  };

  return {
    id: "analytics.community.pairwiseF1",
    name: "Community detection — pairwise F1 agreement",
    category: "Analytics",
    status: "measured",
    definition:
      "Pairwise agreement between Louvain communities and the designed sub-cells, over actor pairs.",
    numeratorDefinition: "2 × pairwise precision × pairwise recall",
    denominatorDefinition: "pairwise precision + pairwise recall",
    numerator: null,
    denominator: null,
    value: f1(counts),
    unit: "ratio",
    groundTruthSource: "ground truth § expectedCommunities",
    systemInput: "analytical_signals where signal_type = community",
    threshold: null,
    passed: null,
    limitations: limits,
    details,
  };
}

/**
 * Whether the analytical signals ground truth expects actually surface,
 * and on the right actor.
 *
 * Each expectation is mapped to a system method explicitly. Where no
 * system equivalent exists, the expectation is recorded as
 * `no_system_equivalent` and removed from the denominator instead of
 * being scored as a failure — the system was never built to answer it.
 */
const SIGNAL_METHOD: Record<string, string | null> = {
  highest_betweenness_centrality: "analytics:betweenness_centrality",
  highest_overall_influence: "analytics:investigative_ranking",
  // No fund-only subgraph is computed anywhere in src/lib/analytics.
  high_betweenness_on_fund_graph: null,
};

export function expectedSignalMetric(
  snapshot: SystemSnapshot,
  aligned: AlignedMention[],
  gt: GroundTruth,
): MetricResult {
  const keyOf = personKeyMap(aligned);
  let matched = 0;
  let scorable = 0;
  const outcomes: Record<string, unknown>[] = [];

  for (const expected of gt.expectedSignals) {
    const method = SIGNAL_METHOD[expected.signal];
    if (method === null || method === undefined) {
      outcomes.push({
        signal: expected.signal,
        entityKey: expected.entityKey,
        outcome: "no_system_equivalent",
        note: "no analytics method computes this; excluded from the denominator",
      });
      continue;
    }
    scorable++;
    const ranked = snapshot.analyticalSignals
      .filter((s) => s.method === method && s.targetEntityId)
      .map((s) => ({
        actor: keyOf.get(s.targetEntityId!) ?? null,
        score: numericScore(s.value as Record<string, unknown>),
      }))
      .filter((r) => r.actor !== null)
      .sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity));

    const top = ranked[0]?.actor ?? null;
    const rank = ranked.findIndex((r) => r.actor === expected.entityKey);
    if (top === expected.entityKey) {
      matched++;
      outcomes.push({ signal: expected.signal, entityKey: expected.entityKey, outcome: "top-1 match" });
    } else {
      outcomes.push({
        signal: expected.signal,
        entityKey: expected.entityKey,
        outcome: "MISSED",
        systemTop1: top,
        expectedActorRank: rank < 0 ? "absent" : rank + 1,
        rankedActors: ranked.length,
      });
    }
  }

  return ratioMetric({
    id: "analytics.expectedSignals.top1",
    name: "Analytical signals — expected actor ranked first",
    category: "Analytics",
    definition:
      "Fraction of the designed analytical signals where the actor ground truth names is the system's top-ranked actor for the corresponding method.",
    numeratorDefinition: "expected signals whose named actor is ranked first by the mapped analytics method",
    denominatorDefinition: "expected signals for which a system method exists at all",
    numerator: matched,
    denominator: scorable,
    groundTruthSource: "ground truth § expectedSignals",
    systemInput: "analytical_signals, grouped by method",
    limitations: [
      "Top-1 is a harsh reading of an expectation phrased as 'highest'. The expected actor's actual rank is reported per signal in details, which is the more useful number when top-1 fails.",
      "`high_betweenness_on_fund_graph` has no system equivalent — src/lib/analytics never builds a fund-only subgraph — so it is excluded from the denominator rather than counted as a failure.",
      "Ranking depends on the score field the evaluator reads out of signal.value; the field name is discovered heuristically and a schema change there would silently degrade this metric.",
    ],
    details: { matched, scorable, total: gt.expectedSignals.length, outcomes },
  });
}

function numericScore(value: Record<string, unknown>): number | null {
  for (const key of ["score", "value", "centrality", "betweenness", "rank"]) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return key === "rank" ? -candidate : candidate;
    }
  }
  return null;
}

/**
 * The corpus hides one connection on purpose (S1↔S4, reachable only
 * through the laundering chain and one cell-tower co-activation). This
 * asks the plainest possible question: after the pipeline has run, is
 * there any path in the persisted graph between the two?
 */
export function hiddenConnectionMetric(
  snapshot: SystemSnapshot,
  aligned: AlignedMention[],
  gt: GroundTruth,
): MetricResult {
  const keyOf = personKeyMap(aligned);
  const entityOfActor = new Map<string, string[]>();
  for (const [entityId, actor] of keyOf) {
    entityOfActor.set(actor, [...(entityOfActor.get(actor) ?? []), entityId]);
  }

  const adjacency = new Map<string, Set<string>>();
  for (const rel of snapshot.relationships) {
    if (!adjacency.has(rel.sourceEntityId)) adjacency.set(rel.sourceEntityId, new Set());
    if (!adjacency.has(rel.targetEntityId)) adjacency.set(rel.targetEntityId, new Set());
    adjacency.get(rel.sourceEntityId)!.add(rel.targetEntityId);
    adjacency.get(rel.targetEntityId)!.add(rel.sourceEntityId);
  }

  let recovered = 0;
  let scorable = 0;
  const outcomes: Record<string, unknown>[] = [];
  for (const hidden of gt.hiddenConnections) {
    const [a, b] = hidden.between;
    const starts = a ? (entityOfActor.get(a) ?? []) : [];
    const goals = new Set(b ? (entityOfActor.get(b) ?? []) : []);
    if (starts.length === 0 || goals.size === 0) {
      outcomes.push({ between: hidden.between, outcome: "not_scorable", note: "an endpoint actor has no resolved entity" });
      continue;
    }
    scorable++;
    const { found, hops } = shortestHops(adjacency, starts, goals);
    if (found) {
      recovered++;
      outcomes.push({ between: hidden.between, outcome: "path exists", hops });
    } else {
      outcomes.push({ between: hidden.between, outcome: "MISSED — no path in the persisted graph", recoverableBy: hidden.recoverableBy });
    }
  }

  return ratioMetric({
    id: "graph.hiddenConnection.recovery",
    name: "Hidden connection recovery",
    category: "Graph integrity",
    definition:
      "Fraction of the deliberately concealed connections for which the persisted graph contains any path between the two actors.",
    numeratorDefinition: "hidden connections with a path between their endpoints",
    denominatorDefinition: "hidden connections whose endpoints both resolved to entities",
    numerator: recovered,
    denominator: scorable,
    groundTruthSource: "ground truth § hiddenConnections",
    systemInput: "relationships table, traversed undirected",
    limitations: [
      "'A path exists' is a weak success criterion. It does not check that the path is the intended laundering chain, nor that the UI would surface it, nor that an investigator could find it. It is the floor, not the bar.",
      "Traversal is undirected and unweighted, over entity and location nodes alike, so a path through a shared cell tower counts.",
      "Hop count is reported so a 2-hop and a 9-hop recovery are not confused with each other.",
    ],
    details: { recovered, scorable, outcomes },
  });
}

function shortestHops(
  adjacency: Map<string, Set<string>>,
  starts: string[],
  goals: Set<string>,
): { found: boolean; hops: number | null } {
  const visited = new Set<string>(starts);
  let frontier = [...starts];
  let hops = 0;
  while (frontier.length > 0 && hops < 24) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbour of adjacency.get(node) ?? []) {
        if (visited.has(neighbour)) continue;
        if (goals.has(neighbour)) return { found: true, hops: hops + 1 };
        visited.add(neighbour);
        next.push(neighbour);
      }
    }
    frontier = next;
    hops++;
  }
  return { found: false, hops: null };
}
