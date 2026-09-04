/**
 * P6.25.1 — build the EXPANDED-V2 real cross-source corpus and its ground truth.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-corpus-v2.ts
 *
 * This is `build-expanded-corpus.ts` with exactly two changes. The
 * labelling rules are IDENTICAL, character for character, and are meant
 * to stay that way: a corpus expansion that also moves the definition of
 * a positive is two experiments wearing one name, and neither can be
 * read afterwards.
 *
 * CHANGE 1 — EVERY collection run, not only the latest.
 *
 *   The P6.19 builder calls `latestDir(src)` and reads one directory per
 *   source. That was correct when each source had been collected once.
 *   It is now wrong: SRC-002 has fourteen runs, and reading only the last
 *   of them would have thrown away 1,678 of 1,743 GLEIF records. Runs are
 *   merged in chronological order and de-duplicated by `recordRef`, with
 *   the LATER observation winning — the same record re-collected today is
 *   the publisher's current statement about it, and it is also the one
 *   carrying fields the earlier query never asked for.
 *
 * CHANGE 2 — prior split designations are INHERITED, never recomputed.
 *
 *   A subject that the P6.19 ground truth marked `heldout_evaluation`
 *   keeps that designation here. New subjects — and only new subjects —
 *   are assigned by the same sha256 rule the P6.19 builder used.
 *
 *   This is the whole reason a subject can be trusted not to have been
 *   trained on. Recomputing the split over a larger subject set would
 *   silently re-roll every existing subject, and roughly half the frozen
 *   test would land in TRAIN — the leakage this project spent P6.24
 *   eliminating, reintroduced by an expansion that looks like pure gain.
 *   The inheritance is asserted by the leakage suite (check L11), not
 *   just intended here.
 *
 * WHAT IS NOT CHANGED: no label comes from name similarity; no name
 * variant is manufactured; every string is the publisher's own; the
 * not-comparable rule (GLEIF vs EDGAR share no scheme) still records
 * neither a positive nor a negative.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

/**
 * Parameterised rather than copied.
 *
 * v3 is this same corpus widened with a targeted cross-border collection.
 * The labelling rules must be identical to v2's character for character —
 * a corpus expansion that also moves the definition of a positive is two
 * experiments wearing one name — so the way to guarantee that is to run
 * the same code, not to fork it and promise.
 */
const OUT = arg("out", "evidence/expanded-v2");
const CORPUS_BASENAME = arg("corpus-basename", "expanded-v2");
const CORPUS_NAME = arg("corpus-name", "expanded-cross-source-anchored-v2");
const CORPUS_VERSION = arg("corpus-version", "2.0.0");
const EXPERIMENT = arg("experiment", "P6.25 expanded cross-source corpus v2");
const PRIOR_TRUTH = "evidence/expanded/expanded.ground-truth.json";

/**
 * Datasets whose subjects must not appear in this corpus AT ALL, dropped
 * at the record level before a single pair is formed.
 *
 * Empty for v2, which was built before the P6.25 final test existed. v3
 * passes the final test here: a training corpus that contains the frozen
 * test's entities cannot be trained on safely, and excluding the records
 * outright is stronger than promoting the subjects to held-out, because
 * it removes them from the mined and sampled negatives too — which are
 * DERIVED from whatever records the corpus holds, and were the leak the
 * final-test builder found the hard way.
 */
const EXCLUDE_SUBJECTS_FROM = arg("exclude-subjects-from", "")
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v.length > 0);
/**
 * Every dataset whose TEST partition this build must PROMOTE out of
 * train/validation — the record of what each frozen test ACTUALLY
 * contained, as opposed to what it was designated.
 *
 * The P6.25 final test is deliberately NOT listed, and the reason is
 * worth stating because the omission looks like the bug it is guarding
 * against.
 *
 * The invariant that matters is pair-based: a subject is "trained on"
 * when it contributes PAIRS to train or validation. Leakage check L11
 * enforces exactly that, and it is wired to BOTH frozen tests via
 * `ml:leakage --prior-datasets`. The shipped v2 dataset passes it: the
 * three subjects it shares with the final test (CIK:1534701, CIK:1610520,
 * CIK:823094) carry zero v2 pairs, so the model never saw them.
 *
 * Promoting them anyway would be a no-op protection with a real cost.
 * The train/validation cut below is a positional slice through a
 * Fisher-Yates shuffle of the free components, so removing three
 * components reshuffles the rest: promoting these three moves 222 OTHER
 * subjects across the train/validation boundary and changes the shipped
 * model, to protect against pairs that do not exist.
 *
 * So enforcement lives at the gate, where it is asserted, rather than
 * here, where it would be assumed. If a later collection ever gives one
 * of these subjects a pair, L11 FAILS and blocks the build — which is the
 * outcome wanted, and is strictly better than this file silently
 * absorbing it. Add the final test here at that point, when the corpus is
 * being re-cut anyway and the churn costs nothing.
 */
const PRIOR_PAIR_DATASETS = ["evidence/ml/pair-dataset.json"];

interface Rec {
  recordRef: string; registry: string; registryRecordId: string; name: string;
  officialName?: string; aliases?: string[];
  identifiers?: { scheme: string; value: string }[];
  jurisdiction?: string; status?: string; observedAt?: string;
  retrievedAt: string; license: string; licenseUrl: string; sourceUrl: string;
  subjectKind: string;
}

/**
 * The collection runs this corpus is built from, pinned.
 *
 * The loader below used to read EVERY run directory under
 * `data/public/raw/<src>`. That is correct exactly once — while a corpus
 * is being assembled and nothing downstream depends on it yet. It stops
 * being correct the moment the corpus is frozen and collection continues,
 * because "every run on disk" then silently means "including runs
 * collected for a later, disjoint corpus".
 *
 * That is not hypothetical here. The P6.25 final test was collected into
 * these same three source directories AFTER this corpus was frozen, so
 * rebuilding from the glob grew this corpus from 3,290 scorable records
 * to 5,085 and pulled 417 of the final test's 973 subjects into TRAIN and
 * VALIDATION — destroying the only untouched instrument the project has,
 * while every one of L1-L12 still passed, because a freshly-built split
 * is internally disjoint no matter what it absorbed.
 *
 * So the input is declared, not discovered. `--adopt-runs` re-declares it
 * from disk and rewrites the pin; nothing else may change it.
 */
const PIN_PATH = path.join(ROOT, OUT, "collection-runs.json");
const ADOPT_RUNS = process.argv.includes("--adopt-runs");
const PIN: { runs: Record<string, string[]> } | null =
  !ADOPT_RUNS && fs.existsSync(PIN_PATH)
    ? (JSON.parse(fs.readFileSync(PIN_PATH, "utf8")) as { runs: Record<string, string[]> })
    : null;
if (!PIN && !ADOPT_RUNS) {
  console.warn(`WARNING  no ${PIN_PATH}; reading every collection run on disk. This corpus is not reproducible until the pin exists.`);
}

/**
 * Every run for a source, oldest first, de-duplicated by recordRef with the
 * later observation winning. Returns the run directories it actually read so
 * the ground truth can name its own provenance rather than assert it.
 */
const loadAllRecords = (
  src: string,
): { records: Rec[]; dirs: string[]; manifests: Record<string, unknown>[]; runs: number; rowsRead: number } => {
  const base = path.join(ROOT, "data/public/raw", src);
  const onDisk = fs
    .readdirSync(base)
    .filter((d) => fs.statSync(path.join(base, d)).isDirectory())
    .sort();
  const pinned = PIN?.runs[src];
  if (pinned) {
    const missing = pinned.filter((d) => !onDisk.includes(d));
    if (missing.length > 0) {
      throw new Error(
        `${PIN_PATH} pins ${missing.length} collection run(s) for ${src} that are not on disk: ${missing.join(", ")}. ` +
          `The pin is the corpus's definition of its own input; a missing run means this corpus cannot be rebuilt, not that it should be rebuilt smaller.`,
      );
    }
  }
  const runDirs = pinned ? onDisk.filter((d) => pinned.includes(d)) : onDisk;
  const byRef = new Map<string, Rec>();
  const dirs: string[] = [];
  const manifests: Record<string, unknown>[] = [];
  let rowsRead = 0;
  for (const d of runDirs) {
    const dir = path.join(base, d);
    const recordsPath = path.join(dir, "public-records.json");
    const manifestPath = path.join(dir, "manifest.json");
    // A run directory holding only raw payloads (no transformed records) is
    // skipped rather than treated as an empty run.
    if (!fs.existsSync(recordsPath) || !fs.existsSync(manifestPath)) continue;
    const records = JSON.parse(fs.readFileSync(recordsPath, "utf8")) as Rec[];
    rowsRead += records.length;
    for (const r of records) byRef.set(r.recordRef, r);
    dirs.push(path.relative(ROOT, dir));
    manifests.push(JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Record<string, unknown>);
  }
  return {
    records: [...byRef.values()].sort((a, b) => a.recordRef.localeCompare(b.recordRef)),
    dirs, manifests, runs: dirs.length, rowsRead,
  };
};

const idsOf = (r: Rec, scheme: string) => (r.identifiers ?? []).filter((i) => i.scheme === scheme).map((i) => i.value);
const key = (s: string) => normalizeName(s).normalized;

function main(): void {
  const wd = loadAllRecords("SRC-001");
  const gl = loadAllRecords("SRC-002");
  const ed = loadAllRecords("SRC-006");
  const all: Rec[] = [...gl.records, ...wd.records, ...ed.records];

  /* ---- exclude subjects already used by the P6.16 evaluation corpus ---- */
  const priorTruth = JSON.parse(
    fs.readFileSync(path.join(ROOT, "evidence/no-identifier/no-identifier-pilot.ground-truth.json"), "utf8"),
  ) as { positives: { lei: string }[]; surrogateMap: Record<string, { leis: string[] }> };
  const reserved = new Set<string>();
  for (const p of priorTruth.positives) reserved.add(p.lei);
  for (const r of Object.values(priorTruth.surrogateMap)) for (const l of r.leis) reserved.add(l);

  const touchesReserved = (r: Rec) => idsOf(r, "LEI").some((l) => reserved.has(l));

  /* ---- exclude every subject a frozen test already holds ---- */
  const frozenSubjects = new Set<string>();
  const frozenProvenance: { dataset: string; subjects: number }[] = [];
  for (const priorPath of EXCLUDE_SUBJECTS_FROM) {
    const prior = JSON.parse(fs.readFileSync(path.join(ROOT, priorPath), "utf8")) as {
      pairs: { subject?: string; subjectA?: string; subjectB?: string }[];
      partitionOfSubject?: Record<string, string>;
    };
    let added = 0;
    const see = (subject: string | undefined) => {
      if (subject && !frozenSubjects.has(subject)) {
        frozenSubjects.add(subject);
        added++;
      }
    };
    for (const pair of prior.pairs) {
      see(pair.subject);
      see(pair.subjectA);
      see(pair.subjectB);
    }
    // Both the pairs AND the partition map. Reading only the pairs is what
    // let three subjects cross between the v2 dataset and the P6.25 final
    // test: a subject can be assigned a partition and still emit no pair,
    // and a pair-only scan cannot see it.
    for (const subject of Object.keys(prior.partitionOfSubject ?? {})) see(subject);
    frozenProvenance.push({ dataset: priorPath, subjects: added });
  }
  const touchesFrozen = (r: Rec) =>
    idsOf(r, "LEI").some((v) => frozenSubjects.has(`LEI:${v}`)) ||
    idsOf(r, "CIK").some((v) => frozenSubjects.has(`CIK:${v}`));

  const excluded = all.filter((r) => touchesReserved(r) || touchesFrozen(r));
  const kept = all.filter((r) => !touchesReserved(r) && !touchesFrozen(r));
  const droppedAsFrozen = all.filter((r) => !touchesReserved(r) && touchesFrozen(r)).length;

  /* ---- undetermined: a record contradicting itself on a mergeable scheme ---- */
  const undetermined = kept.filter((r) => new Set(idsOf(r, "LEI")).size > 1)
    .map((r) => ({ recordRef: r.recordRef, registry: r.registry, name: r.name, leis: [...new Set(idsOf(r, "LEI"))],
      reason: "Record states 2+ distinct LEIs. An LEI denotes one legal entity, so at most one can be right and the record does not say which. Kept, excluded from scoring." }));
  const undetRefs = new Set(undetermined.map((u) => u.recordRef));
  const scorable = kept.filter((r) => !undetRefs.has(r.recordRef));

  /* ---- POSITIVES ---- */
  type Pair = {
    pairId: string; basis: "lei_shared" | "cik_shared" | "former_name";
    sourcePairing: string; corroboration: string[];
    a: { recordRef: string; registry: string; name: string };
    b: { recordRef: string; registry: string; name: string };
    subject: string; variation?: string;
  };
  const positives: Pair[] = [];
  let n = 0;
  const pid = () => `EP-${String(++n).padStart(4, "0")}`;

  const byScheme = (scheme: string) => {
    const m = new Map<string, Rec[]>();
    for (const r of scorable) for (const v of new Set(idsOf(r, scheme))) {
      if (!m.has(v)) m.set(v, []); m.get(v)!.push(r);
    }
    return m;
  };
  const classify = (a: string, b: string): string => {
    const ka = key(a), kb = key(b);
    if (a === b) return "identical";
    if (ka === kb) return a.toLowerCase() === b.toLowerCase() ? "case_only" : "legal_suffix_or_punctuation";
    const ta = ka.split(" ").filter(Boolean), tb = kb.split(" ").filter(Boolean);
    if (ta.every((t, i) => t === tb[i]) || tb.every((t, i) => t === ta[i])) return "containment";
    if (ta.some((t) => tb.includes(t))) return "partial_token_overlap";
    const scr = (s: string) => [...s].some((c) => c.codePointAt(0)! > 0x2e80);
    if (scr(a) !== scr(b)) return "script_variant";
    return "divergent";
  };

  for (const [lei, recs] of byScheme("LEI")) {
    const g = recs.filter((r) => r.registry === "gleif"), w = recs.filter((r) => r.registry === "wikidata");
    for (const a of g) for (const b of w) {
      const oa = new Set(idsOf(a, "OPENCORPORATES")), ob = idsOf(b, "OPENCORPORATES");
      positives.push({ pairId: pid(), basis: "lei_shared", sourcePairing: "gleif x wikidata",
        corroboration: ob.some((v) => oa.has(v)) ? ["ocid_agrees"] : [],
        a: { recordRef: a.recordRef, registry: a.registry, name: a.name },
        b: { recordRef: b.recordRef, registry: b.registry, name: b.name },
        subject: `LEI:${lei}`, variation: classify(a.name, b.name) });
    }
  }
  for (const [cik, recs] of byScheme("CIK")) {
    const e = recs.filter((r) => r.registry === "edgar"), w = recs.filter((r) => r.registry === "wikidata");
    for (const a of e) for (const b of w) {
      positives.push({ pairId: pid(), basis: "cik_shared", sourcePairing: "edgar x wikidata", corroboration: [],
        a: { recordRef: a.recordRef, registry: a.registry, name: a.name },
        b: { recordRef: b.recordRef, registry: b.registry, name: b.name },
        subject: `CIK:${cik}`, variation: classify(a.name, b.name) });
    }
  }
  /* former names: ONE authority, TWO of its own official names, over time. */
  const formerNamePairs: Pair[] = [];
  for (const r of scorable.filter((x) => x.registry === "edgar")) {
    const cik = idsOf(r, "CIK")[0]; if (!cik) continue;
    for (const former of r.aliases ?? []) {
      formerNamePairs.push({ pairId: `EF-${String(formerNamePairs.length + 1).padStart(4, "0")}`,
        basis: "former_name", sourcePairing: "edgar (temporal, same authority)", corroboration: [],
        a: { recordRef: r.recordRef, registry: "edgar", name: r.name },
        b: { recordRef: `${r.recordRef}#former`, registry: "edgar", name: former },
        subject: `CIK:${cik}`, variation: classify(r.name, former) });
    }
  }

  /* ---- HARD NEGATIVES — see build-expanded-corpus.ts for the full rationale.
   * A negative requires the two records to be COMPARABLE: they must share an
   * identifier SCHEME and disagree on its VALUE. "Different identifier
   * strings" is NOT the same test — EDGAR publishes no LEI and GLEIF no CIK,
   * so such a pair is NOT COMPARABLE and is scored as neither. */
  const schemesOf = (r: Rec) => {
    const m = new Map<string, Set<string>>();
    for (const i of r.identifiers ?? []) {
      if (i.scheme !== "LEI" && i.scheme !== "CIK") continue;
      if (!m.has(i.scheme)) m.set(i.scheme, new Set());
      m.get(i.scheme)!.add(i.value);
    }
    return m;
  };
  type Verdict = { comparable: false } | { comparable: true; same: boolean; scheme: string };
  const compare = (a: Rec, b: Rec): Verdict => {
    const sa = schemesOf(a), sb = schemesOf(b);
    for (const scheme of ["LEI", "CIK"]) {
      const va = sa.get(scheme), vb = sb.get(scheme);
      if (!va || !vb) continue;
      const overlap = [...va].some((v) => vb.has(v));
      if (overlap) return { comparable: true, same: true, scheme };
      return { comparable: true, same: false, scheme };
    }
    return { comparable: false };
  };

  const withId = scorable.filter((r) => schemesOf(r).size > 0);
  const negatives: { pairId: string; basis: string; scheme: string; sourcePairing: string;
    a: { recordRef: string; registry: string; name: string; id: string };
    b: { recordRef: string; registry: string; name: string; id: string } }[] = [];
  let notComparable = 0;
  const seen = new Set<string>();
  const push = (a: Rec, b: Rec, basis: string) => {
    const k = [a.recordRef, b.recordRef].sort().join("|"); if (seen.has(k)) return; seen.add(k);
    const v = compare(a, b);
    if (!v.comparable) { notComparable++; return; }
    if (v.same) return;                       // same entity: not a negative
    const idOf = (r: Rec) => `${v.scheme}:${[...schemesOf(r).get(v.scheme)!].sort()[0]}`;
    negatives.push({ pairId: `EN-${String(negatives.length + 1).padStart(4, "0")}`, basis, scheme: v.scheme,
      sourcePairing: [a.registry, b.registry].sort().join(" x "),
      a: { recordRef: a.recordRef, registry: a.registry, name: a.name, id: idOf(a) },
      b: { recordRef: b.recordRef, registry: b.registry, name: b.name, id: idOf(b) } });
  };
  const byKey = new Map<string, Rec[]>();
  for (const r of withId) { const k = key(r.name); if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(r); }
  for (const recs of byKey.values()) for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++)
    push(recs[i]!, recs[j]!, "normalised_name_collision");
  const byLead = new Map<string, Rec[]>();
  for (const r of withId) { const t = key(r.name).split(" ")[0]; if (!t) continue; if (!byLead.has(t)) byLead.set(t, []); byLead.get(t)!.push(r); }
  for (const recs of [...byLead.values()].filter((v) => v.length > 1 && v.length <= 6))
    for (let i = 0; i < recs.length; i++) for (let j = i + 1; j < recs.length; j++)
      push(recs[i]!, recs[j]!, "shared_leading_token");

  /* ---- subject split: INHERIT the prior designation, assign only what is new ----
   *
   * There are TWO records of what was already frozen, and only using both is
   * safe.
   *
   *   The ground truth's `split` map says what each subject was DESIGNATED.
   *   The v1 pair dataset says which partition each subject ACTUALLY landed
   *   in, and those disagree: the pair builder sends a whole component to
   *   TEST when any member touches a held-out subject, so a subject
   *   designated `training_candidate` can still have been frozen into the
   *   test partition by contagion through its component.
   *
   * Inheriting the designation alone is therefore not enough, and this is
   * not hypothetical — it was measured. Five subjects (LEI:315700...66831,
   * LEI:300300...C194, LEI:9KOGW2...F485, LEI:549300...3Q14 and
   * LEI:529900...US20) sat in the P6.24 frozen test through contagion, and
   * with the larger record set their components no longer touch a held-out
   * subject, so a designation-only inheritance put four of them in TRAIN and
   * one in VALIDATION. The frozen test would have been quietly trained on.
   *
   * So the v1 dataset's own test membership is read back and PROMOTED to
   * `heldout_evaluation`. That makes the promotion permanent: it is now a
   * designation, not a side effect of a component boundary that can move
   * again. Check L11 in the leakage suite asserts the result rather than
   * trusting this comment.
   */
  const prior = JSON.parse(fs.readFileSync(path.join(ROOT, PRIOR_TRUTH), "utf8")) as { split: Record<string, string> };
  const priorSplit: Record<string, string> = { ...prior.split };
  let promotedFromFrozenTest = 0;
  for (const priorPath of PRIOR_PAIR_DATASETS) {
    const priorDatasetPath = path.join(ROOT, priorPath);
    if (!fs.existsSync(priorDatasetPath)) continue;
    const priorDataset = JSON.parse(fs.readFileSync(priorDatasetPath, "utf8")) as {
      pairs: { partition: string; subject?: string; subjectA?: string; subjectB?: string }[];
    };
    for (const p of priorDataset.pairs) {
      if (p.partition !== "test") continue;
      for (const s of [p.subject, p.subjectA, p.subjectB]) {
        if (s && priorSplit[s] !== "heldout_evaluation") {
          priorSplit[s] = "heldout_evaluation";
          promotedFromFrozenTest++;
        }
      }
    }
  }

  const subjects = [...new Set([...positives, ...formerNamePairs].map((p) => p.subject))].sort();
  const half = (s: string) => (parseInt(crypto.createHash("sha256").update(s).digest("hex").slice(0, 8), 16) % 2 === 0 ? "heldout_evaluation" : "training_candidate");
  const split: Record<string, string> = {};
  let inherited = 0, assigned = 0;
  for (const s of subjects) {
    if (priorSplit[s]) { split[s] = priorSplit[s]!; inherited++; }
    else { split[s] = half(s); assigned++; }
  }
  // A subject the prior ground truth held out but which no longer emits a pair
  // here would otherwise vanish from the map and could be re-rolled by a later
  // build. Carrying it forward costs nothing and keeps the reservation total.
  let carriedForward = 0;
  for (const [s, v] of Object.entries(priorSplit)) {
    if (!(s in split)) { split[s] = v; carriedForward++; }
  }

  /* ---- corpus files, ANCHORED regime (GLEIF keeps the LEI it issues) ---- */
  const surrogate = new Map<string, string>();
  let sn = 0;
  for (const r of scorable) surrogate.set(r.recordRef, `EXP-${String(++sn).padStart(4, "0")}`);
  const anchored = scorable.map((r) => {
    const sur = surrogate.get(r.recordRef)!;
    const keepId = r.registry === "gleif";
    const c: Record<string, unknown> = {
      recordRef: `${r.registry}:${keepId ? r.registryRecordId : sur}`,
      registry: r.registry, registryRecordId: keepId ? r.registryRecordId : sur,
      subjectKind: r.subjectKind, name: r.name,
      ...(r.officialName ? { officialName: r.officialName } : {}),
      ...(r.aliases?.length ? { aliases: r.aliases } : {}),
      ...(keepId ? { identifiers: (r.identifiers ?? []).filter((i) => i.scheme === "LEI") } : {}),
      ...(r.jurisdiction ? { jurisdiction: r.jurisdiction } : {}),
      ...(r.status ? { status: r.status } : {}),
      ...(r.observedAt ? { observedAt: r.observedAt } : {}),
      retrievedAt: r.retrievedAt, license: r.license, licenseUrl: r.licenseUrl,
      sourceUrl: keepId ? r.sourceUrl : `https://${r.registry}.invalid/masked/${sur}`,
    };
    return { sourceKey: r.registry, ref: c.recordRef as string, itemType: "public_record", content: c };
  });

  fs.mkdirSync(path.join(ROOT, OUT), { recursive: true });
  const corpus = {
    corpus: { name: CORPUS_NAME, version: CORPUS_VERSION, seed: null, generatedAt: new Date().toISOString(),
      description: "REAL collected public-register records from THREE approved publishers (GLEIF SRC-002, Wikidata SRC-001, SEC EDGAR SRC-006; CC0 1.0 / US public domain), merged across every collection run. Adds the publisher-stated country (Wikidata P17 -> P297) that the P6.24 corpus lacked entirely, so jurisdiction is comparable across publishers. ANCHORED regime: GLEIF keeps the LEI it issues, every other record is stripped, so the shared identifier is unavailable and name evidence is actually exercised. Names, official names and aliases are verbatim publisher strings; NO variant is manufactured. Never to be mixed with Operation DarkNet Delhi, the synthetic fixtures, or the P6.16 no-identifier corpus." },
    investigation: { name: "Expanded cross-source resolution corpus v2 (anchored)", status: "in_progress" },
    evidenceSources: [...new Set(scorable.map((r) => r.registry))].map((k) => ({ key: k, label: `${k} public records (real, anchored)`, sourceType: "structured_dataset" })),
    evidenceItems: anchored,
    locations: [],
    communicationEvents: [],
    financialTransactions: [],
  };
  fs.writeFileSync(path.join(ROOT, OUT, `${CORPUS_BASENAME}-anchored.corpus.json`), `${JSON.stringify(corpus, null, 2)}\n`);

  const truth = {
    experiment: EXPERIMENT,
    dataClass: "REAL",
    builtFrom: { wikidata: wd.dirs, gleif: gl.dirs, edgar: ed.dirs },
    collectionRuns: { wikidata: wd.runs, gleif: gl.runs, edgar: ed.runs },
    ...(EXCLUDE_SUBJECTS_FROM.length > 0
      ? { excludedFrozenTestSubjects: frozenProvenance, excludedFrozenTestRecords: droppedAsFrozen }
      : {}),
    sources: [
      { sourceId: "SRC-001", registry: "wikidata", license: "CC0 1.0", licenseUrl: "https://www.wikidata.org/wiki/Wikidata:Data_access", channels: [...new Set(wd.manifests.map((m) => m.retrievalChannel))] },
      { sourceId: "SRC-002", registry: "gleif", license: "CC0 1.0", licenseUrl: "https://www.gleif.org/en/meta/lei-data-terms-of-use", channels: [...new Set(gl.manifests.map((m) => m.retrievalChannel))] },
      { sourceId: "SRC-006", registry: "edgar", license: "US Government work / public domain", licenseUrl: "https://www.sec.gov/os/webmaster-faq", channels: [...new Set(ed.manifests.map((m) => m.retrievalChannel))] },
    ],
    labellingRules: {
      positive: "shared LEI (GLEIF-issued) or shared CIK (SEC-issued) stated independently by two publishers",
      formerName: "the SEC states the filer with this CIK previously filed under this official name - a TEMPORAL claim by ONE authority, kept as its own class and never counted as cross-source agreement",
      corroboration: "a shared OpenCorporates id is recorded when present; it never creates a label",
      hardNegative: "the two records SHARE an identifier scheme and DISAGREE on its value (two different LEIs, or two different CIKs), AND their names actually collide. A pair sharing no scheme - GLEIF vs EDGAR, since EDGAR publishes no LEI - is NOT COMPARABLE and is scored as neither positive nor negative.",
      undetermined: "a record asserting 2+ distinct LEIs names no single legal entity",
      forbidden: "no label anywhere is created from name similarity; no name variant is manufactured; no model-generated label is used",
      jurisdictionIsNotALabel: "the country a publisher states (Wikidata P17 -> P297, GLEIF entity.jurisdiction, EDGAR stateOfIncorporation) is a FEATURE field only. Agreement on it never creates a positive and disagreement never creates a negative.",
    },
    leakageControl: {
      excludedBecauseUsedByPriorEvaluation: excluded.length,
      priorEvaluationSubjectsReserved: reserved.size,
      splitUnit: "subject (LEI or CIK), never the pair - a subject cannot appear on both sides",
      splitInheritance: `${inherited} subject(s) kept the designation they already had; ${assigned} new subject(s) were assigned by the same sha256 rule; ${carriedForward} prior subject(s) with no pair here were carried forward so they stay reserved. No subject was re-rolled.`,
      frozenTestPromotion: `${promotedFromFrozenTest} subject(s) that the P6.24 pair dataset actually placed in the frozen TEST partition were promoted to heldout_evaluation, whatever the P6.19 ground truth had designated them. A subject that has once been frozen can never enter TRAIN.`,
    },
    counts: {
      recordsCollected: all.length, recordsExcludedForLeakage: excluded.length, recordsScorable: scorable.length,
      crossSourcePositives: positives.length, formerNamePairs: formerNamePairs.length,
      hardNegatives: negatives.length, undetermined: undetermined.length,
      nameCollisionsNotComparable: notComparable,
      recordsWithJurisdiction: scorable.filter((r) => r.jurisdiction).length,
      distinctJurisdictions: new Set(scorable.map((r) => r.jurisdiction).filter(Boolean)).size,
    },
    split,
    positives, formerNamePairs, hardNegatives: negatives, undetermined,
    surrogateMap: Object.fromEntries(scorable.map((r) => [surrogate.get(r.recordRef)!, {
      registry: r.registry, registryRecordId: r.registryRecordId, recordRef: r.recordRef, name: r.name,
      officialName: r.officialName ?? null, leis: [...new Set(idsOf(r, "LEI"))], ciks: [...new Set(idsOf(r, "CIK"))],
      ocids: [...new Set(idsOf(r, "OPENCORPORATES"))],
    }])),
  };
  fs.writeFileSync(path.join(ROOT, OUT, `${CORPUS_BASENAME}.ground-truth.json`), `${JSON.stringify(truth, null, 2)}\n`);

  if (ADOPT_RUNS) {
    const pin = {
      note:
        "The EXACT collection runs this corpus is built from. The builders read these and only these. " +
        "Without this pin the loader globs every run directory under data/public/raw/<src>, so any later " +
        "collection silently enters an earlier, frozen corpus - which is how the P6.25 final test's own " +
        "collection runs came to be swept into the v2 TRAINING corpus. Regenerate deliberately with " +
        "--adopt-runs, never incidentally.",
      runs: {
        "SRC-001": wd.dirs.map((d) => path.basename(d)),
        "SRC-002": gl.dirs.map((d) => path.basename(d)),
        "SRC-006": ed.dirs.map((d) => path.basename(d)),
      },
    };
    fs.writeFileSync(path.join(ROOT, OUT, "collection-runs.json"), `${JSON.stringify(pin, null, 2)}\n`);
    console.log(`ADOPTED collection runs -> ${path.join(OUT, "collection-runs.json")}`);
  }

  /* ---- report ---- */
  const c = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const varCount: Record<string, number> = {}; for (const p of positives) varCount[p.variation!] = (varCount[p.variation!] ?? 0) + 1;
  const pairing: Record<string, number> = {}; for (const p of positives) pairing[p.sourcePairing] = (pairing[p.sourcePairing] ?? 0) + 1;
  const negPairing: Record<string, number> = {}; for (const p of negatives) negPairing[p.sourcePairing] = (negPairing[p.sourcePairing] ?? 0) + 1;
  const splitCount: Record<string, number> = {}; for (const s of Object.values(split)) splitCount[s] = (splitCount[s] ?? 0) + 1;

  console.log("=".repeat(74));
  console.log("P6.25.1  EXPANDED CROSS-SOURCE CORPUS v2");
  console.log("=".repeat(74));
  if (EXCLUDE_SUBJECTS_FROM.length > 0) {
    console.log(`excluded - frozen-test subject ${droppedAsFrozen} record(s) over ${frozenSubjects.size} subject(s) from ${EXCLUDE_SUBJECTS_FROM.join(", ")}`);
  }
  console.log(`collection runs merged       gleif ${gl.runs}, wikidata ${wd.runs}, edgar ${ed.runs}`);
  console.log(`rows read across runs        ${gl.rowsRead + wd.rowsRead + ed.rowsRead}`);
  console.log(`distinct records             ${all.length}  (gleif ${gl.records.length}, wikidata ${wd.records.length}, edgar ${ed.records.length})`);
  console.log(`excluded - prior eval subject ${excluded.length}   <-- keeps the P6.16 instrument held out`);
  console.log(`undetermined                 ${undetermined.length}`);
  console.log(`scorable records             ${scorable.length}`);
  console.log(`with a stated jurisdiction   ${scorable.filter((r) => r.jurisdiction).length}  over ${new Set(scorable.map((r) => r.jurisdiction).filter(Boolean)).size} distinct jurisdictions`);
  console.log(`\ncross-source POSITIVES       ${positives.length}`);
  for (const [k, v] of c(pairing)) console.log(`    ${k.padEnd(26)} ${v}`);
  console.log(`former-name pairs (temporal) ${formerNamePairs.length}   [separate class, not cross-source]`);
  console.log(`HARD NEGATIVES               ${negatives.length}`);
  console.log(`name collisions NOT COMPARABLE ${notComparable}  <-- no shared scheme; scored as neither`);
  for (const [k, v] of c(negPairing)) console.log(`    ${k.padEnd(26)} ${v}`);
  console.log(`\ncross-source positives by name variation:`);
  for (const [k, v] of c(varCount)) console.log(`    ${k.padEnd(28)} ${v}`);
  console.log(`\nsplit: ${JSON.stringify(splitCount)}  over ${Object.keys(split).length} subjects`);
  console.log(`   inherited ${inherited}   newly assigned ${assigned}   carried forward ${carriedForward}`);
  console.log(`   promoted to heldout because the P6.24 frozen test contained them: ${promotedFromFrozenTest}`);
  console.log(`\nwritten: ${OUT}/${CORPUS_BASENAME}-anchored.corpus.json`);
  console.log(`written: ${OUT}/${CORPUS_BASENAME}.ground-truth.json`);
}
main();
