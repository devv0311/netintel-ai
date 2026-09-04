/**
 * P6.18 - can the 22 remaining real positive failures be closed with
 * DETERMINISTIC evidence, and what would each rule cost?
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/deterministic-evidence-study.ts
 *
 * THIS SCRIPT CHANGES NOTHING. Like scripts/alias-evidence-study.ts it
 * does not import the resolver, does not run the pipeline and writes no
 * database. It replays the resolver's own normalisation over the same
 * real corpus and reports what each CANDIDATE rule WOULD have decided.
 *
 * Method. Every rule is scored by the pairs it would merge across the
 * WHOLE 257-record corpus, not merely across the 22 pairs it is meant to
 * fix - otherwise the measurement would report benefit and never cost. A
 * proposed merge is CORRECT when the two records share an LEI in the
 * ground truth and a FALSE MERGE when they do not. Merges are unioned,
 * because the resolver's own clustering is union-find and transitivity
 * is where a single bad edge does its damage.
 *
 * The simulation is validated before any delta is read: the baseline
 * rule (normalised-key equality, i.e. today's Tier B2) must reproduce
 * the measured 53/75. If it does not, the harness is wrong and no
 * number below it means anything.
 *
 * Ground truth is READ ONLY. No name variant is manufactured anywhere in
 * this file: every string compared is a publisher's own.
 */
import fs from "node:fs";
import path from "node:path";

import { normalizeName, LEGAL_SUFFIXES } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const BASE = "evidence/no-identifier/no-identifier-pilot";

interface TruthRecord { registry: string; registryRecordId: string; name: string; leis: string[] }
interface Truth {
  positives: { pairId: string; lei: string; gleifSurrogate: string; wikidataSurrogate: string; gleifName: string; wikidataName: string }[];
  hardNegatives: { pairId: string; basis: string; a: { surrogate: string; registry: string; name: string; lei: string }; b: { surrogate: string; registry: string; name: string; lei: string } }[];
  undetermined: { wikidataSurrogate: string; name: string; leis: string[] }[];
  surrogateMap: Record<string, TruthRecord>;
}

interface Rec { sur: string; registry: string; name: string; leis: string[]; undetermined: boolean }

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

/* ------------------------------------------------------------------ */
/* Union-find - the same shape the resolver uses, so transitive damage  */
/* shows up here exactly as it would there.                             */
/* ------------------------------------------------------------------ */
class UF {
  private p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = this.p.get(x)!;
    while (r !== this.p.get(r)!) r = this.p.get(r)!;
    let c = x;
    while (c !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string): void { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
  same(a: string, b: string): boolean { return this.find(a) === this.find(b); }
  groups(): Map<string, string[]> {
    const g = new Map<string, string[]>();
    for (const k of this.p.keys()) { const r = this.find(k); if (!g.has(r)) g.set(r, []); g.get(r)!.push(k); }
    return g;
  }
}

/* ------------------------------------------------------------------ */
/* Candidate key transforms. Each is deterministic, pure and idempotent */
/* and each is layered ON TOP of the shipped normaliser, never instead  */
/* of it.                                                              */
/* ------------------------------------------------------------------ */

/**
 * R1 - dotted initialism. `ELSEVIER B.V.` normalises to `elsevier b v`:
 * punctuation folding splits the dotted legal form into single letters,
 * so the `bv` ALREADY IN LEGAL_SUFFIXES can never match it. This adds no
 * new knowledge - it strips a trailing run of single-letter tokens only
 * when their concatenation is a suffix the list already carries.
 */
function stripDottedInitialism(key: string): string {
  const suffixSet = new Set(LEGAL_SUFFIXES);
  let toks = key.split(" ").filter(Boolean);
  let changed = true;
  while (changed) {
    changed = false;
    for (let take = 4; take >= 2; take--) {
      if (toks.length <= take) continue;
      const tail = toks.slice(-take);
      if (!tail.every((t) => t.length === 1)) continue;
      if (!suffixSet.has(tail.join(""))) continue;
      toks = toks.slice(0, -take);
      changed = true;
      break;
    }
  }
  return toks.join(" ");
}

/** R2 - a leading definite article. `THE SUPREME INDUSTRIES LIMITED`. */
function stripLeadingArticle(key: string): string {
  const toks = key.split(" ").filter(Boolean);
  if (toks.length > 1 && toks[0] === "the") return toks.slice(1).join(" ");
  return key;
}

/**
 * R4 - a trailing geographic token. Measured because `ARIHANT
 * PUBLICATIONS (INDIA) LIMITED` / `Arihant Publications` differ by
 * exactly one, NOT because it is believed safe: `BANK OF INDIA` would
 * lose its country too. Reported with its damage, not recommended.
 */
const GEO_TOKENS = new Set(["india", "bharat"]);
function stripTrailingGeo(key: string): string {
  const toks = key.split(" ").filter(Boolean);
  if (toks.length > 1 && GEO_TOKENS.has(toks[toks.length - 1]!)) return toks.slice(0, -1).join(" ");
  return key;
}

type KeyRule = { id: string; label: string; key: (raw: string) => string };

const baseKey = (raw: string) => normalizeName(raw).normalized;

const KEY_RULES: KeyRule[] = [
  { id: "baseline", label: "shipped normalisation (today's Tier B2)", key: baseKey },
  { id: "R1_dotted_initialism", label: "+ trailing dotted legal form (b.v. -> bv, already in the suffix list)", key: (r) => stripDottedInitialism(baseKey(r)) },
  { id: "R2_leading_article", label: "+ leading definite article", key: (r) => stripLeadingArticle(baseKey(r)) },
  { id: "R1R2", label: "+ R1 and R2 together", key: (r) => stripLeadingArticle(stripDottedInitialism(baseKey(r))) },
  { id: "R4_trailing_geo", label: "+ trailing geographic token (MEASURED, NOT PROPOSED)", key: (r) => stripTrailingGeo(baseKey(r)) },
  { id: "R1R2R4", label: "+ R1, R2 and R4 together (MEASURED, NOT PROPOSED)", key: (r) => stripTrailingGeo(stripLeadingArticle(stripDottedInitialism(baseKey(r)))) },
];

/* Pairwise (non-key) rules: token containment. Deliberately separated,  */
/* because containment is not an equivalence and cannot be a key.        */
type PairRule = { id: string; label: string; match: (a: string[], b: string[]) => boolean };

const isPrefix = (s: string[], l: string[]) => s.length < l.length && s.every((t, i) => t === l[i]);
const isSubset = (s: string[], l: string[]) => s.length < l.length && s.every((t) => l.includes(t));

const PAIR_RULES: PairRule[] = [
  { id: "R3a_prefix_any", label: "token-prefix containment, any length", match: (a, b) => isPrefix(a, b) || isPrefix(b, a) },
  { id: "R3a_prefix_min2", label: "token-prefix containment, shorter side >= 2 tokens", match: (a, b) => (isPrefix(a, b) && a.length >= 2) || (isPrefix(b, a) && b.length >= 2) },
  { id: "R3b_subset_any", label: "unordered token subset, any length", match: (a, b) => isSubset(a, b) || isSubset(b, a) },
  { id: "R3b_subset_min2", label: "unordered token subset, shorter side >= 2 tokens", match: (a, b) => (isSubset(a, b) && a.length >= 2) || (isSubset(b, a) && b.length >= 2) },
];

/* ------------------------------------------------------------------ */

function main(): void {
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, `${BASE}.ground-truth.json`), "utf8")) as Truth;
  const undet = new Set(truth.undetermined.map((u) => u.wikidataSurrogate));

  const recs: Rec[] = Object.entries(truth.surrogateMap).map(([sur, r]) => ({
    sur, registry: r.registry, name: r.name, leis: r.leis, undetermined: undet.has(sur),
  }));
  const bySur = new Map(recs.map((r) => [r.sur, r]));
  const shareLei = (a: Rec, b: Rec) => a.leis.some((l) => b.leis.includes(l));

  /** Tier A as the ANCHORED regime actually runs it: GLEIF keeps the LEI it issues. */
  function seedTierA(uf: UF): void {
    const byLei = new Map<string, string[]>();
    for (const r of recs) {
      if (r.registry !== "gleif") continue;      // Wikidata is stripped in this regime
      if (r.undetermined) continue;
      for (const l of r.leis) { if (!byLei.has(l)) byLei.set(l, []); byLei.get(l)!.push(r.sur); }
    }
    for (const surs of byLei.values()) for (let i = 1; i < surs.length; i++) uf.union(surs[0]!, surs[i]!);
  }

  interface Score {
    id: string; label: string;
    positivesJoined: number; positivesTotal: number;
    newlyJoined: string[]; broken: string[];
    hardNegativesMerged: { pairId: string; a: string; b: string }[];
    falseMergeComponents: { records: { sur: string; name: string; leis: string[] }[] }[];
    proposedEdges: number; correctEdges: number; falseEdges: number;
    components: number;
  }

  function score(id: string, label: string, edges: [string, string][]): Score {
    const uf = new UF();
    for (const r of recs) uf.find(r.sur);
    seedTierA(uf);
    for (const [a, b] of edges) uf.union(a, b);

    const positivesJoined: string[] = [];
    for (const p of truth.positives) if (uf.same(p.gleifSurrogate, p.wikidataSurrogate)) positivesJoined.push(p.pairId);

    const hardNegativesMerged = truth.hardNegatives
      .filter((n) => uf.same(n.a.surrogate, n.b.surrogate))
      .map((n) => ({ pairId: n.pairId, a: n.a.name, b: n.b.name }));

    // A component is a false merge when it contains two SCORABLE records
    // that do not share an LEI.
    const falseMergeComponents: Score["falseMergeComponents"] = [];
    for (const surs of uf.groups().values()) {
      const members = surs.map((s) => bySur.get(s)!).filter((r) => r && !r.undetermined);
      if (members.length < 2) continue;
      let bad = false;
      for (let i = 0; i < members.length && !bad; i++)
        for (let j = i + 1; j < members.length && !bad; j++)
          if (!shareLei(members[i]!, members[j]!)) bad = true;
      if (bad) falseMergeComponents.push({ records: members.map((m) => ({ sur: m.sur, name: m.name, leis: m.leis })) });
    }

    let correctEdges = 0, falseEdges = 0;
    for (const [a, b] of edges) {
      const ra = bySur.get(a)!, rb = bySur.get(b)!;
      if (ra.undetermined || rb.undetermined) continue;
      if (shareLei(ra, rb)) correctEdges++; else falseEdges++;
    }

    return {
      id, label,
      positivesJoined: positivesJoined.length, positivesTotal: truth.positives.length,
      newlyJoined: positivesJoined, broken: [],
      hardNegativesMerged, falseMergeComponents,
      proposedEdges: edges.length, correctEdges, falseEdges,
      components: [...uf.groups().values()].length,
    };
  }

  function keyEdges(rule: KeyRule): [string, string][] {
    const byKey = new Map<string, string[]>();
    for (const r of recs) {
      const k = rule.key(r.name);
      if (!k) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k)!.push(r.sur);
    }
    const edges: [string, string][] = [];
    for (const surs of byKey.values()) for (let i = 1; i < surs.length; i++) edges.push([surs[0]!, surs[i]!]);
    return edges;
  }

  function pairEdges(rule: PairRule): [string, string][] {
    const toks = recs.map((r) => ({ sur: r.sur, t: baseKey(r.name).split(" ").filter(Boolean) }));
    const edges: [string, string][] = [];
    for (let i = 0; i < toks.length; i++)
      for (let j = i + 1; j < toks.length; j++)
        if (rule.match(toks[i]!.t, toks[j]!.t)) edges.push([toks[i]!.sur, toks[j]!.sur]);
    return edges;
  }

  /* ---------------------------------------------------------------- */
  /* R5 - a name the PUBLISHER states, not one we derive. Wikidata      */
  /* P1448 "official name". Availability was probed over exactly the    */
  /* items already in the corpus (see the probe file's own caveat: it   */
  /* is agent-relay and is NOT admissible as collected evidence until   */
  /* re-collected on the direct-https path). Measured here to price the */
  /* option, not to enable it.                                          */
  /* ---------------------------------------------------------------- */
  const PROBE = "evidence/no-identifier/wikidata-official-name-probe.json";
  const RAW_SPARQL = "data/public/raw/SRC-001/2026-09-03T20-51-29-042Z/raw/sparql-results.json";
  function officialNameEdges(): { edges: [string, string][]; available: number } {
    if (!fs.existsSync(path.join(ROOT, PROBE)) || !fs.existsSync(path.join(ROOT, RAW_SPARQL))) return { edges: [], available: 0 };
    const probe = JSON.parse(fs.readFileSync(path.join(ROOT, PROBE), "utf8")) as { officialNames: { qid: string; officialName: string }[] };
    const raw = JSON.parse(fs.readFileSync(path.join(ROOT, RAW_SPARQL), "utf8")) as { results: { bindings: Record<string, { value?: string }>[] } };
    const qidByLei = new Map<string, string>();
    for (const b of raw.results.bindings) {
      const lei = b.lei?.value, item = b.item?.value;
      if (lei && item) qidByLei.set(lei, item.split("/").pop()!);
    }
    const officialByQid = new Map(probe.officialNames.map((o) => [o.qid, o.officialName]));
    // Attach the official name to the WIKIDATA record for that subject, then
    // key it exactly as any other name would be keyed.
    const extra: { sur: string; k: string }[] = [];
    for (const r of recs) {
      if (r.registry !== "wikidata" || r.undetermined) continue;
      for (const lei of r.leis) {
        const qid = qidByLei.get(lei);
        const off = qid ? officialByQid.get(qid) : undefined;
        if (off) extra.push({ sur: r.sur, k: baseKey(off) });
      }
    }
    const byKey = new Map<string, string[]>();
    for (const r of recs) { const k = baseKey(r.name); if (k) { if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(r.sur); } }
    const edges: [string, string][] = [];
    for (const e of extra) for (const other of byKey.get(e.k) ?? []) if (other !== e.sur) edges.push([e.sur, other]);
    return { edges, available: extra.length };
  }

  /**
   * Prefix containment WITH the uniqueness guard the resolver already
   * applies to an ambiguous normalised key: a shorter name that prefixes
   * more than one SUBJECT is a conflict to be flagged, never a merge.
   * Without this guard the rule is unsafe by construction - `GVK` is a
   * prefix of every `GVK ...` entity that exists.
   */
  function guardedPrefixEdges(): { edges: [string, string][]; suppressed: string[] } {
    const toks = recs.filter((r) => !r.undetermined).map((r) => ({ sur: r.sur, name: r.name, leis: r.leis, t: baseKey(r.name).split(" ").filter(Boolean) }));
    const edges: [string, string][] = [];
    const suppressed: string[] = [];
    for (const s of toks) {
      const longer = toks.filter((l) => l.sur !== s.sur && isPrefix(s.t, l.t));
      if (longer.length === 0) continue;
      const subjects = new Set(longer.map((l) => l.leis[0] ?? l.sur));
      if (subjects.size > 1) { suppressed.push(`${s.name} -> ${longer.length} records across ${subjects.size} subjects`); continue; }
      for (const l of longer) edges.push([s.sur, l.sur]);
    }
    return { edges, suppressed };
  }

  const results: Score[] = [];
  for (const r of KEY_RULES) results.push(score(r.id, r.label, keyEdges(r)));
  // containment rules are measured ON TOP of the shipped baseline, since
  // that is the only way they would ever ship.
  const base = keyEdges(KEY_RULES[0]!);
  for (const r of PAIR_RULES) results.push(score(r.id, r.label, [...base, ...pairEdges(r)]));

  const official = officialNameEdges();
  const guarded = guardedPrefixEdges();
  const r1r2 = keyEdges(KEY_RULES.find((r) => r.id === "R1R2")!);
  results.push(score("R5_official_name", "+ publisher-stated official name (Wikidata P1448)", [...base, ...official.edges]));
  results.push(score("R3a_prefix_guarded", "+ prefix containment, suppressed when it reaches >1 subject", [...base, ...guarded.edges]));
  results.push(score("COMBINED_no_containment", "R1 + R2 + official name (no containment rule at all)", [...r1r2, ...official.edges]));
  results.push(score("COMBINED_all", "R1 + R2 + official name + guarded prefix containment", [...r1r2, ...official.edges, ...guarded.edges]));

  const baseline = results[0]!;
  const VALIDATION_TARGET = 53;
  const harnessValid = baseline.positivesJoined === VALIDATION_TARGET;

  /* -------------------------------- report -------------------------- */
  console.log("=".repeat(78));
  console.log("P6.18  DETERMINISTIC EVIDENCE STUDY - measurement only, nothing enabled");
  console.log("=".repeat(78));
  console.log(`corpus        ${BASE}-anchored.corpus.json (${recs.length} real records)`);
  console.log(`ground truth  ${BASE}.ground-truth.json (READ ONLY, ${truth.positives.length} positives, ${truth.hardNegatives.length} hard negatives)`);
  console.log();
  console.log(`HARNESS VALIDATION: baseline reproduces ${baseline.positivesJoined}/${baseline.positivesTotal} ` +
    `(measured P6.17.1 value ${VALIDATION_TARGET}/75) -> ${harnessValid ? "VALID" : "INVALID - deltas below are meaningless"}`);
  console.log();

  const basePos = new Set(baseline.newlyJoined);
  for (const s of results) {
    const gained = s.newlyJoined.filter((p) => !basePos.has(p));
    const lost = [...basePos].filter((p) => !s.newlyJoined.includes(p));
    console.log("-".repeat(78));
    console.log(`RULE ${s.id}`);
    console.log(`  ${s.label}`);
    console.log(`  positive pairs joined      ${s.positivesJoined}/${s.positivesTotal}  (${pct(s.positivesJoined, s.positivesTotal)})   delta ${s.positivesJoined - baseline.positivesJoined >= 0 ? "+" : ""}${s.positivesJoined - baseline.positivesJoined}`);
    console.log(`  newly joined               ${gained.length ? gained.join(", ") : "none"}`);
    if (lost.length) console.log(`  BROKEN (was joined)        ${lost.join(", ")}`);
    console.log(`  hard negatives merged      ${s.hardNegativesMerged.length}/${truth.hardNegatives.length}` +
      (s.hardNegativesMerged.length ? `  <-- ${s.hardNegativesMerged.map((h) => `${h.pairId} [${h.a} | ${h.b}]`).join("; ")}` : ""));
    console.log(`  false-merge components     ${s.falseMergeComponents.length}`);
    for (const c of s.falseMergeComponents.slice(0, 6))
      console.log(`      { ${c.records.map((r) => `${r.name} (${r.leis.join("/") || "no lei"})`).join("  ||  ")} }`);
    if (s.falseMergeComponents.length > 6) console.log(`      ... and ${s.falseMergeComponents.length - 6} more`);
    console.log(`  proposed name edges        ${s.proposedEdges}  (correct ${s.correctEdges}, false ${s.falseEdges})`);
    console.log(`  components                 ${s.components}  (ground truth subjects 182)`);
  }
  console.log("-".repeat(78));
  console.log(`\nofficial-name claims attachable to a corpus record: ${official.available}`);
  console.log(`prefix relations SUPPRESSED by the uniqueness guard: ${guarded.suppressed.length}`);
  guarded.suppressed.forEach((x) => console.log(`    ${x}`));

  const stillOut = truth.positives.filter((p) => !results[results.length - 1]!.newlyJoined.includes(p.pairId)).map((p) => p.pairId);
  const bestJoined = new Set(results[results.length - 1]!.newlyJoined);
  const remaining = truth.positives.filter((p) => !bestJoined.has(p.pairId));
  console.log(`\nSTILL UNJOINED under every deterministic rule measured here: ${remaining.length}`);
  remaining.forEach((p) => console.log(`    ${p.pairId}  "${p.gleifName}"  vs  "${p.wikidataName}"`));
  void stillOut;

  const out = {
    experiment: "P6.18 deterministic evidence study",
    dataClass: "REAL - GLEIF + Wikidata, CC0 1.0",
    disclaimer: "Measurement only. No resolver code was imported, no pipeline run, no database written, no ground truth modified, no name variant manufactured.",
    corpus: `${BASE}-anchored.corpus.json`,
    groundTruth: `${BASE}.ground-truth.json`,
    ranAt: new Date().toISOString(),
    harnessValidation: { baselinePositivesJoined: baseline.positivesJoined, expected: VALIDATION_TARGET, valid: harnessValid },
    rules: results.map((s) => ({
      id: s.id, label: s.label,
      positivePairsJoined: { n: s.positivesJoined, d: s.positivesTotal, pct: pct(s.positivesJoined, s.positivesTotal) },
      deltaVsBaseline: s.positivesJoined - baseline.positivesJoined,
      newlyJoined: s.newlyJoined.filter((p) => !basePos.has(p)),
      broken: [...basePos].filter((p) => !s.newlyJoined.includes(p)),
      hardNegativeFalseMerges: { n: s.hardNegativesMerged.length, d: truth.hardNegatives.length, cases: s.hardNegativesMerged },
      falseMergeComponents: s.falseMergeComponents,
      edges: { proposed: s.proposedEdges, correct: s.correctEdges, false: s.falseEdges },
      components: s.components,
    })),
    officialNameClaimsAttachable: official.available,
    prefixRelationsSuppressedByGuard: guarded.suppressed,
    stillUnjoinedUnderBestRule: truth.positives
      .filter((p) => !new Set(results[results.length - 1]!.newlyJoined).has(p.pairId))
      .map((p) => ({ pairId: p.pairId, gleif: p.gleifName, wikidata: p.wikidataName })),
  };
  const dest = path.join(ROOT, "reports/no-identifier/deterministic-evidence-study.json");
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`\nwritten: ${path.relative(ROOT, dest)}`);
}

main();
