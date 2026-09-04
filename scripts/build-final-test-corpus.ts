/**
 * P6.25.5 — build the FINAL FROZEN TEST corpus.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-final-test-corpus.ts
 *
 * WHY A THIRD CORPUS EXISTS.
 *
 * The v2 held-out partition stopped being an untouched exam the moment it
 * informed a development decision, and it did. Its false merges were read,
 * they were overwhelmingly corporate-family pairs (Allergan plc against
 * Allergan Finance LLC, Novartis AG against Novartis Pharma AG, Simon
 * Property Group Inc against its L.P.), and two features were added in
 * response. Model SELECTION never touched it — that was always the
 * validation partition — but feature design did, and a test set that
 * shaped the feature set is no longer measuring generalisation to unseen
 * data. Reporting it as though it had stayed frozen would be the exact
 * self-deception the leakage suite exists to prevent.
 *
 * So this corpus is built from entities collected AFTER that work was
 * finished, and every subject that appears anywhere in the v1 or v2
 * datasets — in any partition — is excluded outright. What remains has
 * informed no feature, no hyperparameter, no threshold and no selection.
 * It is scored ONCE, at the end, and whatever it says is the number.
 *
 * The collection is nine bounded country queries (IN, GB, FR, JP, AU, BR,
 * ZA, SG plus what they bridge to), which also widens jurisdiction
 * coverage beyond the US/DE/CZ/NO concentration an unordered worldwide
 * LIMIT returns.
 *
 * LABELLING RULES ARE UNCHANGED from P6.19 and P6.25.1, character for
 * character. A final test that also moved the definition of a positive
 * would measure nothing.
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
 * Parameterised rather than copied, for the same reason the training
 * corpus builder is: the labelling rules must be identical character for
 * character across every corpus, and running the same code is the only
 * way to guarantee that rather than promise it.
 */
const OUT = arg("out", "evidence/final-test");
const CORPUS_BASENAME = arg("corpus-basename", "final-test");
const CORPUS_NAME = arg("corpus-name", "final-frozen-test-anchored");
const CORPUS_VERSION = arg("corpus-version", "2.0.0");
const EXPERIMENT = arg("experiment", "P6.25.5 final frozen test corpus");
const PRIOR_TRUTH = "evidence/expanded/expanded.ground-truth.json";
/**
 * Every dataset whose subjects must NOT appear here, in ANY partition.
 * This is stricter than the v2 builder's frozen-test ratchet: there the
 * question was "was this subject ever frozen?", here it is "has this
 * subject ever been seen at all?".
 */
const PRIOR_PAIR_DATASETS = arg(
  "prior-datasets",
  "evidence/ml/pair-dataset.json,evidence/ml/pair-dataset-v2.json",
)
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v.length > 0);

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

  const seenSubjects = new Set<string>();
  const seenProvenance: { dataset: string; subjects: number }[] = [];
  for (const priorPath of PRIOR_PAIR_DATASETS) {
    const priorDataset = JSON.parse(fs.readFileSync(path.join(ROOT, priorPath), "utf8")) as {
      pairs: { subjectA?: string; subjectB?: string; subject?: string }[];
    };
    let added = 0;
    const see = (subject: string | undefined) => {
      if (subject && !seenSubjects.has(subject)) {
        seenSubjects.add(subject);
        added++;
      }
    };
    for (const pair of priorDataset.pairs) {
      see(pair.subject);
      see(pair.subjectA);
      see(pair.subjectB);
    }
    seenProvenance.push({ dataset: priorPath, subjects: added });
  }


  // Excluded at the RECORD level, not merely the pair level.
  //
  // Filtering only the labelled pairs is not enough and the first build
  // proved it: 1,563 of 2,520 subjects still appeared, because the mined
  // and sampled negatives are DERIVED here from whatever records the
  // corpus holds, and the corpus holds every record ever collected. The
  // positives were clean and the negatives were not. A record belonging to
  // a subject any earlier dataset has seen is therefore dropped outright,
  // before a single pair is formed.
  const seenRecord = (r: Rec) =>
    idsOf(r, "LEI").some((v) => seenSubjects.has(`LEI:${v}`)) ||
    idsOf(r, "CIK").some((v) => seenSubjects.has(`CIK:${v}`));

  const excluded = all.filter((r) => touchesReserved(r) || seenRecord(r));
  const kept = all.filter((r) => !touchesReserved(r) && !seenRecord(r));
  const droppedAsSeenRecords = all.filter((r) => !touchesReserved(r) && seenRecord(r)).length;

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

  /* ---- every subject is TEST, and every previously seen subject is gone ----
   *
   * There is no split to compute. This corpus is one partition by
   * construction: nothing here is ever fitted on, so a train/validation
   * cut would only invite someone to fit on it later.
   *
   * The exclusion runs over SUBJECTS, not records, and over every
   * partition of every earlier dataset. A subject seen in v1's TRAIN is
   * as disqualifying as one seen in v2's TEST — the question this corpus
   * answers is how the model does on entities it has never encountered in
   * any role.
   */
  const positivesBefore = positives.length;
  const negativesBefore = negatives.length;
  const freshPositives = positives.filter((p) => !seenSubjects.has(p.subject));
  const freshFormerNames = formerNamePairs.filter((p) => !seenSubjects.has(p.subject));
  // A negative names its two subjects through its per-side identifiers.
  const freshNegatives = negatives.filter((p) => !seenSubjects.has(p.a.id) && !seenSubjects.has(p.b.id));
  positives.length = 0;
  positives.push(...freshPositives);
  formerNamePairs.length = 0;
  formerNamePairs.push(...freshFormerNames);
  negatives.length = 0;
  negatives.push(...freshNegatives);

  const droppedPositives = positivesBefore - positives.length;
  const droppedNegatives = negativesBefore - negatives.length;

  const subjects = [...new Set([...positives, ...formerNamePairs].map((p) => p.subject))].sort();
  const split: Record<string, string> = {};
  for (const s of subjects) split[s] = "heldout_evaluation";

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
    investigation: { name: "Final frozen test corpus (anchored)", status: "in_progress" },
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
      everySubjectIsHeldOut: "This corpus has ONE partition. Nothing in it is ever fitted on.",
      previouslySeenSubjectsExcluded: seenProvenance,
      droppedBecausePreviouslySeen: {
        records: droppedAsSeenRecords,
        positives: droppedPositives,
        hardNegatives: droppedNegatives,
      },
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
  
  console.log("=".repeat(74));
  console.log("P6.25.5  FINAL FROZEN TEST CORPUS");
  console.log("=".repeat(74));
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
  console.log(`\nALL ${Object.keys(split).length} subjects are heldout_evaluation. Nothing here is ever fitted on.`);
  console.log(
    `   dropped as previously seen: ${droppedAsSeenRecords} record(s), ` +
      `${droppedPositives} positive(s), ${droppedNegatives} hard negative(s)`,
  );
  console.log(`\nwritten: ${OUT}/${CORPUS_BASENAME}-anchored.corpus.json`);
  console.log(`written: ${OUT}/${CORPUS_BASENAME}.ground-truth.json`);
}
main();
