/**
 * P6.20.1 — WHICH pairs each proposed rule merges, not just how many.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/rule-attribution.ts
 *
 * MEASUREMENT ONLY. Imports no resolver, runs no pipeline, writes no
 * database, modifies no ground truth, manufactures no name variant.
 * None of these rules is enabled by this script or by this commit.
 *
 * WHY THIS EXISTS.
 *
 * `expanded-deterministic-ceiling.ts` prices the proposed rules as
 * counts: shipped joins 249/578 positives and merges 3/146 hard
 * negatives, "+ official name" joins 344 and merges 4. A count cannot
 * settle a precision/recall decision, because it cannot say whether the
 * fourth false merge is a near-miss the guard should have caught or a
 * genuinely undecidable pair, and it cannot say whether the +95 positives
 * arrived through the evidence the rule claims to use.
 *
 * The P6.19 handoff recorded "+95 pairs at no precision cost" and "+13,
 * zero cost". Both readings are contradicted by the JSON that same phase
 * wrote: hard-negative false merges go 3 -> 4 under the official-name
 * rule and 3 -> 5 under R1/R2 + official name. This script names the
 * pairs so the cost is arguable rather than asserted.
 *
 * The merge graph is built with LABELLED EDGES and the path between a
 * merged pair is reconstructed, so every reported merge can state the
 * exact key or relation that caused it. A union-find alone loses that.
 */
import fs from "node:fs";
import path from "node:path";

import { normalizeName, LEGAL_SUFFIXES } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const BASE = "evidence/expanded";
const OUT = "reports/expanded/rule-attribution.json";

/* ------------------------------------------------------------------ */
/* The rule set, byte-for-byte the transformations the ceiling script   */
/* used. Reproduced rather than imported so the two scripts can be      */
/* diffed against each other, and so neither can silently drift.        */
/* ------------------------------------------------------------------ */

const base = (s: string) => normalizeName(s).normalized;

function stripDotted(k: string): string {
  const set = new Set(LEGAL_SUFFIXES);
  let t = k.split(" ").filter(Boolean);
  let ch = true;
  while (ch) {
    ch = false;
    for (let take = 4; take >= 2; take--) {
      if (t.length <= take) continue;
      const tail = t.slice(-take);
      if (!tail.every((x) => x.length === 1) || !set.has(tail.join(""))) continue;
      t = t.slice(0, -take);
      ch = true;
      break;
    }
  }
  return t.join(" ");
}

const stripArticle = (k: string) => {
  const t = k.split(" ").filter(Boolean);
  return t.length > 1 && t[0] === "the" ? t.slice(1).join(" ") : k;
};

const isPrefix = (s: string[], l: string[]) => s.length < l.length && s.every((t, i) => t === l[i]);

/* ------------------------------------------------------------------ */
/* A labelled merge graph: every edge remembers what justified it.      */
/* ------------------------------------------------------------------ */

interface Edge {
  to: string;
  kind: "lei_seed" | "name_key" | "prefix";
  detail: string;
}

class Graph {
  private adj = new Map<string, Edge[]>();
  node(x: string) {
    if (!this.adj.has(x)) this.adj.set(x, []);
  }
  edge(a: string, b: string, kind: Edge["kind"], detail: string) {
    this.node(a);
    this.node(b);
    this.adj.get(a)!.push({ to: b, kind, detail });
    this.adj.get(b)!.push({ to: a, kind, detail });
  }
  /** The shortest justification chain from a to b, or null if unconnected. */
  path(a: string, b: string): { via: string; kind: Edge["kind"]; detail: string }[] | null {
    if (!this.adj.has(a) || !this.adj.has(b)) return null;
    if (a === b) return [];
    const prev = new Map<string, { from: string; e: Edge }>();
    const seen = new Set([a]);
    let frontier = [a];
    while (frontier.length) {
      const next: string[] = [];
      for (const cur of frontier) {
        for (const e of this.adj.get(cur) ?? []) {
          if (seen.has(e.to)) continue;
          seen.add(e.to);
          prev.set(e.to, { from: cur, e });
          if (e.to === b) {
            const chain: { via: string; kind: Edge["kind"]; detail: string }[] = [];
            let node = b;
            while (node !== a) {
              const p = prev.get(node)!;
              chain.unshift({ via: node, kind: p.e.kind, detail: p.e.detail });
              node = p.from;
            }
            return chain;
          }
          next.push(e.to);
        }
      }
      frontier = next;
    }
    return null;
  }
  connected(a: string, b: string): boolean {
    return this.path(a, b) !== null;
  }
}

/* ------------------------------------------------------------------ */

interface Rec {
  sur: string;
  registry: string;
  recordRef: string;
  name: string;
  officialName: string | null;
  leis: string[];
  ciks: string[];
}

interface Truth {
  positives: {
    pairId: string;
    variation: string;
    subject: string;
    sourcePairing: string;
    a: { recordRef: string; name: string };
    b: { recordRef: string; name: string };
  }[];
  hardNegatives: {
    pairId: string;
    scheme: string;
    sourcePairing: string;
    a: { recordRef: string; name: string; id: string };
    b: { recordRef: string; name: string; id: string };
  }[];
  surrogateMap: Record<string, Omit<Rec, "sur">>;
}

function main(): void {
  const truth = JSON.parse(
    fs.readFileSync(path.join(ROOT, `${BASE}/expanded.ground-truth.json`), "utf8"),
  ) as Truth;

  const recs: Rec[] = Object.entries(truth.surrogateMap).map(([sur, r]) => ({ sur, ...r }));
  const byRef = new Map(recs.map((r) => [r.recordRef, r]));
  const bySur = new Map(recs.map((r) => [r.sur, r]));
  const subj = (r: Rec) =>
    r.leis.length === 1 ? `LEI:${r.leis[0]}` : r.ciks.length === 1 ? `CIK:${r.ciks[0]}` : `SOLO:${r.sur}`;

  type Rule = { id: string; label: string; keys: (r: Rec) => string[]; prefix?: boolean };
  const RULES: Rule[] = [
    { id: "shipped", label: "shipped normalisation (today's Tier B2)", keys: (r) => [base(r.name)] },
    {
      id: "R1R2",
      label: "+ dotted legal form and leading article",
      keys: (r) => [stripArticle(stripDotted(base(r.name)))],
    },
    {
      id: "official",
      label: "+ publisher-stated official name (Wikidata P1448)",
      keys: (r) => [base(r.name), ...(r.officialName ? [base(r.officialName)] : [])],
    },
    {
      id: "R1R2_official",
      label: "+ R1, R2 and official name",
      keys: (r) => [
        stripArticle(stripDotted(base(r.name))),
        ...(r.officialName ? [stripArticle(stripDotted(base(r.officialName)))] : []),
      ],
    },
    {
      id: "R1R2_official_prefix",
      label: "+ R1, R2, official name AND guarded prefix containment",
      keys: (r) => [
        stripArticle(stripDotted(base(r.name))),
        ...(r.officialName ? [stripArticle(stripDotted(base(r.officialName)))] : []),
      ],
      prefix: true,
    },
  ];

  const build = (rule: Rule) => {
    const g = new Graph();
    for (const r of recs) g.node(r.sur);

    // Tier A as the anchored regime runs it: GLEIF keeps the LEI it issues.
    const byLei = new Map<string, string[]>();
    for (const r of recs) {
      if (r.registry !== "gleif" || r.leis.length !== 1) continue;
      const l = r.leis[0]!;
      if (!byLei.has(l)) byLei.set(l, []);
      byLei.get(l)!.push(r.sur);
    }
    for (const [lei, v] of byLei) for (let i = 1; i < v.length; i++) g.edge(v[0]!, v[i]!, "lei_seed", lei);

    // Tier B: shared normalised key.
    const byKey = new Map<string, string[]>();
    for (const r of recs)
      for (const k of new Set(rule.keys(r))) {
        if (!k) continue;
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k)!.push(r.sur);
      }
    for (const [k, v] of byKey) for (let i = 1; i < v.length; i++) g.edge(v[0]!, v[i]!, "name_key", k);

    let suppressed = 0;
    if (rule.prefix) {
      const toks = recs.map((r) => ({ sur: r.sur, s: subj(r), t: rule.keys(r)[0]!.split(" ").filter(Boolean) }));
      for (const s of toks) {
        const longer = toks.filter((l) => l.sur !== s.sur && isPrefix(s.t, l.t));
        if (!longer.length) continue;
        if (new Set(longer.map((l) => l.s)).size > 1) {
          suppressed++;
          continue;
        }
        for (const l of longer) g.edge(s.sur, l.sur, "prefix", `${s.t.join(" ")} < ${l.t.join(" ")}`);
      }
    }
    return { g, suppressed };
  };

  const describe = (g: Graph, aRef: string, bRef: string) => {
    const a = byRef.get(aRef);
    const b = byRef.get(bRef);
    if (!a || !b) return null;
    const chain = g.path(a.sur, b.sur);
    if (!chain) return null;
    return chain.map((step) => ({
      kind: step.kind,
      detail: step.detail,
      toRecord: bySur.get(step.via)?.recordRef ?? step.via,
      toName: bySur.get(step.via)?.name ?? null,
    }));
  };

  const results = RULES.map((rule) => {
    const { g, suppressed } = build(rule);
    const joined = truth.positives.filter((p) => {
      const a = byRef.get(p.a.recordRef), b = byRef.get(p.b.recordRef);
      return a && b && g.connected(a.sur, b.sur);
    });
    const merged = truth.hardNegatives.filter((n) => {
      const a = byRef.get(n.a.recordRef), b = byRef.get(n.b.recordRef);
      return a && b && g.connected(a.sur, b.sur);
    });
    return {
      id: rule.id,
      label: rule.label,
      positivesJoined: joined.length,
      hardNegativesMerged: merged.length,
      prefixRelationsSuppressed: suppressed,
      joinedPairIds: joined.map((p) => p.pairId),
      falseMerges: merged.map((n) => ({
        pairId: n.pairId,
        scheme: n.scheme,
        sourcePairing: n.sourcePairing,
        a: { recordRef: n.a.recordRef, name: n.a.name, id: n.a.id },
        b: { recordRef: n.b.recordRef, name: n.b.name, id: n.b.id },
        justificationChain: describe(g, n.a.recordRef, n.b.recordRef),
      })),
    };
  });

  // The deltas are the decision. Each rule is compared to the one before it.
  const deltas: unknown[] = [];
  for (let i = 1; i < results.length; i++) {
    const prev = results[i - 1]!, cur = results[i]!;
    const prevJoined = new Set(prev.joinedPairIds);
    const prevMerged = new Set(prev.falseMerges.map((f) => f.pairId));
    const curJoined = new Set(cur.joinedPairIds);
    const curMerged = new Set(cur.falseMerges.map((f) => f.pairId));
    deltas.push({
      from: prev.id,
      to: cur.id,
      positivesGained: cur.joinedPairIds.filter((id) => !prevJoined.has(id)).length,
      positivesLost: prev.joinedPairIds.filter((id) => !curJoined.has(id)).length,
      positivesLostPairIds: prev.joinedPairIds.filter((id) => !curJoined.has(id)),
      newFalseMerges: cur.falseMerges.filter((f) => !prevMerged.has(f.pairId)),
      falseMergesRemoved: prev.falseMerges.filter((f) => !curMerged.has(f.pairId)).map((f) => f.pairId),
    });
  }

  // Every rule is also compared to the SHIPPED baseline, because that is
  // the change the owner is actually being asked to approve.
  const shipped = results[0]!;
  const shippedJoined = new Set(shipped.joinedPairIds);
  const shippedMerged = new Set(shipped.falseMerges.map((f) => f.pairId));
  const vsShipped = results.slice(1).map((cur) => ({
    rule: cur.id,
    positivesGained: cur.joinedPairIds.filter((id) => !shippedJoined.has(id)).length,
    newFalseMerges: cur.falseMerges
      .filter((f) => !shippedMerged.has(f.pairId))
      .map((f) => ({ pairId: f.pairId, a: f.a.name, b: f.b.name, aId: f.a.id, bId: f.b.id })),
  }));

  const out = {
    study: "P6.20.1 rule attribution — which pairs, not how many",
    disclaimer:
      "Measurement only. No resolver imported, no pipeline run, no database written, no ground truth modified, no name variant manufactured. None of these rules is enabled.",
    corpus: `${BASE}/expanded-anchored.corpus.json`,
    groundTruth: `${BASE}/expanded.ground-truth.json`,
    ranAt: new Date().toISOString(),
    positives: truth.positives.length,
    hardNegatives: truth.hardNegatives.length,
    results,
    deltas,
    vsShipped,
  };

  fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(out, null, 2)}\n`);

  for (const r of results) {
    console.log(
      `${r.id.padEnd(22)} joined ${String(r.positivesJoined).padStart(3)}/${truth.positives.length}   ` +
        `hard-negative false merges ${r.hardNegativesMerged}/${truth.hardNegatives.length}` +
        (r.prefixRelationsSuppressed ? `   suppressed ${r.prefixRelationsSuppressed}` : ""),
    );
  }
  console.log(`\nvs SHIPPED:`);
  for (const v of vsShipped) {
    console.log(`  ${v.rule}: +${v.positivesGained} positives, ${v.newFalseMerges.length} NEW false merges`);
    for (const f of v.newFalseMerges) console.log(`      ${f.pairId}  "${f.a}" [${f.aId}]  ==  "${f.b}" [${f.bId}]`);
  }
  console.log(`\nwrote ${OUT}`);
}

main();
