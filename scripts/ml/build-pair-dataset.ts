/**
 * P6.24.1 — build the pairwise entity-resolution dataset, with
 * entity-disjoint TRAIN / VALIDATION / TEST partitions.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/ml/build-pair-dataset.ts
 *
 * REUSES existing real data. Collects nothing, fetches nothing, and
 * writes no database. Inputs are the two P6.19 artifacts already in the
 * repository and nothing else:
 *
 *   evidence/expanded/expanded-anchored.corpus.json   (1,245 real records)
 *   evidence/expanded/expanded.ground-truth.json      (labels + provenance)
 *
 * LABELS ARE NOT CREATED HERE. Positives and hard negatives are taken
 * verbatim from the ground truth, where they were derived from
 * publisher-stated identifiers under the rules recorded in that file's
 * `labellingRules`. The one class this script DERIVES is the sampled
 * negative, and it is derived by the same rule the ground truth already
 * uses for a hard negative, minus the name-collision requirement:
 *
 *   two records whose subjects are identified under the SAME scheme and
 *   DISAGREE on its value denote two different legal entities, because
 *   an LEI denotes exactly one legal entity (ISO 17442) and a CIK
 *   exactly one SEC filer.
 *
 * No label anywhere comes from name similarity. Nothing is manufactured.
 *
 * THE SPLIT UNIT IS THE SUBJECT, NEVER THE PAIR, and subjects are
 * grouped into components first so that no labelled pair can straddle a
 * partition boundary. Prior designations in the ground truth's own
 * `split` map are honoured conservatively: any component touching a
 * subject previously marked `heldout_evaluation` goes to TEST in whole,
 * so a subject reserved for evaluation can never be trained on.
 */

import { createHash } from "node:crypto";
import { normalizeName } from "@/lib/resolution/name-normalization";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const CORPUS_PATH = "evidence/expanded/expanded-anchored.corpus.json";
const GROUND_TRUTH_PATH = "evidence/expanded/expanded.ground-truth.json";
const OUT_DIR = "evidence/ml";
const OUT_PATH = path.join(OUT_DIR, "pair-dataset.json");

/** Fixed for reproducibility. Changing it draws a different sample and is a dataset version change. */
const SEED = "cipher-p6.24-pair-dataset-v1";
/** Sampled negatives per positive, per partition. Bounded so the class balance stays declarable. */
const SAMPLED_NEGATIVES_PER_POSITIVE = 4;

type Partition = "train" | "validation" | "test";

interface RawRecord {
  recordRef: string;
  registry: string;
  registryRecordId: string;
  name: string;
  officialName?: string;
  aliases?: string[];
  jurisdiction?: string;
  status?: string;
}

interface Surrogate {
  registry: string;
  registryRecordId: string;
  recordRef: string;
  name: string;
  officialName: string | null;
  leis: string[];
  ciks: string[];
  ocids: string[];
}

/** A seeded, deterministic PRNG. mulberry32 over a sha256 of the seed string. */
function makeRng(seed: string): () => number {
  const digest = createHash("sha256").update(seed).digest();
  let state = digest.readUInt32BE(0);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class UnionFind {
  private readonly parent = new Map<string, string>();

  add(key: string): void {
    if (!this.parent.has(key)) this.parent.set(key, key);
  }

  find(key: string): string {
    this.add(key);
    let root = key;
    while (this.parent.get(root) !== root) root = this.parent.get(root) as string;
    let cursor = key;
    while (this.parent.get(cursor) !== root) {
      const next = this.parent.get(cursor) as string;
      this.parent.set(cursor, root);
      cursor = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const rootA = this.find(a);
    const rootB = this.find(b);
    if (rootA !== rootB) this.parent.set(rootA, rootB);
  }

  keys(): string[] {
    return [...this.parent.keys()];
  }
}

function main(): void {
  const corpus = JSON.parse(readFileSync(path.join(ROOT, CORPUS_PATH), "utf8")) as {
    evidenceItems: { content: RawRecord }[];
  };
  const groundTruth = JSON.parse(readFileSync(path.join(ROOT, GROUND_TRUTH_PATH), "utf8")) as {
    experiment: string;
    dataClass: string;
    builtFrom: Record<string, string>;
    sources: { sourceId: string; registry: string; license: string; channel: string }[];
    labellingRules: Record<string, string>;
    counts: Record<string, number>;
    split: Record<string, string>;
    positives: {
      pairId: string;
      basis: string;
      sourcePairing: string;
      a: { recordRef: string; registry: string; name: string };
      b: { recordRef: string; registry: string; name: string };
      subject: string;
      variation: string;
    }[];
    hardNegatives: {
      pairId: string;
      basis: string;
      scheme: string;
      sourcePairing: string;
      a: { recordRef: string; registry: string; name: string; id: string };
      b: { recordRef: string; registry: string; name: string; id: string };
    }[];
    undetermined: { recordRef: string }[];
    formerNamePairs: {
      pairId: string;
      subject: string;
      a: { recordRef: string; registry: string; name: string };
      b: { recordRef: string; registry: string; name: string };
      variation: string;
    }[];
    surrogateMap: Record<string, Surrogate>;
  };

  // ---- record index ------------------------------------------------------
  // The ANCHORED corpus masks every non-GLEIF record behind a surrogate id
  // (`wikidata:EXP-0498`) and withholds its identifiers, so the ground
  // truth's real recordRef (`wikidata:Q815694`) does not address it
  // directly. That masking is exactly what makes this corpus the right
  // input here: for 748 of 1,245 records the identifier the label is
  // derived from is not merely unused by the model, it is physically
  // absent from the record the model sees. Every ground-truth ref is
  // therefore resolved through the surrogate map, and a ref that resolves
  // to nothing is dropped and counted rather than silently skipped.
  const records = new Map<string, RawRecord>();
  for (const item of corpus.evidenceItems) records.set(item.content.recordRef, item.content);

  /** real recordRef -> the ref that addresses the same record in the anchored corpus */
  const anchoredRefOf = new Map<string, string>();
  for (const [surrogateKey, surrogate] of Object.entries(groundTruth.surrogateMap)) {
    const masked = `${surrogate.registry}:${surrogateKey}`;
    if (records.has(masked)) anchoredRefOf.set(surrogate.recordRef, masked);
    else if (records.has(surrogate.recordRef)) anchoredRefOf.set(surrogate.recordRef, surrogate.recordRef);
  }
  const anchored = (realRef: string): string | null => anchoredRefOf.get(realRef) ?? null;

  // ---- excluded records --------------------------------------------------
  const undetermined = new Set(groundTruth.undetermined.map((entry) => entry.recordRef));

  // ---- subject assignment ------------------------------------------------
  // A record's subject is its publisher-stated LEI, or its CIK when it has
  // no LEI. A record stating two LEIs names no single entity and is
  // excluded by the ground truth already; it is excluded here too.
  const subjectOf = new Map<string, string>();
  const schemesOf = new Map<string, { lei: string | null; cik: string | null }>();
  const schemeBridges: [string, string][] = [];
  for (const surrogate of Object.values(groundTruth.surrogateMap)) {
    const ref = anchored(surrogate.recordRef);
    if (!ref) continue;
    if (undetermined.has(surrogate.recordRef)) continue;
    // A record stating two LEIs (or two CIKs) names no single legal
    // entity and is excluded, exactly as the ground truth excludes it.
    if (surrogate.leis.length > 1 || surrogate.ciks.length > 1) continue;
    const lei = surrogate.leis[0] ?? null;
    const cik = surrogate.ciks[0] ?? null;
    schemesOf.set(ref, { lei, cik });
    const subject = lei ? `LEI:${lei}` : cik ? `CIK:${cik}` : null;
    if (subject) subjectOf.set(ref, subject);
    // 92 records state BOTH an LEI and a CIK, which makes `LEI:x` and
    // `CIK:y` two names for one real entity. Recorded so the components
    // below can join them; without this the SAME record could be reached
    // through two subjects and land in two partitions, which is entity
    // leakage of the most direct kind.
    if (lei && cik) schemeBridges.push([`LEI:${lei}`, `CIK:${cik}`]);
  }

  // ---- components over subjects -----------------------------------------
  // Nodes are subjects. Edges are HARD NEGATIVES only: a hard negative is
  // the one labelled pair that spans two subjects, so joining its
  // endpoints guarantees no hard negative can straddle a partition.
  // Positives live inside a single subject and add no edge.
  const uf = new UnionFind();
  for (const subject of new Set(subjectOf.values())) uf.add(subject);
  // An LEI subject and a CIK subject that a single record states together
  // are one entity under two schemes. Join them before anything else.
  for (const [leiSubject, cikSubject] of schemeBridges) {
    uf.add(leiSubject);
    uf.add(cikSubject);
    uf.union(leiSubject, cikSubject);
  }
  // The general form of the same problem, and the one the leakage gate
  // caught: a RECORD that is a positive partner of more than one subject
  // makes those subjects inseparable, whatever schemes they use. The
  // Wikidata record for Rocky Mountain Chocolate is a positive against an
  // LEI subject and against TWO CIK subjects (a predecessor filer and its
  // successor); assigning those subjects independently put that single
  // record in two partitions at once. Any subject reachable through a
  // shared record is therefore joined here, before assignment.
  const subjectsByRecord = new Map<string, Set<string>>();
  const noteSubject = (realRef: string, subject: string): void => {
    const ref = anchored(realRef);
    if (!ref) return;
    const set = subjectsByRecord.get(ref) ?? new Set<string>();
    set.add(subject);
    subjectsByRecord.set(ref, set);
  };
  for (const [ref, subject] of subjectOf) {
    const set = subjectsByRecord.get(ref) ?? new Set<string>();
    set.add(subject);
    subjectsByRecord.set(ref, set);
  }
  for (const positive of groundTruth.positives) {
    noteSubject(positive.a.recordRef, positive.subject);
    noteSubject(positive.b.recordRef, positive.subject);
  }
  for (const pair of groundTruth.formerNamePairs) {
    noteSubject(pair.a.recordRef, pair.subject);
    noteSubject(pair.b.recordRef, pair.subject);
  }
  let recordBridgesJoined = 0;
  for (const subjects of subjectsByRecord.values()) {
    const list = [...subjects];
    const first = list[0];
    if (!first || list.length < 2) continue;
    uf.add(first);
    for (let i = 1; i < list.length; i += 1) {
      const other = list[i] as string;
      uf.add(other);
      if (uf.find(first) !== uf.find(other)) recordBridgesJoined += 1;
      uf.union(first, other);
    }
  }
  let hardNegativesWithUnknownSubject = 0;
  for (const negative of groundTruth.hardNegatives) {
    const refA = anchored(negative.a.recordRef);
    const refB = anchored(negative.b.recordRef);
    const subjectA = (refA ? subjectOf.get(refA) : undefined) ?? negative.a.id;
    const subjectB = (refB ? subjectOf.get(refB) : undefined) ?? negative.b.id;
    if (!subjectA || !subjectB) {
      hardNegativesWithUnknownSubject += 1;
      continue;
    }
    uf.add(subjectA);
    uf.add(subjectB);
    uf.union(subjectA, subjectB);
  }

  const componentOf = new Map<string, string>();
  for (const subject of uf.keys()) componentOf.set(subject, uf.find(subject));

  const componentMembers = new Map<string, string[]>();
  for (const [subject, component] of componentOf) {
    const members = componentMembers.get(component) ?? [];
    members.push(subject);
    componentMembers.set(component, members);
  }

  // ---- partition assignment ---------------------------------------------
  // A component that touches ANY subject the ground truth already reserved
  // as `heldout_evaluation` goes to TEST entirely. The rest are assigned
  // whole, by a seeded draw, to train or validation.
  const priorSplit = groundTruth.split;
  const rng = makeRng(SEED);
  const partitionOfComponent = new Map<string, Partition>();
  const componentIds = [...componentMembers.keys()].sort();

  const reservedComponents: string[] = [];
  const freeComponents: string[] = [];
  for (const component of componentIds) {
    const members = componentMembers.get(component) ?? [];
    const touchesHeldout = members.some((subject) => priorSplit[subject] === "heldout_evaluation");
    if (touchesHeldout) reservedComponents.push(component);
    else freeComponents.push(component);
  }
  for (const component of reservedComponents) partitionOfComponent.set(component, "test");
  // Deterministic shuffle of the free components, then a 75/25 train/validation cut.
  const shuffled = [...freeComponents];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const a = shuffled[i] as string;
    const b = shuffled[j] as string;
    shuffled[i] = b;
    shuffled[j] = a;
  }
  const validationCut = Math.round(shuffled.length * 0.25);
  shuffled.forEach((component, index) => {
    partitionOfComponent.set(component, index < validationCut ? "validation" : "train");
  });

  const partitionOfSubject = new Map<string, Partition>();
  for (const [subject, component] of componentOf) {
    const partition = partitionOfComponent.get(component);
    if (partition) partitionOfSubject.set(subject, partition);
  }

  // ---- pair emission -----------------------------------------------------
  interface Pair {
    pairId: string;
    label: 0 | 1;
    labelClass: "cross_source_positive" | "hard_negative" | "mined_hard_negative" | "sampled_negative";
    labelBasis: string;
    labelReason: string;
    partition: Partition;
    subjectA: string;
    subjectB: string;
    aRef: string;
    bRef: string;
    aRegistry: string;
    bRegistry: string;
    aName: string;
    bName: string;
    sourcePairing: string;
    /** Ground-truth annotation, for SLICING results only. Never a feature. */
    variation: string | null;
    scheme: string | null;
  }

  const pairs: Pair[] = [];
  const seen = new Set<string>();
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

  let positivesDropped = 0;
  for (const positive of groundTruth.positives) {
    const partition = partitionOfSubject.get(positive.subject);
    const refA = anchored(positive.a.recordRef);
    const refB = anchored(positive.b.recordRef);
    if (!partition || !refA || !refB) {
      positivesDropped += 1;
      continue;
    }
    seen.add(pairKey(refA, refB));
    pairs.push({
      pairId: positive.pairId,
      label: 1,
      labelClass: "cross_source_positive",
      labelBasis: positive.basis,
      labelReason: groundTruth.labellingRules.positive ?? "",
      partition,
      subjectA: positive.subject,
      subjectB: positive.subject,
      aRef: refA,
      bRef: refB,
      aRegistry: positive.a.registry,
      bRegistry: positive.b.registry,
      aName: positive.a.name,
      bName: positive.b.name,
      sourcePairing: positive.sourcePairing,
      variation: positive.variation,
      scheme: null,
    });
  }

  let hardNegativesDropped = 0;
  for (const negative of groundTruth.hardNegatives) {
    const refA = anchored(negative.a.recordRef);
    const refB = anchored(negative.b.recordRef);
    const subjectA = (refA ? subjectOf.get(refA) : undefined) ?? negative.a.id;
    const subjectB = (refB ? subjectOf.get(refB) : undefined) ?? negative.b.id;
    const partitionA = partitionOfSubject.get(subjectA);
    const partitionB = partitionOfSubject.get(subjectB);
    if (!partitionA || !partitionB || partitionA !== partitionB || !refA || !refB) {
      hardNegativesDropped += 1;
      continue;
    }
    seen.add(pairKey(refA, refB));
    pairs.push({
      pairId: negative.pairId,
      label: 0,
      labelClass: "hard_negative",
      labelBasis: negative.basis,
      labelReason: groundTruth.labellingRules.hardNegative ?? "",
      partition: partitionA,
      subjectA,
      subjectB,
      aRef: refA,
      bRef: refB,
      aRegistry: negative.a.registry,
      bRegistry: negative.b.registry,
      aName: negative.a.name,
      bName: negative.b.name,
      sourcePairing: negative.sourcePairing,
      variation: null,
      scheme: negative.scheme,
    });
  }

  const refsByPartition = new Map<Partition, string[]>([
    ["train", []],
    ["validation", []],
    ["test", []],
  ]);
  for (const [ref, subject] of subjectOf) {
    if (!records.has(ref)) continue;
    const partition = partitionOfSubject.get(subject);
    if (!partition) continue;
    (refsByPartition.get(partition) as string[]).push(ref);
  }

  const comparableDisagreement = (refA: string, refB: string): string | null => {
    const a = schemesOf.get(refA);
    const b = schemesOf.get(refB);
    if (!a || !b) return null;
    if (a.lei && b.lei) return a.lei === b.lei ? null : "LEI";
    if (a.cik && b.cik) return a.cik === b.cik ? null : "CIK";
    return null; // no shared scheme — not comparable, never labelled
  };

  // ---- mined hard negatives ---------------------------------------------
  // The ground truth enumerated 146 hard negatives under two published
  // bases - `normalised_name_collision` and `shared_leading_token` - but
  // `scripts/build-expanded-corpus.ts` restricted the leading-token
  // enumeration to groups of 2..6 records (`v.length > 1 && v.length <= 6`).
  // Families larger than that (the `tata` and `bank` shapes) were therefore
  // never enumerated, and the corpus contains real hard negatives its own
  // rule admits. They are recovered here, under THAT rule unchanged and
  // with no threshold of ours: two records whose subjects share a scheme
  // and disagree on its value, whose normalised names are equal or whose
  // first normalised token is equal.
  //
  // This is a sampling decision, not a labelling one. The label still comes
  // from the publishers' identifiers and from nothing else, and mining runs
  // only AFTER partitions are fixed and only WITHIN a partition, so it can
  // introduce no cross-partition pair. The original 146 keep their own
  // class so every result can be reported on the curated set alone.
  const normKeyOf = new Map<string, string>();
  for (const [ref, record] of records) normKeyOf.set(ref, normalizeName(record.name).normalized);

  let minedIndex = 0;
  for (const partition of ["train", "validation", "test"] as Partition[]) {
    const refs = (refsByPartition.get(partition) as string[]).slice().sort();
    const byNormKey = new Map<string, string[]>();
    const byLeadToken = new Map<string, string[]>();
    for (const ref of refs) {
      const key = normKeyOf.get(ref) ?? "";
      if (key.length === 0) continue;
      (byNormKey.get(key) ?? byNormKey.set(key, []).get(key) as string[]).push(ref);
      const lead = key.split(" ")[0] ?? "";
      if (lead.length === 0) continue;
      (byLeadToken.get(lead) ?? byLeadToken.set(lead, []).get(lead) as string[]).push(ref);
    }
    const emit = (group: string[], basis: string): void => {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const refA = group[i] as string;
          const refB = group[j] as string;
          const key = pairKey(refA, refB);
          if (seen.has(key)) continue;
          const scheme = comparableDisagreement(refA, refB);
          if (!scheme) continue;
          seen.add(key);
          minedIndex += 1;
          const recordA = records.get(refA) as RawRecord;
          const recordB = records.get(refB) as RawRecord;
          pairs.push({
            pairId: `EM-${String(minedIndex).padStart(5, "0")}`,
            label: 0,
            labelClass: "mined_hard_negative",
            labelBasis: basis,
            labelReason:
              "The ground truth's own hard-negative rule, applied without its 2..6 group-size restriction: the two " +
              "records share an identifier scheme and disagree on its value, and their names collide. The label is " +
              "derived from publisher-stated identifiers; the name collision selects the pair, it never labels it.",
            partition,
            subjectA: subjectOf.get(refA) as string,
            subjectB: subjectOf.get(refB) as string,
            aRef: refA,
            bRef: refB,
            aRegistry: recordA.registry,
            bRegistry: recordB.registry,
            aName: recordA.name,
            bName: recordB.name,
            sourcePairing: `${recordA.registry} x ${recordB.registry}`,
            variation: null,
            scheme,
          });
        }
      }
    };
    for (const group of byNormKey.values()) if (group.length > 1) emit(group, "normalised_name_collision");
    for (const group of byLeadToken.values()) if (group.length > 1) emit(group, "shared_leading_token");
  }

  // ---- sampled negatives -------------------------------------------------
  // Drawn WITHIN a partition, so a sampled negative cannot straddle one
  // either. Two records qualify when they share an identifier scheme and
  // disagree on its value.
  const positivesByPartition = new Map<Partition, number>([
    ["train", 0],
    ["validation", 0],
    ["test", 0],
  ]);
  for (const pair of pairs) {
    if (pair.label === 1) {
      positivesByPartition.set(pair.partition, (positivesByPartition.get(pair.partition) ?? 0) + 1);
    }
  }

  const sampleRng = makeRng(`${SEED}:sampled-negatives`);
  let sampledIndex = 0;
  for (const partition of ["train", "validation", "test"] as Partition[]) {
    const refs = (refsByPartition.get(partition) as string[]).slice().sort();
    const target = (positivesByPartition.get(partition) ?? 0) * SAMPLED_NEGATIVES_PER_POSITIVE;
    if (refs.length < 2 || target === 0) continue;
    let accepted = 0;
    let attempts = 0;
    const maxAttempts = target * 200;
    while (accepted < target && attempts < maxAttempts) {
      attempts += 1;
      const refA = refs[Math.floor(sampleRng() * refs.length)] as string;
      const refB = refs[Math.floor(sampleRng() * refs.length)] as string;
      if (refA === refB) continue;
      const key = pairKey(refA, refB);
      if (seen.has(key)) continue;
      const scheme = comparableDisagreement(refA, refB);
      if (!scheme) continue;
      seen.add(key);
      accepted += 1;
      sampledIndex += 1;
      const recordA = records.get(refA) as RawRecord;
      const recordB = records.get(refB) as RawRecord;
      pairs.push({
        pairId: `ES-${String(sampledIndex).padStart(5, "0")}`,
        label: 0,
        labelClass: "sampled_negative",
        labelBasis: "scheme_shared_value_disagrees",
        labelReason:
          "Both records' subjects are identified under the same publisher-issued scheme and the values differ. " +
          "An LEI denotes exactly one legal entity (ISO 17442) and a CIK exactly one SEC filer, so the two records " +
          "denote different entities. Derived from publisher-stated identifiers only; no name similarity is involved.",
        partition,
        subjectA: subjectOf.get(refA) as string,
        subjectB: subjectOf.get(refB) as string,
        aRef: refA,
        bRef: refB,
        aRegistry: recordA.registry,
        bRegistry: recordB.registry,
        aName: recordA.name,
        bName: recordB.name,
        sourcePairing: `${recordA.registry} x ${recordB.registry}`,
        variation: null,
        scheme,
      });
    }
  }

  // ---- former-name pairs, kept as a separate EVALUATION slice ------------
  // A former name is a TEMPORAL claim by ONE authority, not cross-source
  // agreement. It is not identity training data and is never mixed in.
  const formerNameSlice = groundTruth.formerNamePairs
    .filter((pair) => anchored(pair.a.recordRef) !== null)
    .map((pair) => ({
      pairId: pair.pairId,
      subject: pair.subject,
      partition: partitionOfSubject.get(pair.subject) ?? null,
      aName: pair.a.name,
      bName: pair.b.name,
      variation: pair.variation,
    }));

  // ---- record projections the model is allowed to see --------------------
  const featureRecords: Record<string, {
    name: string;
    officialName: string | null;
    aliases: string[];
    jurisdiction: string | null;
    registry: string;
  }> = {};
  for (const pair of pairs) {
    for (const ref of [pair.aRef, pair.bRef]) {
      if (featureRecords[ref]) continue;
      const record = records.get(ref);
      if (!record) continue;
      featureRecords[ref] = {
        name: record.name,
        officialName: record.officialName ?? null,
        aliases: record.aliases ?? [],
        jurisdiction: record.jurisdiction ?? null,
        registry: record.registry,
      };
    }
  }

  // ---- counts ------------------------------------------------------------
  const countBy = <T extends string>(selector: (pair: Pair) => T): Record<string, number> => {
    const counts: Record<string, number> = {};
    for (const pair of pairs) {
      const key = selector(pair);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  };
  const perPartition: Record<string, Record<string, number>> = {};
  for (const partition of ["train", "validation", "test"] as Partition[]) {
    const subset = pairs.filter((pair) => pair.partition === partition);
    perPartition[partition] = {
      pairs: subset.length,
      positives: subset.filter((pair) => pair.label === 1).length,
      hardNegatives: subset.filter((pair) => pair.labelClass === "hard_negative").length,
      minedHardNegatives: subset.filter((pair) => pair.labelClass === "mined_hard_negative").length,
      sampledNegatives: subset.filter((pair) => pair.labelClass === "sampled_negative").length,
      subjects: new Set(subset.flatMap((pair) => [pair.subjectA, pair.subjectB])).size,
      records: new Set(subset.flatMap((pair) => [pair.aRef, pair.bRef])).size,
    };
  }

  const dataset = {
    datasetId: "cipher-er-pairs",
    datasetVersion: "1.0.0",
    dataClass: "REAL",
    builtAt: new Date().toISOString(),
    seed: SEED,
    sampledNegativesPerPositive: SAMPLED_NEGATIVES_PER_POSITIVE,
    builtFrom: {
      corpus: CORPUS_PATH,
      groundTruth: GROUND_TRUTH_PATH,
      corpusExperiment: groundTruth.experiment,
      rawPayloads: groundTruth.builtFrom,
    },
    sources: groundTruth.sources,
    labelling: {
      inheritedRules: groundTruth.labellingRules,
      derivedRule: {
        mined_hard_negative:
          "The ground truth's own hard-negative rule with its 2..6 group-size restriction lifted. Selection is by name " +
          "collision; the label is the publishers' identifier disagreement. Mined within a partition only.",
        sampled_negative:
          "Two records whose subjects share an identifier scheme and disagree on its value. ISO 17442 assigns one " +
          "LEI per legal entity; the SEC assigns one CIK per filer. Sampled with a fixed seed, within a partition " +
          "only, excluding any pair already labelled.",
      },
      excluded: {
        undetermined: groundTruth.undetermined.length,
        formerNamePairs:
          "Kept as a separate evaluation slice. A former name is a temporal claim by a single authority and is never identity training data.",
        gleifRelationships:
          "All 154 GLEIF Level-2 consolidation edges are EXCLUDED from labels and from features. P6.21.2's policy " +
          "questions are unresolved, and consolidation is not identity: parent, subsidiary, controlled entity and " +
          "consolidation relationships are never treated as the same entity. Frozen, not guessed.",
      },
    },
    splitPolicy: {
      unit: "subject (LEI or CIK)",
      componentRule:
        "Subjects are grouped into connected components by hard-negative edges before assignment, so no labelled pair straddles a partition.",
      heldoutRule:
        "Any component touching a subject the ground truth marked heldout_evaluation is assigned to TEST in whole.",
      trainValidationCut: "75 / 25 of the remaining components, by seeded shuffle.",
      sampledNegativeRule: "Drawn within a partition only.",
    },
    counts: {
      pairs: pairs.length,
      byLabelClass: countBy((pair) => pair.labelClass),
      byPartition: perPartition,
      componentsTotal: componentMembers.size,
      componentsReservedByPriorHeldout: reservedComponents.length,
      schemeBridgesJoined: schemeBridges.length,
      recordBridgesJoined,
      subjectsTotal: partitionOfSubject.size,
      positivesDroppedNoPartitionOrRecord: positivesDropped,
      hardNegativesDroppedCrossPartitionOrUnknown: hardNegativesDropped,
      hardNegativesWithUnknownSubject,
      featureRecords: Object.keys(featureRecords).length,
    },
    partitionOfSubject: Object.fromEntries([...partitionOfSubject.entries()].sort()),
    featureRecords,
    pairs,
    formerNameSlice,
  };

  mkdirSync(path.join(ROOT, OUT_DIR), { recursive: true });
  writeFileSync(path.join(ROOT, OUT_PATH), `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  console.log(`wrote ${OUT_PATH}`);
  console.log(JSON.stringify(dataset.counts, null, 2));
}

main();
