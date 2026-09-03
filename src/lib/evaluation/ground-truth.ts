import fs from "node:fs";
import path from "node:path";

/**
 * Independent loader for the Operation DarkNet Delhi reference answers.
 *
 * "Independent" is the point. This module reads
 * evidence/ground-truth/*.ground-truth.json straight off disk and does
 * not import anything from src/lib/corpus — the generator that wrote
 * that file. If the evaluator reused the generator's own loader, a bug
 * in the generator would cancel itself out and the evaluation would
 * confirm nothing. Ground truth is treated here as an opaque external
 * document, exactly as docs/data/ground-truth-spec.md §2 requires.
 *
 * Nothing in this module ever writes to the ground-truth file.
 */

export const GROUND_TRUTH_PATH = "evidence/ground-truth/operation-darknet-delhi.ground-truth.json";
export const CORPUS_PATH = "evidence/synthetic/operation-darknet-delhi.json";

export interface GtEntityMerge {
  entityKey: string;
  canonicalLabel: string;
  aliases: string[];
  sourceMentions: string[];
}

export interface GtRelationship {
  sourceKey: string;
  targetKey: string;
  relationshipType: string;
  classification: string;
  materiality: string;
  explicit: boolean;
  evidenceRefs: string[];
}

export interface GtTemporalCorrelation {
  key: string;
  phones: string[];
  cellTower: string;
  windowStart: string;
  windowEnd: string;
  meaning: string;
}

export interface GtSpatialCorrelation {
  entities: string[];
  locationKey: string;
  at: string;
  basis: string;
}

export interface GtContradiction {
  subject: string;
  kind: string;
  detail: string;
  sources: string[];
  resolutionForbidden: boolean;
}

export interface GtCommunity {
  key: string;
  members: string[];
}

export interface GtSignal {
  entityKey: string;
  signal: string;
  rationale: string;
}

export interface GtHiddenConnection {
  between: string[];
  reason: string;
  evidenceChain: string[];
  recoverableBy: string;
}

export interface GtActor {
  key: string;
  name?: string;
  canonicalName?: string;
  role: string;
  phones?: string[];
  accounts?: string[];
  vehicles?: string[];
  aliases?: string[];
}

export interface GroundTruth {
  corpus: { name: string; version: string; seed: number };
  expectedEntityMerges: GtEntityMerge[];
  doNotMerge: { a: string; b: string; reason: string }[];
  aliasMap: { alias: string; entityKey: string }[];
  expectedRelationships: GtRelationship[];
  temporalCorrelations: GtTemporalCorrelation[];
  spatialCorrelations: GtSpatialCorrelation[];
  contradictions: GtContradiction[];
  expectedCommunities: GtCommunity[];
  expectedSignals: GtSignal[];
  hiddenConnections: GtHiddenConnection[];
  expectedCopilotAnswers: { question: string; expects: string[] }[];
  keyActors: { principalSuspects: GtActor[]; intermediaries: GtActor[] };
}

export function loadGroundTruth(root = process.cwd()): GroundTruth {
  const raw = fs.readFileSync(path.join(root, GROUND_TRUTH_PATH), "utf8");
  return JSON.parse(raw) as GroundTruth;
}

/** The corpus, read only to learn which record refs and source keys exist. */
export interface CorpusIndex {
  recordRefs: Set<string>;
  sourceKeys: Set<string>;
  /** recordRef -> the item's itemType. */
  itemTypeByRef: Map<string, string>;
  /** Location key as ground truth writes it (e.g. "SYN-CT-07") -> the corpus label. */
  locationLabelByKey: Map<string, string>;
}

export function loadCorpusIndex(root = process.cwd()): CorpusIndex {
  const raw = JSON.parse(fs.readFileSync(path.join(root, CORPUS_PATH), "utf8")) as {
    evidenceItems: { itemType: string; content: Record<string, unknown> }[];
    evidenceSources: { key?: string }[];
  };
  const recordRefs = new Set<string>();
  const itemTypeByRef = new Map<string, string>();
  for (const item of raw.evidenceItems) {
    const ref = item.content["recordRef"];
    if (typeof ref === "string") {
      recordRefs.add(ref);
      itemTypeByRef.set(ref, item.itemType);
    }
  }
  const locationLabelByKey = new Map<string, string>();
  for (const item of raw.evidenceItems) {
    if (item.itemType !== "location_record") continue;
    const ref = item.content["recordRef"];
    const label = item.content["label"];
    if (typeof ref === "string" && typeof label === "string" && ref.startsWith("location:")) {
      locationLabelByKey.set(ref.slice("location:".length), label);
    }
  }
  const sourceKeys = new Set<string>();
  for (const s of raw.evidenceSources) if (s.key) sourceKeys.add(s.key);
  return { recordRefs, sourceKeys, itemTypeByRef, locationLabelByKey };
}

/**
 * Ground truth writes a mention three different ways —
 * "subscriber-registry:suspect:S1" (sourceKey-prefixed),
 * "fir:001:accused" (recordRef plus the field it appeared in), and
 * "witness:W1" (bare recordRef). All three have to collapse onto the
 * corpus recordRef the system's provenance actually carries
 * (src/lib/extraction/extract.ts writes `${recordRef}#${fieldPath}`).
 *
 * The rule is deliberately conservative: optionally strip a known
 * source key, then take the LONGEST leading segment run that is a real
 * corpus recordRef. It never invents a ref that the corpus does not
 * contain — an unresolvable mention is returned as null and counted in
 * the report rather than silently dropped.
 */
export function normalizeMentionToRecordRef(
  mention: string,
  index: CorpusIndex,
): string | null {
  const candidates = [mention];
  const segments = mention.split(":");
  if (segments.length > 1 && index.sourceKeys.has(segments[0]!)) {
    candidates.push(segments.slice(1).join(":"));
  }
  for (const candidate of candidates) {
    const parts = candidate.split(":");
    for (let n = parts.length; n > 0; n--) {
      const prefix = parts.slice(0, n).join(":");
      if (index.recordRefs.has(prefix)) return prefix;
    }
  }
  return null;
}

/** Case- and whitespace-insensitive name key, for matching a mention to an actor. */
export function nameKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface GroundTruthEntityIndex {
  /** recordRef -> the ground-truth entity keys that claim it. */
  keysByRecordRef: Map<string, string[]>;
  /** normalized name -> ground-truth entity keys carrying that name or alias. */
  keysByName: Map<string, string[]>;
  /** entityKey -> its merge record. */
  mergeByKey: Map<string, GtEntityMerge>;
  /** Mentions in the ground-truth file that do not match any corpus record. */
  unresolvedMentions: string[];
}

export function indexGroundTruthEntities(
  gt: GroundTruth,
  corpus: CorpusIndex,
): GroundTruthEntityIndex {
  const keysByRecordRef = new Map<string, string[]>();
  const keysByName = new Map<string, string[]>();
  const mergeByKey = new Map<string, GtEntityMerge>();
  const unresolvedMentions: string[] = [];

  const push = (map: Map<string, string[]>, key: string, value: string) => {
    const existing = map.get(key);
    if (existing) {
      if (!existing.includes(value)) existing.push(value);
    } else map.set(key, [value]);
  };

  for (const merge of gt.expectedEntityMerges) {
    mergeByKey.set(merge.entityKey, merge);
    push(keysByName, nameKey(merge.canonicalLabel), merge.entityKey);
    for (const alias of merge.aliases) push(keysByName, nameKey(alias), merge.entityKey);
    for (const mention of merge.sourceMentions) {
      const ref = normalizeMentionToRecordRef(mention, corpus);
      if (ref === null) unresolvedMentions.push(mention);
      else push(keysByRecordRef, ref, merge.entityKey);
    }
  }
  return { keysByRecordRef, keysByName, mergeByKey, unresolvedMentions };
}

/**
 * Assigns a ground-truth entity key to one system person mention.
 *
 * A record ref alone is not always enough: `fir:001` names two accused
 * and is claimed by both S1 and S3. So the record ref narrows the
 * candidates and the observed name string picks between them. When
 * neither step yields exactly one candidate the mention is returned as
 * unassigned — it is then excluded from the paired metrics and counted
 * in the report, which is the honest handling. Guessing here would
 * quietly inflate or deflate every entity-resolution number downstream.
 */
export function assignGroundTruthKey(
  recordRef: string,
  observedName: string | null,
  index: GroundTruthEntityIndex,
): { key: string | null; reason: string } {
  const byRef = index.keysByRecordRef.get(recordRef);
  if (!byRef || byRef.length === 0) {
    return { key: null, reason: "record ref is not claimed by any ground-truth cluster" };
  }
  if (byRef.length === 1) return { key: byRef[0]!, reason: "unique record ref" };

  if (observedName === null) {
    return { key: null, reason: `record ref shared by ${byRef.length} clusters and no name to disambiguate` };
  }
  const byName = index.keysByName.get(nameKey(observedName)) ?? [];
  const intersection = byRef.filter((k) => byName.includes(k));
  if (intersection.length === 1) {
    return { key: intersection[0]!, reason: "record ref narrowed by observed name" };
  }
  return {
    key: null,
    reason:
      intersection.length === 0
        ? `name "${observedName}" matches no cluster claiming ${recordRef}`
        : `name "${observedName}" matches ${intersection.length} clusters claiming ${recordRef}`,
  };
}
