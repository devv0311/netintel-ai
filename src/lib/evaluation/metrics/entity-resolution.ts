import {
  assignGroundTruthKey,
  type GroundTruth,
  type GroundTruthEntityIndex,
} from "@/lib/evaluation/ground-truth";
import type { PersonMention, SystemSnapshot } from "@/lib/evaluation/snapshot";
import {
  f1,
  precision,
  ratioMetric,
  recall,
  type MetricResult,
  type PrfCounts,
} from "@/lib/evaluation/types";

const GT_SOURCE = "evidence/ground-truth/operation-darknet-delhi.ground-truth.json § expectedEntityMerges";
const SYS_SOURCE = "extracted_records (entity_mention/person) joined to resolution_decisions.canonical_entity_id";

export interface AlignedMention extends PersonMention {
  groundTruthKey: string;
  systemCluster: string;
}

export interface AlignmentOutcome {
  aligned: AlignedMention[];
  /** Mentions excluded from the paired metrics, with the reason. */
  excluded: { recordRef: string; fieldPath: string; observedName: string | null; reason: string }[];
}

/**
 * Pairs each system person mention with the ground-truth cluster it
 * belongs to. Mentions that cannot be assigned unambiguously, or that
 * the resolver never clustered, are excluded and reported — never
 * guessed into a cluster.
 */
export function alignMentions(
  mentions: PersonMention[],
  gtIndex: GroundTruthEntityIndex,
): AlignmentOutcome {
  const aligned: AlignedMention[] = [];
  const excluded: AlignmentOutcome["excluded"] = [];
  for (const mention of mentions) {
    const { key, reason } = assignGroundTruthKey(mention.recordRef, mention.observedName, gtIndex);
    if (key === null) {
      excluded.push({
        recordRef: mention.recordRef,
        fieldPath: mention.fieldPath,
        observedName: mention.observedName,
        reason,
      });
      continue;
    }
    if (mention.canonicalEntityId === null) {
      excluded.push({
        recordRef: mention.recordRef,
        fieldPath: mention.fieldPath,
        observedName: mention.observedName,
        reason: "no resolution decision references this extracted record",
      });
      continue;
    }
    aligned.push({ ...mention, groundTruthKey: key, systemCluster: mention.canonicalEntityId });
  }
  return { aligned, excluded };
}

/**
 * Pairwise (a.k.a. pair-counting) confusion over the aligned mentions.
 *
 * Every unordered pair of aligned mentions is one trial:
 *   TP — ground truth says same entity AND the resolver clustered them together
 *   FP — the resolver clustered them together, ground truth says different entities (over-merge)
 *   FN — ground truth says same entity, the resolver kept them apart (under-merge)
 * True negatives are not counted; precision and recall do not use them.
 */
export function pairwiseCounts(aligned: AlignedMention[]): PrfCounts {
  let truePositives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;
  for (let i = 0; i < aligned.length; i++) {
    for (let j = i + 1; j < aligned.length; j++) {
      const sameGt = aligned[i]!.groundTruthKey === aligned[j]!.groundTruthKey;
      const sameSys = aligned[i]!.systemCluster === aligned[j]!.systemCluster;
      if (sameGt && sameSys) truePositives++;
      else if (!sameGt && sameSys) falsePositives++;
      else if (sameGt && !sameSys) falseNegatives++;
    }
  }
  return { truePositives, falsePositives, falseNegatives };
}

const PAIRWISE_LIMITS = [
  "Pair-counting weights large clusters more heavily than small ones: one over-merge inside an 8-mention cluster costs more pairs than one inside a 2-mention cluster. Read the cluster-level metric alongside it.",
  "Only person mentions are scored. Phone, IMEI, vehicle and bank-account entities are resolved by the same code path but have no expectedEntityMerges entry to score against.",
  "Mentions the ground truth cannot assign unambiguously are excluded from the denominator; the count is reported in details.excluded.",
];

export function entityResolutionMetrics(
  snapshot: SystemSnapshot,
  mentions: PersonMention[],
  gt: GroundTruth,
  gtIndex: GroundTruthEntityIndex,
): MetricResult[] {
  const { aligned, excluded } = alignMentions(mentions, gtIndex);
  const counts = pairwiseCounts(aligned);
  const details = {
    alignedMentions: aligned.length,
    excludedMentions: excluded.length,
    excluded: excluded.slice(0, 25),
    groundTruthClusters: gt.expectedEntityMerges.length,
    systemPersonClusters: new Set(aligned.map((m) => m.systemCluster)).size,
    truePositivePairs: counts.truePositives,
    falsePositivePairs: counts.falsePositives,
    falseNegativePairs: counts.falseNegatives,
    unresolvedGroundTruthMentions: gtIndex.unresolvedMentions,
  };

  const base = {
    category: "Entity-resolution precision/recall",
    groundTruthSource: GT_SOURCE,
    systemInput: SYS_SOURCE,
    limitations: PAIRWISE_LIMITS,
    details,
  };

  const metrics: MetricResult[] = [
    ratioMetric({
      ...base,
      id: "er.pairwise.precision",
      name: "Entity resolution — pairwise precision",
      definition:
        "Of the mention pairs the resolver placed in the same entity, the fraction ground truth agrees are the same entity.",
      numeratorDefinition: "mention pairs co-clustered by the system AND by ground truth",
      denominatorDefinition: "mention pairs co-clustered by the system",
      numerator: counts.truePositives,
      denominator: counts.truePositives + counts.falsePositives,
    }),
    ratioMetric({
      ...base,
      id: "er.pairwise.recall",
      name: "Entity resolution — pairwise recall",
      definition:
        "Of the mention pairs ground truth says are the same entity, the fraction the resolver actually merged.",
      numeratorDefinition: "mention pairs co-clustered by the system AND by ground truth",
      denominatorDefinition: "mention pairs co-clustered by ground truth",
      numerator: counts.truePositives,
      denominator: counts.truePositives + counts.falseNegatives,
    }),
  ];

  const p = precision(counts);
  const r = recall(counts);
  const score = f1(counts);
  metrics.push({
    ...base,
    id: "er.pairwise.f1",
    name: "Entity resolution — pairwise F1",
    status: "measured",
    definition: "Harmonic mean of pairwise precision and recall.",
    numeratorDefinition: "2 × precision × recall",
    denominatorDefinition: "precision + recall",
    numerator: p === null || r === null ? null : 2 * p * r,
    denominator: p === null || r === null ? null : p + r,
    value: score,
    unit: "ratio",
    threshold: null,
    passed: null,
  });

  // Cluster-level: how many ground-truth entities were recovered whole.
  const gtClusters = new Map<string, Set<string>>();
  const sysClusters = new Map<string, Set<string>>();
  for (const m of aligned) {
    const key = `${m.recordRef}#${m.fieldPath}`;
    if (!gtClusters.has(m.groundTruthKey)) gtClusters.set(m.groundTruthKey, new Set());
    gtClusters.get(m.groundTruthKey)!.add(key);
    if (!sysClusters.has(m.systemCluster)) sysClusters.set(m.systemCluster, new Set());
    sysClusters.get(m.systemCluster)!.add(key);
  }
  const sysSignatures = new Set(
    [...sysClusters.values()].map((s) => [...s].sort().join("|")),
  );
  let exact = 0;
  const partial: { groundTruthKey: string; expected: number; systemSplitAcross: number }[] = [];
  for (const [gtKey, members] of gtClusters) {
    const signature = [...members].sort().join("|");
    if (sysSignatures.has(signature)) exact++;
    else {
      const spread = new Set(
        aligned.filter((m) => m.groundTruthKey === gtKey).map((m) => m.systemCluster),
      ).size;
      partial.push({ groundTruthKey: gtKey, expected: members.size, systemSplitAcross: spread });
    }
  }
  metrics.push(
    ratioMetric({
      id: "er.cluster.exactMatch",
      name: "Entity resolution — exact cluster recovery",
      category: "Entity-resolution precision/recall",
      definition:
        "Fraction of ground-truth entities whose full set of scored mentions the resolver recovered as exactly one system entity, with nothing extra.",
      numeratorDefinition: "ground-truth clusters matched exactly by some system cluster",
      denominatorDefinition: "ground-truth clusters with at least one scored mention",
      numerator: exact,
      denominator: gtClusters.size,
      groundTruthSource: GT_SOURCE,
      systemInput: SYS_SOURCE,
      limitations: [
        "Exactness is judged only over mentions that survived alignment, so an excluded mention cannot cause a cluster to fail.",
        "A cluster that is right except for one missing mention scores the same as one that is entirely wrong. Use it with the pairwise numbers, not instead of them.",
      ],
      details: { exact, total: gtClusters.size, imperfect: partial },
    }),
  );

  metrics.push(mentionCoverageMetric(aligned, gt, gtIndex));
  metrics.push(mustNotMergeMetric(snapshot, aligned, mentions, gt));
  metrics.push(aliasAttachmentMetric(snapshot, aligned, gt));
  return metrics;
}

/**
 * Mention coverage — the blind spot the pairwise metric cannot see.
 *
 * Pairwise precision and recall are computed only over mentions that
 * BOTH sides produced. A mention the extractor never emitted at all
 * contributes no pair, so it cannot lower either number. Without this
 * metric a pipeline that extracted three people perfectly and missed
 * the other nine would score 100% and look finished.
 */
export function mentionCoverageMetric(
  aligned: AlignedMention[],
  gt: GroundTruth,
  gtIndex: GroundTruthEntityIndex,
): MetricResult {
  const expected = new Set<string>();
  for (const [recordRef, keys] of gtIndex.keysByRecordRef) {
    for (const key of keys) expected.add(`${key}@${recordRef}`);
  }
  const produced = new Set(aligned.map((m) => `${m.groundTruthKey}@${m.recordRef}`));
  const missing = [...expected].filter((pair) => !produced.has(pair)).sort();

  const coveredKeys = new Set(aligned.map((m) => m.groundTruthKey));
  const absentActors = gt.expectedEntityMerges
    .map((merge) => merge.entityKey)
    .filter((key) => !coveredKeys.has(key));

  return ratioMetric({
    id: "er.mentionCoverage",
    name: "Entity resolution — ground-truth mention coverage",
    category: "Entity-resolution precision/recall",
    definition:
      "Fraction of the (entity, source record) mentions ground truth documents for which the pipeline produced a corresponding, clustered person mention.",
    numeratorDefinition: "documented (entity, record ref) mentions the pipeline produced and clustered",
    denominatorDefinition: "distinct (entity, record ref) mentions documented in ground truth",
    numerator: expected.size - missing.length,
    denominator: expected.size,
    groundTruthSource: GT_SOURCE,
    systemInput: SYS_SOURCE,
    limitations: [
      "This is the denominator the pairwise metrics do not have. Read the two together: high pairwise scores over low coverage means the resolver is accurate on the subset it was given, not that the case was reconstructed.",
      "A mention can be missing for two different reasons — extraction never emitted it, or the resolver never clustered it — and this metric does not separate them. The excluded list in the pairwise metric distinguishes the second case.",
      "Ground-truth mentions are collapsed to (entity, record ref); two mentions of the same person in one record count once.",
    ],
    details: {
      documented: expected.size,
      produced: expected.size - missing.length,
      missing,
      groundTruthActorsWithNoScoredMention: absentActors,
    },
  });
}

/**
 * The one case the corpus was built to trap: two different people with
 * the same common name. Ground truth records it in prose
 * (`doNotMerge[].a/.b`), so the leading key token is parsed out and
 * verified against known ground-truth keys and corpus refs. If a side
 * cannot be parsed the metric reports not-measurable rather than
 * silently passing.
 */
export function mustNotMergeMetric(
  snapshot: SystemSnapshot,
  aligned: AlignedMention[],
  allMentions: PersonMention[],
  gt: GroundTruth,
): MetricResult {
  const clusterOfKey = (key: string): Set<string> =>
    new Set(aligned.filter((m) => m.groundTruthKey === key).map((m) => m.systemCluster));
  // Deliberately over ALL person mentions, not only the aligned ones: the
  // B side of a must-not-merge rule is typically a witness who has no
  // expectedEntityMerges cluster of their own and is therefore excluded
  // from alignment. Scoring this rule off the aligned set alone made it
  // permanently unscorable — the trap the corpus was built to set would
  // never have been checked.
  const clusterOfWitnessRef = (ref: string): Set<string> =>
    new Set(
      allMentions
        .filter((m) => m.recordRef === ref && m.canonicalEntityId !== null)
        .map((m) => m.canonicalEntityId as string),
    );

  let checked = 0;
  let upheld = 0;
  const outcomes: Record<string, unknown>[] = [];
  for (const rule of gt.doNotMerge) {
    const aKey = /^([A-Z]+\d+)/.exec(rule.a)?.[1] ?? null;
    const bKey = /^([A-Z]+\d+)/.exec(rule.b)?.[1] ?? null;
    if (!aKey || !bKey) {
      outcomes.push({ rule, outcome: "unparseable", note: "no leading entity key token" });
      continue;
    }
    const aClusters = clusterOfKey(aKey);
    // The B side is frequently a witness who has no expectedEntityMerges
    // cluster of its own; fall back to its witness record ref.
    const bClusters = clusterOfKey(bKey).size > 0 ? clusterOfKey(bKey) : clusterOfWitnessRef(`witness:${bKey}`);
    if (aClusters.size === 0 || bClusters.size === 0) {
      outcomes.push({
        rule: rule.reason,
        a: aKey,
        b: bKey,
        outcome: "not_scorable",
        note: "one side has no scored system mention",
      });
      continue;
    }
    checked++;
    const overlap = [...aClusters].filter((c) => bClusters.has(c));
    if (overlap.length === 0) {
      upheld++;
      outcomes.push({ a: aKey, b: bKey, outcome: "upheld — kept apart" });
    } else {
      outcomes.push({ a: aKey, b: bKey, outcome: "VIOLATED — merged", sharedClusters: overlap });
    }
  }

  return ratioMetric({
    id: "er.mustNotMerge",
    name: "Entity resolution — must-not-merge rules upheld",
    category: "Entity-resolution precision/recall",
    definition:
      "Fraction of the corpus's designed same-name-different-person traps that the resolver did not merge.",
    numeratorDefinition: "doNotMerge rules where the two sides landed in different system entities",
    denominatorDefinition: "doNotMerge rules where both sides produced a scored system mention",
    numerator: upheld,
    denominator: checked,
    groundTruthSource: "ground truth § doNotMerge (prose; leading key token parsed)",
    systemInput: SYS_SOURCE,
    limitations: [
      "doNotMerge is prose, not structured data. The evaluator parses the leading `S5`/`W6`-style token; a rule written without one is reported as unparseable, not as a pass.",
      "A side with no scored mention makes the rule unscorable and it is excluded from the denominator.",
      `Snapshot contained ${snapshot.entities.length} entities at scoring time.`,
    ],
    details: { outcomes },
  });
}

/** Whether each documented alias is attached to the right resolved entity. */
export function aliasAttachmentMetric(
  snapshot: SystemSnapshot,
  aligned: AlignedMention[],
  gt: GroundTruth,
): MetricResult {
  const gtKeyByCluster = new Map<string, string>();
  for (const m of aligned) gtKeyByCluster.set(m.systemCluster, m.groundTruthKey);

  const aliasesByEntity = new Map<string, Set<string>>();
  for (const alias of snapshot.aliases) {
    if (!aliasesByEntity.has(alias.entityId)) aliasesByEntity.set(alias.entityId, new Set());
    aliasesByEntity.get(alias.entityId)!.add(alias.aliasValue.trim().toLowerCase());
  }

  let correct = 0;
  const misses: { alias: string; expectedKey: string; foundOn: string[] }[] = [];
  for (const entry of gt.aliasMap) {
    const wanted = entry.alias.trim().toLowerCase();
    const holders = [...aliasesByEntity.entries()]
      .filter(([, values]) => values.has(wanted))
      .map(([entityId]) => entityId);
    const holderKeys = holders.map((h) => gtKeyByCluster.get(h) ?? `unmapped:${h}`);
    if (holderKeys.includes(entry.entityKey)) correct++;
    else misses.push({ alias: entry.alias, expectedKey: entry.entityKey, foundOn: holderKeys });
  }

  return ratioMetric({
    id: "er.alias.attachment",
    name: "Entity resolution — alias attachment recall",
    category: "Entity-resolution precision/recall",
    definition:
      "Fraction of documented aliases that are persisted against the entity ground truth says owns them.",
    numeratorDefinition: "aliases attached to the correct resolved entity",
    denominatorDefinition: "aliases listed in ground truth § aliasMap",
    numerator: correct,
    denominator: gt.aliasMap.length,
    groundTruthSource: "ground truth § aliasMap",
    systemInput: "aliases table joined to entities via alias.entity_id",
    limitations: [
      "An alias attached to an entity the evaluator could not map to a ground-truth key counts as a miss, listed in details as `unmapped:<entityId>`.",
      "Matching is case-insensitive and whitespace-trimmed but not transliteration-aware. That is deliberate: the current resolver is not transliteration-aware either, and hiding the gap here would hide it everywhere.",
    ],
    details: { correct, total: gt.aliasMap.length, misses },
  });
}
