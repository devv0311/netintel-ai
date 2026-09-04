/**
 * P6.19.2 — build the EXPANDED real cross-source corpus and its ground truth.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-expanded-corpus.ts
 *
 * WHAT CHANGED AND WHY.
 *
 * The P6.19.1 audit found three structural defects that no additional
 * record count would fix:
 *   - ONE source pairing. All 75 positives were gleif x wikidata and all
 *     19 hard negatives were gleif x gleif.
 *   - 99.2% Latin script, because the linkage set was filtered to India.
 *   - The "second" corpus (the Devanagari pilot) shared 54 of 75 subjects
 *     with the first, so it was never an independent measurement.
 *
 * This builder addresses all three: a third publisher (SEC EDGAR,
 * SRC-006), a worldwide rather than India-filtered linkage set, and a
 * subject-disjoint split enforced in code.
 *
 * LABELLING RULES — an identifier or an explicit publisher assertion,
 * never a name.
 *
 *   POSITIVE requires ONE of:
 *     lei_shared   two publishers state the same LEI (ISO 17442: one LEI
 *                  denotes one legal entity). GLEIF issues it.
 *     cik_shared   two publishers state the same SEC CIK. The SEC issues it.
 *     former_name  ONE publisher (the SEC) states that the filer with this
 *                  CIK previously filed under this official name. This is
 *                  a TEMPORAL identity claim by an authority, and it is
 *                  kept as its OWN class - it is not a cross-source
 *                  agreement and must never be counted as one.
 *
 *   Corroboration (recorded, never sufficient on its own):
 *     ocid_agrees  both records also state the same OpenCorporates id, a
 *                  scheme neither publisher issues. It raises confidence
 *                  in a label that an authoritative identifier already
 *                  established; it never creates one.
 *
 *   HARD NEGATIVE requires BOTH:
 *     - the two records carry DISTINCT authoritative identifiers, and
 *     - their names actually collide under the SHIPPED normaliser, or
 *       share a leading token. A negative nothing would ever merge is
 *       not hard, and P6.16.2 showed such a set measures nothing.
 *
 *   UNDETERMINED: a record asserting two or more distinct values of one
 *     mergeable scheme names no single legal entity. Kept, never scored.
 *
 * NO NAME SIMILARITY CREATES A LABEL ANYWHERE IN THIS FILE. No variant is
 * manufactured; every string is the publisher's own.
 *
 * LEAKAGE. Subjects already used by the P6.16 evaluation corpus are
 * EXCLUDED outright, so the existing 75-pair instrument stays a valid
 * held-out measurement. What remains is split by SUBJECT (never by pair)
 * into a held-out evaluation half and a training-candidate half, so no
 * entity can appear on both sides.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const OUT = "evidence/expanded";

interface Rec {
  recordRef: string; registry: string; registryRecordId: string; name: string;
  officialName?: string; aliases?: string[];
  identifiers?: { scheme: string; value: string }[];
  jurisdiction?: string; status?: string; observedAt?: string;
  retrievedAt: string; license: string; licenseUrl: string; sourceUrl: string;
  subjectKind: string;
}

const latestDir = (src: string): string => {
  const base = path.join(ROOT, "data/public/raw", src);
  const dirs = fs.readdirSync(base).filter((d) => fs.statSync(path.join(base, d)).isDirectory()).sort();
  return path.join(base, dirs[dirs.length - 1]!);
};
const loadRecords = (src: string): { records: Rec[]; dir: string; manifest: Record<string, unknown> } => {
  const dir = latestDir(src);
  return {
    records: JSON.parse(fs.readFileSync(path.join(dir, "public-records.json"), "utf8")) as Rec[],
    dir: path.relative(ROOT, dir),
    manifest: JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")) as Record<string, unknown>,
  };
};

const idsOf = (r: Rec, scheme: string) => (r.identifiers ?? []).filter((i) => i.scheme === scheme).map((i) => i.value);
const key = (s: string) => normalizeName(s).normalized;

function main(): void {
  const wd = loadRecords("SRC-001");
  const gl = loadRecords("SRC-002");
  const ed = loadRecords("SRC-006");
  const all: Rec[] = [...gl.records, ...wd.records, ...ed.records];

  /* ---- exclude subjects already used by the P6.16 evaluation corpus ---- */
  const priorTruth = JSON.parse(
    fs.readFileSync(path.join(ROOT, "evidence/no-identifier/no-identifier-pilot.ground-truth.json"), "utf8"),
  ) as { positives: { lei: string }[]; surrogateMap: Record<string, { leis: string[] }> };
  const reserved = new Set<string>();
  for (const p of priorTruth.positives) reserved.add(p.lei);
  for (const r of Object.values(priorTruth.surrogateMap)) for (const l of r.leis) reserved.add(l);

  const touchesReserved = (r: Rec) => idsOf(r, "LEI").some((l) => reserved.has(l));
  const excluded = all.filter(touchesReserved);
  const kept = all.filter((r) => !touchesReserved(r));

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

  /* ---- HARD NEGATIVES ----------------------------------------------
   *
   * A negative requires the two records to be COMPARABLE: they must
   * share an identifier SCHEME and disagree on its VALUE. Two different
   * LEIs are two different legal entities (ISO 17442); two different
   * CIKs are two different filers.
   *
   * "Different identifier strings" is NOT the same test, and getting
   * this wrong the first time produced 117 false hard negatives:
   * EDGAR publishes no LEI and GLEIF publishes no CIK, so a GLEIF record
   * and an EDGAR record share NO scheme, and `LEI:x != CIK:y` was read as
   * "different entities" when it actually means "not comparable".
   * `UBER TECHNOLOGIES, INC.` (GLEIF) and `Uber Technologies, Inc`
   * (EDGAR) were labelled a hard negative and the resolver was scored as
   * having falsely merged them — for correctly resolving one company.
   *
   * An incomparable pair is therefore recorded as NOT COMPARABLE and
   * scored as neither. Asserting a negative we cannot support would be
   * exactly the ground-truth weakening this phase forbids.
   */
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

  /* ---- subject-disjoint split ---- */
  const subjects = [...new Set([...positives, ...formerNamePairs].map((p) => p.subject))].sort();
  const half = (s: string) => (parseInt(crypto.createHash("sha256").update(s).digest("hex").slice(0, 8), 16) % 2 === 0 ? "heldout_evaluation" : "training_candidate");
  const split: Record<string, string> = {};
  for (const s of subjects) split[s] = half(s);
  const negSubject = (p: typeof negatives[number]) => p.a.id;

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
    corpus: { name: "expanded-cross-source-anchored", version: "1.0.0", seed: null, generatedAt: new Date().toISOString(),
      description: "REAL collected public-register records from THREE approved publishers (GLEIF SRC-002, Wikidata SRC-001, SEC EDGAR SRC-006; CC0 1.0 / US public domain), worldwide rather than India-filtered. ANCHORED regime: GLEIF keeps the LEI it issues, every other record is stripped, so the shared identifier is unavailable and name evidence is actually exercised. Names, official names and aliases are verbatim publisher strings; NO variant is manufactured. Never to be mixed with Operation DarkNet Delhi, the synthetic fixtures, or the P6.16 no-identifier corpus." },
    investigation: { name: "Expanded cross-source resolution corpus (anchored)", status: "in_progress" },
    evidenceSources: [...new Set(scorable.map((r) => r.registry))].map((k) => ({ key: k, label: `${k} public records (real, anchored)`, sourceType: "structured_dataset" })),
    evidenceItems: anchored,
    // The evidence schema requires these collections to be present even
    // when a corpus of public records has none of them.
    locations: [],
    communicationEvents: [],
    financialTransactions: [],
  };
  fs.writeFileSync(path.join(ROOT, OUT, "expanded-anchored.corpus.json"), `${JSON.stringify(corpus, null, 2)}\n`);

  const truth = {
    experiment: "P6.19 expanded cross-source corpus",
    dataClass: "REAL",
    builtFrom: { wikidata: wd.dir, gleif: gl.dir, edgar: ed.dir },
    sources: [
      { sourceId: "SRC-001", registry: "wikidata", license: "CC0 1.0", channel: wd.manifest.retrievalChannel },
      { sourceId: "SRC-002", registry: "gleif", license: "CC0 1.0", channel: gl.manifest.retrievalChannel },
      { sourceId: "SRC-006", registry: "edgar", license: "US Government work / public domain", channel: ed.manifest.retrievalChannel },
    ],
    labellingRules: {
      positive: "shared LEI (GLEIF-issued) or shared CIK (SEC-issued) stated independently by two publishers",
      formerName: "the SEC states the filer with this CIK previously filed under this official name - a TEMPORAL claim by ONE authority, kept as its own class and never counted as cross-source agreement",
      corroboration: "a shared OpenCorporates id is recorded when present; it never creates a label",
      hardNegative: "the two records SHARE an identifier scheme and DISAGREE on its value (two different LEIs, or two different CIKs), AND their names actually collide. A pair sharing no scheme - GLEIF vs EDGAR, since EDGAR publishes no LEI - is NOT COMPARABLE and is scored as neither positive nor negative.",
      undetermined: "a record asserting 2+ distinct LEIs names no single legal entity",
      forbidden: "no label anywhere is created from name similarity; no name variant is manufactured; no model-generated label is used",
    },
    leakageControl: {
      excludedBecauseUsedByPriorEvaluation: excluded.length,
      priorEvaluationSubjectsReserved: reserved.size,
      splitUnit: "subject (LEI or CIK), never the pair - a subject cannot appear on both sides",
    },
    counts: {
      recordsCollected: all.length, recordsExcludedForLeakage: excluded.length, recordsScorable: scorable.length,
      crossSourcePositives: positives.length, formerNamePairs: formerNamePairs.length,
      hardNegatives: negatives.length, undetermined: undetermined.length,
      nameCollisionsNotComparable: notComparable,
    },
    split,
    positives, formerNamePairs, hardNegatives: negatives, undetermined,
    surrogateMap: Object.fromEntries(scorable.map((r) => [surrogate.get(r.recordRef)!, {
      registry: r.registry, registryRecordId: r.registryRecordId, recordRef: r.recordRef, name: r.name,
      officialName: r.officialName ?? null, leis: [...new Set(idsOf(r, "LEI"))], ciks: [...new Set(idsOf(r, "CIK"))],
      ocids: [...new Set(idsOf(r, "OPENCORPORATES"))],
    }])),
  };
  fs.writeFileSync(path.join(ROOT, OUT, "expanded.ground-truth.json"), `${JSON.stringify(truth, null, 2)}\n`);

  /* ---- report ---- */
  const c = (o: Record<string, number>) => Object.entries(o).sort((a, b) => b[1] - a[1]);
  const varCount: Record<string, number> = {}; for (const p of positives) varCount[p.variation!] = (varCount[p.variation!] ?? 0) + 1;
  const fnVar: Record<string, number> = {}; for (const p of formerNamePairs) fnVar[p.variation!] = (fnVar[p.variation!] ?? 0) + 1;
  const pairing: Record<string, number> = {}; for (const p of positives) pairing[p.sourcePairing] = (pairing[p.sourcePairing] ?? 0) + 1;
  const negPairing: Record<string, number> = {}; for (const p of negatives) negPairing[p.sourcePairing] = (negPairing[p.sourcePairing] ?? 0) + 1;
  const splitCount: Record<string, number> = {}; for (const s of Object.values(split)) splitCount[s] = (splitCount[s] ?? 0) + 1;

  console.log("=".repeat(74));
  console.log("P6.19.2  EXPANDED CROSS-SOURCE CORPUS");
  console.log("=".repeat(74));
  console.log(`records collected            ${all.length}  (gleif ${gl.records.length}, wikidata ${wd.records.length}, edgar ${ed.records.length})`);
  console.log(`excluded - prior eval subject ${excluded.length}   <-- keeps the P6.16 instrument held out`);
  console.log(`undetermined                 ${undetermined.length}`);
  console.log(`scorable records             ${scorable.length}`);
  console.log(`\ncross-source POSITIVES       ${positives.length}`);
  for (const [k, v] of c(pairing)) console.log(`    ${k.padEnd(26)} ${v}`);
  console.log(`former-name pairs (temporal) ${formerNamePairs.length}   [separate class, not cross-source]`);
  console.log(`HARD NEGATIVES               ${negatives.length}`);
  console.log(`name collisions NOT COMPARABLE ${notComparable}  <-- no shared scheme; scored as neither`);
  for (const [k, v] of c(negPairing)) console.log(`    ${k.padEnd(26)} ${v}`);
  console.log(`\ncross-source positives by name variation:`);
  for (const [k, v] of c(varCount)) console.log(`    ${k.padEnd(28)} ${v}`);
  console.log(`former-name pairs by variation:`);
  for (const [k, v] of c(fnVar)) console.log(`    ${k.padEnd(28)} ${v}`);
  console.log(`\ncorroborated by an OpenCorporates id both sides state: ${positives.filter((p) => p.corroboration.length).length}`);
  console.log(`subject-disjoint split: ${JSON.stringify(splitCount)}  over ${subjects.length} subjects`);
  void negSubject;
  console.log(`\nwritten: ${OUT}/expanded-anchored.corpus.json`);
  console.log(`written: ${OUT}/expanded.ground-truth.json`);
}
main();
