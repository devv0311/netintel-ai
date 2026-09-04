/**
 * P6.19.4 — how much of the expanded corpus is reachable DETERMINISTICALLY,
 * and therefore how large the ML target actually is.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/expanded-deterministic-ceiling.ts
 *
 * MEASUREMENT ONLY. Imports no resolver, runs no pipeline, writes no
 * database, changes nothing. It replays the shipped normalisation over
 * the expanded corpus and reports what the rules P6.18 PROPOSED (and the
 * owner has not yet approved) would do here.
 *
 * This exists because the ML question cannot be answered without it. The
 * shipped resolver joins 40.7% of the expanded corpus; the residual is
 * NOT the ML target until the deterministic rules that are already on the
 * table have been applied to it. Sizing a model's job against work
 * deterministic rules would have done is how projects end up training
 * something to strip "LIMITED".
 *
 * The 146 real hard negatives are the point of running it here: P6.18
 * could only price these rules against 19, and warned that 0/19 was a
 * property of that set rather than evidence of safety.
 */
import fs from "node:fs";
import path from "node:path";

import { normalizeName, LEGAL_SUFFIXES } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const BASE = "evidence/expanded";
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

class UF {
  private p = new Map<string, string>();
  find(x: string): string {
    if (!this.p.has(x)) this.p.set(x, x);
    let r = this.p.get(x)!; while (r !== this.p.get(r)!) r = this.p.get(r)!;
    let c = x; while (c !== r) { const n = this.p.get(c)!; this.p.set(c, r); c = n; }
    return r;
  }
  union(a: string, b: string) { const ra = this.find(a), rb = this.find(b); if (ra !== rb) this.p.set(ra, rb); }
  same(a: string, b: string) { return this.find(a) === this.find(b); }
}

const base = (s: string) => normalizeName(s).normalized;
function stripDotted(k: string): string {
  const set = new Set(LEGAL_SUFFIXES); let t = k.split(" ").filter(Boolean); let ch = true;
  while (ch) { ch = false;
    for (let take = 4; take >= 2; take--) {
      if (t.length <= take) continue;
      const tail = t.slice(-take);
      if (!tail.every((x) => x.length === 1) || !set.has(tail.join(""))) continue;
      t = t.slice(0, -take); ch = true; break;
    } }
  return t.join(" ");
}
const stripArticle = (k: string) => { const t = k.split(" ").filter(Boolean); return t.length > 1 && t[0] === "the" ? t.slice(1).join(" ") : k; };
const isPrefix = (s: string[], l: string[]) => s.length < l.length && s.every((t, i) => t === l[i]);

interface Truth {
  positives: { pairId: string; variation: string; subject: string; a: { recordRef: string }; b: { recordRef: string } }[];
  hardNegatives: { pairId: string; scheme: string; a: { recordRef: string; id: string }; b: { recordRef: string; id: string } }[];
  surrogateMap: Record<string, { registry: string; recordRef: string; name: string; officialName: string | null; leis: string[]; ciks: string[] }>;
}

function main(): void {
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, `${BASE}/expanded.ground-truth.json`), "utf8")) as Truth;
  const recs = Object.entries(truth.surrogateMap).map(([sur, r]) => ({ sur, ...r }));
  const byRef = new Map(recs.map((r) => [r.recordRef, r]));
  const subj = (r: typeof recs[number]) => (r.leis.length === 1 ? `LEI:${r.leis[0]}` : r.ciks.length === 1 ? `CIK:${r.ciks[0]}` : `SOLO:${r.sur}`);

  /** Tier A as the anchored regime runs it: GLEIF keeps the LEI it issues. */
  const seed = (uf: UF) => {
    const m = new Map<string, string[]>();
    for (const r of recs) { if (r.registry !== "gleif" || r.leis.length !== 1) continue;
      const l = r.leis[0]!; if (!m.has(l)) m.set(l, []); m.get(l)!.push(r.sur); }
    for (const v of m.values()) for (let i = 1; i < v.length; i++) uf.union(v[0]!, v[i]!);
  };

  type Rule = { id: string; label: string; keys: (r: typeof recs[number]) => string[]; prefix?: boolean };
  const RULES: Rule[] = [
    { id: "shipped", label: "shipped normalisation (today's Tier B2)", keys: (r) => [base(r.name)] },
    { id: "R1R2", label: "+ dotted legal form and leading article (P6.18 proposals 2 and 3)", keys: (r) => [stripArticle(stripDotted(base(r.name)))] },
    { id: "official", label: "+ publisher-stated official name (Wikidata P1448, now COLLECTED)", keys: (r) => [base(r.name), ...(r.officialName ? [base(r.officialName)] : [])] },
    { id: "R1R2_official", label: "+ R1, R2 and official name", keys: (r) => [stripArticle(stripDotted(base(r.name))), ...(r.officialName ? [stripArticle(stripDotted(base(r.officialName)))] : [])] },
    { id: "R1R2_official_prefix", label: "+ R1, R2, official name AND guarded prefix containment (P6.18 proposal 4)", keys: (r) => [stripArticle(stripDotted(base(r.name))), ...(r.officialName ? [stripArticle(stripDotted(base(r.officialName)))] : [])], prefix: true },
  ];

  const results = RULES.map((rule) => {
    const uf = new UF(); for (const r of recs) uf.find(r.sur); seed(uf);
    const byKey = new Map<string, string[]>();
    for (const r of recs) for (const k of new Set(rule.keys(r))) { if (!k) continue; if (!byKey.has(k)) byKey.set(k, []); byKey.get(k)!.push(r.sur); }
    for (const v of byKey.values()) for (let i = 1; i < v.length; i++) uf.union(v[0]!, v[i]!);

    let suppressed = 0;
    if (rule.prefix) {
      const toks = recs.map((r) => ({ sur: r.sur, s: subj(r), t: rule.keys(r)[0]!.split(" ").filter(Boolean) }));
      for (const s of toks) {
        const longer = toks.filter((l) => l.sur !== s.sur && isPrefix(s.t, l.t));
        if (!longer.length) continue;
        // The uniqueness guard: a short name reaching more than one SUBJECT
        // is a conflict to flag, never a merge. P6.18 could not exercise
        // this branch at all; this corpus does.
        if (new Set(longer.map((l) => l.s)).size > 1) { suppressed++; continue; }
        for (const l of longer) uf.union(s.sur, l.sur);
      }
    }

    const joined = truth.positives.filter((p) => {
      const a = byRef.get(p.a.recordRef), b = byRef.get(p.b.recordRef);
      return a && b && uf.same(a.sur, b.sur);
    });
    const negMerged = truth.hardNegatives.filter((n) => {
      const a = byRef.get(n.a.recordRef), b = byRef.get(n.b.recordRef);
      return a && b && uf.same(a.sur, b.sur);
    });
    const byVar: Record<string, { n: number; d: number }> = {};
    for (const p of truth.positives) { byVar[p.variation] ??= { n: 0, d: 0 }; byVar[p.variation]!.d++; }
    for (const p of joined) byVar[p.variation]!.n++;
    return { ...rule, joined: joined.length, negMerged: negMerged.length, suppressed, byVar,
      unjoinedByVar: Object.fromEntries(Object.entries(byVar).map(([k, v]) => [k, v.d - v.n])) };
  });

  console.log("=".repeat(76));
  console.log("P6.19.4  DETERMINISTIC CEILING ON THE EXPANDED CORPUS - measurement only");
  console.log("=".repeat(76));
  console.log(`positives ${truth.positives.length}   hard negatives ${truth.hardNegatives.length} (P6.18 had 19)\n`);
  for (const r of results) {
    console.log("-".repeat(76));
    console.log(`${r.id}\n  ${r.label}`);
    console.log(`  positives joined        ${r.joined}/${truth.positives.length}  (${pct(r.joined, truth.positives.length)})`);
    console.log(`  hard negatives merged   ${r.negMerged}/${truth.hardNegatives.length}  (${pct(r.negMerged, truth.hardNegatives.length)})`);
    if (r.prefix) console.log(`  prefix relations suppressed by the uniqueness guard  ${r.suppressed}`);
    console.log(`  still unjoined by class: ${Object.entries(r.unjoinedByVar).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  }
  console.log("-".repeat(76));

  fs.mkdirSync(path.join(ROOT, "reports/expanded"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "reports/expanded/deterministic-ceiling.json"),
    `${JSON.stringify({ study: "P6.19.4 deterministic ceiling on the expanded corpus",
      disclaimer: "Measurement only. No resolver imported, no pipeline run, no database written, no ground truth modified, no name variant manufactured. None of these rules is enabled.",
      corpus: `${BASE}/expanded-anchored.corpus.json`, groundTruth: `${BASE}/expanded.ground-truth.json`,
      ranAt: new Date().toISOString(), positives: truth.positives.length, hardNegatives: truth.hardNegatives.length,
      rules: results.map((r) => ({ id: r.id, label: r.label,
        positivesJoined: { n: r.joined, d: truth.positives.length, pct: pct(r.joined, truth.positives.length) },
        hardNegativeFalseMerges: { n: r.negMerged, d: truth.hardNegatives.length, pct: pct(r.negMerged, truth.hardNegatives.length) },
        prefixRelationsSuppressed: r.suppressed,
        joinedByVariation: r.byVar, stillUnjoinedByVariation: r.unjoinedByVar })) }, null, 2)}\n`);
  console.log("\nwritten: reports/expanded/deterministic-ceiling.json");
}
main();
