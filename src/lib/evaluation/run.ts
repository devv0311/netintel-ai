import {
  indexGroundTruthEntities,
  loadCorpusIndex,
  loadGroundTruth,
  GROUND_TRUTH_PATH,
  type GroundTruth,
} from "@/lib/evaluation/ground-truth";
import { collectPersonMentions, type SystemSnapshot } from "@/lib/evaluation/snapshot";
import { alignMentions, entityResolutionMetrics } from "@/lib/evaluation/metrics/entity-resolution";
import { graphIntegrityMetrics, relationshipMetrics } from "@/lib/evaluation/metrics/graph";
import {
  contradictionMetric,
  identifierIndex,
  copilotGroundingMetric,
  extractionAccuracyMetric,
  spatialCorroborationMetric,
  temporalCorroborationMetric,
} from "@/lib/evaluation/metrics/corroboration";
import { provenanceCompletenessMetric } from "@/lib/evaluation/metrics/provenance";
import {
  communityMetric,
  expectedSignalMetric,
  hiddenConnectionMetric,
} from "@/lib/evaluation/metrics/analytics";
import type { EvaluationReport, EvaluationRunMeta, MetricResult } from "@/lib/evaluation/types";

/** phone number (lowercased) -> the actor ground truth says owns it. */
function actorOfPhoneMap(gt: GroundTruth): Map<string, string> {
  const map = new Map<string, string>();
  for (const actor of [...gt.keyActors.principalSuspects, ...gt.keyActors.intermediaries]) {
    for (const phone of actor.phones ?? []) map.set(phone.trim().toLowerCase(), actor.key);
  }
  return map;
}

/**
 * actorKey -> every persisted entity id that may legitimately stand for
 * that actor in a finding: the resolved person entity, plus that
 * actor's phone, account and vehicle entities.
 *
 * This exists because ground truth and the pipeline identify subjects
 * differently — ground truth by phone number or actor key, the
 * corroboration stage by whichever entity it resolved the activity to.
 * Widening on the evaluator's side keeps the metric measuring detection
 * rather than representation.
 */
function subjectsForActorMap(
  gt: GroundTruth,
  snapshot: SystemSnapshot,
  aligned: { systemCluster: string; groundTruthKey: string }[],
): Map<string, string[]> {
  const byIdentifier = identifierIndex(snapshot);
  const map = new Map<string, Set<string>>();
  const add = (actor: string, id: string | undefined) => {
    if (!id) return;
    if (!map.has(actor)) map.set(actor, new Set());
    map.get(actor)!.add(id);
  };
  for (const mention of aligned) add(mention.groundTruthKey, mention.systemCluster);
  for (const actor of [...gt.keyActors.principalSuspects, ...gt.keyActors.intermediaries]) {
    for (const value of [...(actor.phones ?? []), ...(actor.accounts ?? []), ...(actor.vehicles ?? [])]) {
      add(actor.key, byIdentifier.get(value.trim().toLowerCase()));
    }
  }
  return new Map([...map].map(([k, v]) => [k, [...v]]));
}

/**
 * Computes every metric from a persisted system snapshot plus the
 * ground-truth file. Pure with respect to the pipeline: it runs no
 * stage, writes nothing, and never touches the ground-truth document.
 */
export function evaluate(
  snapshot: SystemSnapshot,
  meta: Omit<EvaluationRunMeta, "groundTruthPath">,
  options: { hasApiKey: boolean; root?: string } = { hasApiKey: false },
): EvaluationReport {
  const root = options.root ?? process.cwd();
  const errors: string[] = [];
  const gt = loadGroundTruth(root);
  const corpus = loadCorpusIndex(root);
  const gtIndex = indexGroundTruthEntities(gt, corpus);

  if (gtIndex.unresolvedMentions.length > 0) {
    errors.push(
      `${gtIndex.unresolvedMentions.length} ground-truth source mentions do not match any corpus record ref: ${gtIndex.unresolvedMentions.slice(0, 5).join(", ")}`,
    );
  }
  if (gt.corpus.seed !== undefined && snapshot.evidenceItems.length === 0) {
    errors.push("The store contains no evidence items — the pipeline did not run, or ran against a different database.");
  }

  const mentions = collectPersonMentions(snapshot);
  const { aligned } = alignMentions(mentions, gtIndex);
  const subjects = subjectsForActorMap(gt, snapshot, aligned);

  const metrics: MetricResult[] = [
    extractionAccuracyMetric(),
    ...entityResolutionMetrics(snapshot, mentions, gt, gtIndex),
    ...relationshipMetrics(snapshot, aligned, gt),
    ...graphIntegrityMetrics(snapshot),
    hiddenConnectionMetric(snapshot, aligned, gt),
    temporalCorroborationMetric(snapshot, gt, subjects, actorOfPhoneMap(gt)),
    spatialCorroborationMetric(snapshot, gt, corpus, subjects),
    contradictionMetric(snapshot, gt),
    communityMetric(snapshot, aligned, gt),
    expectedSignalMetric(snapshot, aligned, gt),
    provenanceCompletenessMetric(snapshot),
    copilotGroundingMetric(options.hasApiKey),
  ];

  const withThreshold = metrics.filter((m) => m.threshold !== null);
  return {
    meta: { ...meta, groundTruthPath: GROUND_TRUTH_PATH },
    metrics,
    errors,
    summary: {
      measured: metrics.filter((m) => m.status === "measured").length,
      notImplementableYet: metrics.filter((m) => m.status === "not_implementable_yet").length,
      withThreshold: withThreshold.length,
      thresholdsPassed: withThreshold.filter((m) => m.passed === true).length,
      thresholdsFailed: withThreshold.filter((m) => m.passed === false).length,
    },
  };
}
