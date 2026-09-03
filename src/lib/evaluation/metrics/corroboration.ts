import type { CorpusIndex, GroundTruth } from "@/lib/evaluation/ground-truth";
import type { SystemSnapshot } from "@/lib/evaluation/snapshot";
import { notImplementableYet, ratioMetric, type MetricResult } from "@/lib/evaluation/types";

/** Identifier -> resolved entity id, matched on canonical label or any string attribute. */
export function identifierIndex(snapshot: SystemSnapshot): Map<string, string> {
  const index = new Map<string, string>();
  const put = (value: unknown, id: string) => {
    if (typeof value !== "string" || value.length === 0) return;
    const key = value.trim().toLowerCase();
    if (!index.has(key)) index.set(key, id);
  };
  for (const entity of snapshot.entities) {
    if (entity.kind === "person") continue;
    put(entity.canonicalLabel, entity.id);
    for (const value of Object.values(entity.attributes)) put(value, entity.id);
  }
  return index;
}

const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string): boolean =>
  Date.parse(aStart) <= Date.parse(bEnd) && Date.parse(bStart) <= Date.parse(aEnd);

/**
 * Temporal corroboration recall.
 *
 * Ground truth names the co-active phone NUMBERS and the window. A
 * finding counts as recovered when a persisted temporal finding covers
 * every one of those phones' resolved entities and its own window
 * overlaps the expected one. Overlap, not containment: the system
 * derives its window from the observed events, so demanding an exact
 * match would score window arithmetic rather than detection.
 */
export function temporalCorroborationMetric(
  snapshot: SystemSnapshot,
  gt: GroundTruth,
  subjectsForActor: Map<string, string[]>,
  actorOfPhone: Map<string, string>,
): MetricResult {
  const temporal = snapshot.corroborationFindings.filter(
    (f) => f.kind === "temporal" || f.kind === "spatiotemporal",
  );

  let recovered = 0;
  const outcomes: Record<string, unknown>[] = [];
  let unscorable = 0;
  for (const expected of gt.temporalCorrelations) {
    // Ground truth names phone NUMBERS; the corroboration stage pairs
    // whatever subject it resolved that activity to — which is a person
    // entity, not the phone. So each expected phone is widened to every
    // entity that can legitimately stand for its owner, and a finding
    // matches when it covers at least one such entity per expected side.
    const perSide = expected.phones.map((phone) => {
      const actor = actorOfPhone.get(phone.trim().toLowerCase());
      return actor ? (subjectsForActor.get(actor) ?? []) : [];
    });
    if (perSide.some((ids) => ids.length === 0)) {
      unscorable++;
      outcomes.push({
        key: expected.key,
        outcome: "not_scorable",
        note: "at least one expected phone has no owning actor with a resolved entity",
        phones: expected.phones,
      });
      continue;
    }
    const match = temporal.find((f) => {
      if (!perSide.every((ids) => ids.some((id) => f.entityIds.includes(id)))) return false;
      if (!f.window) return false;
      return overlaps(
        f.window.start,
        f.window.end ?? f.window.start,
        expected.windowStart,
        expected.windowEnd,
      );
    });
    if (match) {
      recovered++;
      outcomes.push({ key: expected.key, outcome: "recovered", findingId: match.id, findingType: match.findingType });
    } else {
      outcomes.push({
        key: expected.key,
        outcome: "MISSED",
        expectedWindow: [expected.windowStart, expected.windowEnd],
        expectedPhones: expected.phones,
      });
    }
  }

  return ratioMetric({
    id: "corroboration.temporal.recall",
    name: "Temporal corroboration — recall",
    category: "Spatial/temporal corroboration",
    definition:
      "Fraction of the designed temporal co-occurrences that the corroboration stage surfaced as a finding covering the same phones in an overlapping window.",
    numeratorDefinition: "expected temporal correlations matched by a persisted temporal finding",
    denominatorDefinition: "expected temporal correlations whose phones all resolved to entities",
    numerator: recovered,
    denominator: gt.temporalCorrelations.length - unscorable,
    groundTruthSource: "ground truth § temporalCorrelations",
    systemInput: "corroboration_findings where kind ∈ {temporal, spatiotemporal}",
    limitations: [
      "Recall only. Ground truth does not enumerate every temporal co-occurrence the corpus contains, only the ones designed to matter, so precision cannot be computed without labelling the rest — extra findings are not necessarily false.",
      "Windows are matched by overlap, not equality.",
      "Ground truth identifies the parties by phone number; the pipeline's findings identify them by resolved subject entity. The evaluator bridges the two through ground truth's own keyActors phone lists and accepts a match on either the person entity or the phone entity, so the metric is not sensitive to which representation the corroboration stage happens to use.",
      "A correlation whose phones did not resolve is excluded from the denominator and reported as not_scorable rather than as a miss, so an entity-resolution failure is not double-counted here.",
    ],
    details: { recovered, expected: gt.temporalCorrelations.length, unscorable, outcomes, systemTemporalFindings: temporal.length },
  });
}

/** Spatial corroboration recall — same shape, keyed on actor keys and a cell tower. */
export function spatialCorroborationMetric(
  snapshot: SystemSnapshot,
  gt: GroundTruth,
  corpus: CorpusIndex,
  subjectsForActor: Map<string, string[]>,
): MetricResult {
  const locationIdByLabel = new Map(
    snapshot.locations.map((l) => [l.label.trim().toLowerCase(), l.id] as const),
  );
  const spatial = snapshot.corroborationFindings.filter(
    (f) => f.kind === "spatial" || f.kind === "spatiotemporal",
  );

  let recovered = 0;
  let unscorable = 0;
  const outcomes: Record<string, unknown>[] = [];
  for (const expected of gt.spatialCorrelations) {
    const label = corpus.locationLabelByKey.get(expected.locationKey);
    const locationId = label ? locationIdByLabel.get(label.trim().toLowerCase()) : undefined;
    // Every listed actor must contribute at least one entity to the finding.
    const perActor = expected.entities.map((actor) => subjectsForActor.get(actor) ?? []);
    if (!locationId || perActor.some((ids) => ids.length === 0)) {
      unscorable++;
      outcomes.push({
        locationKey: expected.locationKey,
        entities: expected.entities,
        outcome: "not_scorable",
        note: !locationId ? "expected location not persisted" : "an expected actor has no resolvable entity",
      });
      continue;
    }
    const match = spatial.find(
      (f) =>
        f.locationIds.includes(locationId) &&
        perActor.every((ids) => ids.some((id) => f.entityIds.includes(id))),
    );
    if (match) {
      recovered++;
      outcomes.push({ locationKey: expected.locationKey, outcome: "recovered", findingId: match.id, findingType: match.findingType });
    } else {
      outcomes.push({ locationKey: expected.locationKey, entities: expected.entities, outcome: "MISSED" });
    }
  }

  return ratioMetric({
    id: "corroboration.spatial.recall",
    name: "Spatial corroboration — recall",
    category: "Spatial/temporal corroboration",
    definition:
      "Fraction of the designed spatial co-locations that the corroboration stage surfaced as a finding at the same persisted location covering all listed actors.",
    numeratorDefinition: "expected spatial correlations matched by a persisted spatial finding",
    denominatorDefinition: "expected spatial correlations whose location and actor phones all resolved",
    numerator: recovered,
    denominator: gt.spatialCorrelations.length - unscorable,
    groundTruthSource: "ground truth § spatialCorrelations",
    systemInput: "corroboration_findings where kind ∈ {spatial, spatiotemporal}",
    limitations: [
      "Recall only, for the same reason as the temporal metric.",
      "Ground truth names actors; a finding may reference either the person entity or one of that actor's device entities. The evaluator accepts either, bridging through ground truth's own keyActors lists.",
      "Actors are matched at cell-tower granularity, which is what the corpus provides. No physical-distance tolerance is applied.",
    ],
    details: { recovered, expected: gt.spatialCorrelations.length, unscorable, outcomes, systemSpatialFindings: spatial.length },
  });
}

/**
 * Contradiction detection.
 *
 * Read the limitations before reading the number. Ground truth designs
 * three contradictions — a witness/alibi conflict, an attribute conflict
 * and an attribution conflict. The implemented pipeline has exactly one
 * contradiction detector, `spatiotemporal_contradiction`, which fires on
 * impossible travel speed. Those are different kinds of object, so a low
 * score here is a coverage gap in the system, not a tuning problem.
 */
export function contradictionMetric(snapshot: SystemSnapshot, gt: GroundTruth): MetricResult {
  const detected = snapshot.corroborationFindings.filter(
    (f) => f.findingType === "spatiotemporal_contradiction",
  );
  const byKind: Record<string, number> = {};
  for (const c of gt.contradictions) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;

  // The only kind the system can express is a spatio-temporal one.
  const expressible = gt.contradictions.filter((c) => c.kind === "location_time");
  let recovered = 0;
  const outcomes = gt.contradictions.map((c) => ({
    subject: c.subject,
    kind: c.kind,
    systemDetectorExists:
      c.kind === "location_time"
        ? "partially — spatiotemporal_contradiction detects impossible travel speed, not witness/alibi conflict"
        : "no — the pipeline has no detector for this contradiction kind",
    outcome: "MISSED",
  }));

  return ratioMetric({
    id: "contradiction.recall",
    name: "Contradiction detection — recall",
    category: "Contradiction detection",
    definition:
      "Fraction of the contradictions designed into ground truth that the pipeline surfaced as a contradiction finding.",
    numeratorDefinition: "designed contradictions matched by a persisted contradiction finding",
    denominatorDefinition: "contradictions listed in ground truth § contradictions",
    numerator: recovered,
    denominator: gt.contradictions.length,
    groundTruthSource: "ground truth § contradictions",
    systemInput: "corroboration_findings where finding_type = spatiotemporal_contradiction",
    limitations: [
      "The pipeline implements ONE contradiction detector (`spatiotemporal_contradiction`, impossible travel speed). Ground truth designs three contradictions of kinds `location_time`, `attribute` and `attribution`. None of the three is an impossible-travel-speed case, so the ceiling on this metric is currently 0 by construction.",
      "This is therefore a capability measurement, not an accuracy measurement. Treat it as the size of a gap: detecting attribute and attribution conflicts needs a cross-source claim comparator that does not exist.",
      "Precision is not computed: ground truth does not enumerate non-contradictions, so a spurious contradiction cannot be identified from it.",
    ],
    details: {
      expectedByKind: byKind,
      expressibleByCurrentDetector: expressible.length,
      systemContradictionFindings: detected.length,
      outcomes,
    },
  });
}

/** Extraction accuracy cannot be scored: ground truth has no per-record expected extraction. */
export function extractionAccuracyMetric(): MetricResult {
  return notImplementableYet({
    id: "extraction.accuracy",
    name: "Extraction accuracy",
    category: "Extraction accuracy",
    definition:
      "Whether the records extracted from each evidence item match what that item actually contains.",
    numeratorDefinition: "extracted records matching an expected extraction",
    denominatorDefinition: "expected extractions",
    groundTruthSource: "none — the ground-truth file contains no expected extracted-record inventory",
    systemInput: "extracted_records table",
    limitations: [
      "evidence/ground-truth/operation-darknet-delhi.ground-truth.json defines expected MERGES, RELATIONSHIPS, CORRELATIONS, COMMUNITIES, SIGNALS and COPILOT ANSWERS. It does not define an expected extraction for any evidence item.",
      "Extraction is a deterministic structural field-read (src/lib/extraction/extract.ts), so an expected-extraction fixture could be written by hand for a small sample of items — that is the cheapest way to make this metric real.",
      "Until then, extraction correctness is only observed indirectly, through the entity-resolution and relationship metrics that consume its output.",
    ],
  });
}

/** Copilot grounding needs a live model call; there is no offline path. */
export function copilotGroundingMetric(hasApiKey: boolean): MetricResult {
  return notImplementableYet({
    id: "copilot.grounding",
    name: "Copilot grounding / citation correctness",
    category: "Copilot grounding",
    definition:
      "Whether each canonical investigative question is answered correctly, with every claim citing a resolvable row and the right evidence classification.",
    numeratorDefinition: "canonical questions answered correctly with fully resolvable citations",
    denominatorDefinition: "canonical questions in docs/demo/demo-contract.md §3",
    groundTruthSource: "ground truth § expectedCopilotAnswers (8 questions)",
    systemInput: "src/lib/copilot/service.ts — requires a live Claude API call",
    limitations: [
      hasApiKey
        ? "AI_PROVIDER_API_KEY is present, but this evaluator deliberately does not spend model calls: a metric whose value changes with sampling is not comparable across runs until the response cache is warm and its key is verified."
        : "AI_PROVIDER_API_KEY is not set in this environment, so no answer can be generated. The metric is unmeasured, NOT zero.",
      "A meaningful split exists and should be built next: the retrieval half (src/lib/copilot/retrieval.ts) is fully deterministic, so retrieval recall against expectedCopilotAnswers can be scored offline with no model call at all. Only answer correctness needs the model.",
      "Citation resolvability is also deterministic once an answer exists — every cited id either matches a persisted row or does not.",
    ],
  });
}
