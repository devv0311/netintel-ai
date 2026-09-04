/**
 * P6.20.3 — can a PUBLISHER-STATED ownership edge tell two similar names
 * apart, where a string rule cannot?
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/relationship-evidence-study.ts \
 *     --records data/public/raw/SRC-002/<retrievedAt>/public-records.json
 *
 * MEASUREMENT ONLY. Imports no resolver, runs no pipeline, writes no
 * database, modifies no ground truth, manufactures nothing. It enables
 * no rule and no guard; it prices one.
 *
 * THE HYPOTHESIS, STATED BEFORE THE DATA WAS FETCHED.
 *
 *   H: The pairs that guarded prefix containment merges WRONGLY are not
 *      arbitrary. They are parent/subsidiary and group-structure pairs,
 *      and GLEIF - the same publisher that issued both LEIs - already
 *      states that relationship in Level 2. If so, the containment
 *      residual is not a string problem to be solved with a looser
 *      matcher, and the correct output for those pairs is an EDGE, not
 *      a merge.
 *
 * P6.20.1 named the five pairs the prefix rule newly merges: TELSTRA
 * GROUP / TELSTRA CORPORATION, BNP PARIBAS / BNP PARIBAS CARDIF
 * POJISTOVNA (twice), Cultura / Cultura Sparebank, and Kooperativa
 * pojistovna / Kooperativa. Every one reads like a group and one of its
 * members. H says the publisher already knows that.
 *
 * WHAT WOULD FALSIFY IT, AND IS TESTED FOR HERE.
 *
 *   1. The edges are not there. Coverage is measured and reported, not
 *      assumed, and "absent" is distinguished from "not asked".
 *   2. The guard costs recall. A guard that blocks a merge whenever an
 *      ownership edge exists would be worthless - worse than worthless -
 *      if it also blocked TRUE positives. Every positive is re-checked
 *      against it, and the count is reported even when it is zero.
 *   3. The edges are indiscriminate: if most unrelated pairs also carry
 *      one, the signal separates nothing. A control set of RANDOM
 *      distinct-LEI pairs from the same corpus is measured for contrast.
 *
 * A guard is only worth having if it fires on the pairs that are wrong
 * and stays silent on the pairs that are right. Both halves are measured.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { normalizeName, LEGAL_SUFFIXES } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const GROUND_TRUTH = "evidence/expanded/expanded.ground-truth.json";
const OUT = "reports/expanded/relationship-evidence.json";

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

/* --- the proposed rules, reproduced exactly as P6.20.1 measured them --- */
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
      t = t.slice(0, -take); ch = true; break;
    }
  }
  return t.join(" ");
}
const stripArticle = (k: string) => {
  const t = k.split(" ").filter(Boolean);
  return t.length > 1 && t[0] === "the" ? t.slice(1).join(" ") : k;
};

interface PublicRecord {
  registryRecordId: string;
  name: string;
  relations?: { predicate: string; targetRegistryRecordId: string }[];
}

interface Truth {
  positives: { pairId: string; basis: string; variation: string; a: { recordRef: string; name: string }; b: { recordRef: string; name: string } }[];
  hardNegatives: { pairId: string; sourcePairing: string; a: { recordRef: string; name: string; id: string }; b: { recordRef: string; name: string; id: string } }[];
  surrogateMap: Record<string, { registry: string; recordRef: string; name: string; officialName: string | null; leis: string[]; ciks: string[] }>;
}

function main(): void {
  const recordsPath = arg("records");
  if (!recordsPath) {
    console.error("usage: --records <path to a collected GLEIF public-records.json>");
    process.exitCode = 1;
    return;
  }

  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, GROUND_TRUTH), "utf8")) as Truth;
  const collected = JSON.parse(fs.readFileSync(path.resolve(ROOT, recordsPath), "utf8")) as PublicRecord[];

  /* --- the ownership graph, exactly as the publisher stated it --- */
  const parents = new Map<string, { predicate: string; target: string }[]>();
  const askedFor = new Set<string>();
  let edgeCount = 0;
  for (const rec of collected) {
    askedFor.add(rec.registryRecordId);
    for (const rel of rec.relations ?? []) {
      if (!parents.has(rec.registryRecordId)) parents.set(rec.registryRecordId, []);
      parents.get(rec.registryRecordId)!.push({ predicate: rel.predicate, target: rel.targetRegistryRecordId });
      edgeCount++;
    }
  }
  const ultimateOf = (lei: string) =>
    (parents.get(lei) ?? []).find((r) => r.predicate === "is_ultimately_consolidated_by")?.target ?? null;

  /**
   * The guard, stated as one testable predicate.
   *
   * Two records with DIFFERENT LEIs are "publisher-related" when GLEIF
   * states a consolidation edge between them in either direction, or
   * states that both consolidate up to the same ultimate parent. The
   * edge is evidence that they are two entities, so it is evidence
   * AGAINST merging them - never evidence for it.
   *
   * It is deliberately silent when the two records carry the SAME LEI:
   * that is the positive case, and a guard has no business there.
   */
  const relation = (x: string, y: string): { related: boolean; how: string | null } => {
    if (x === y) return { related: false, how: null };
    for (const r of parents.get(x) ?? []) if (r.target === y) return { related: true, how: `${x} ${r.predicate} ${y}` };
    for (const r of parents.get(y) ?? []) if (r.target === x) return { related: true, how: `${y} ${r.predicate} ${x}` };
    const ux = ultimateOf(x), uy = ultimateOf(y);
    if (ux && uy && ux === uy) return { related: true, how: `both is_ultimately_consolidated_by ${ux}` };
    return { related: false, how: null };
  };

  const byRef = new Map(Object.values(truth.surrogateMap).map((r) => [r.recordRef, r]));
  const leiOf = (ref: string) => {
    const r = byRef.get(ref);
    return r && r.leis.length === 1 ? r.leis[0]! : null;
  };
  const coverage = (ref: string) => {
    const l = leiOf(ref);
    return l ? (askedFor.has(l) ? "asked" : "not_asked") : "no_single_lei";
  };

  /* --- 1. hard negatives: does the guard fire where it should? --- */
  const negatives = truth.hardNegatives.map((n) => {
    const la = leiOf(n.a.recordRef), lb = leiOf(n.b.recordRef);
    const rel = la && lb ? relation(la, lb) : { related: false, how: null };
    return {
      pairId: n.pairId,
      sourcePairing: n.sourcePairing,
      a: n.a.name, b: n.b.name, aId: n.a.id, bId: n.b.id,
      coverage: [coverage(n.a.recordRef), coverage(n.b.recordRef)],
      publisherRelated: rel.related,
      statedAs: rel.how,
    };
  });

  /* --- 2. positives: does the guard ever fire where it must not? --- */
  const positives = truth.positives.map((p) => {
    const la = leiOf(p.a.recordRef), lb = leiOf(p.b.recordRef);
    const rel = la && lb ? relation(la, lb) : { related: false, how: null };
    return {
      pairId: p.pairId, variation: p.variation, basis: p.basis,
      a: p.a.name, b: p.b.name,
      guardWouldBlock: rel.related,
      statedAs: rel.how,
    };
  });
  const blockedPositives = positives.filter((p) => p.guardWouldBlock);

  /* --- 3. control: are these edges indiscriminate? --- */
  // A deterministic pseudo-random sample, seeded from a constant, so the
  // control set is the same on every run and on every machine. Pairs are
  // drawn from the SAME asked-for LEI population as the negatives, so a
  // difference in edge rate is a property of the pairs, not the sample.
  const asked = [...askedFor].sort();
  const rand = (i: number) => {
    const h = crypto.createHash("sha256").update(`netintel-p6.20-control-${i}`).digest();
    return h.readUInt32BE(0) / 0x100000000;
  };
  const control: { a: string; b: string; related: boolean }[] = [];
  for (let i = 0; control.length < 500 && i < 20000; i++) {
    const x = asked[Math.floor(rand(i * 2) * asked.length)]!;
    const y = asked[Math.floor(rand(i * 2 + 1) * asked.length)]!;
    if (x === y) continue;
    control.push({ a: x, b: y, related: relation(x, y).related });
  }
  const controlRelated = control.filter((c) => c.related).length;

  /* --- 4. what the guard does to each proposed rule's false merges --- */
  const key = (name: string, official: string | null) =>
    [stripArticle(stripDotted(base(name))), ...(official ? [stripArticle(stripDotted(base(official)))] : [])];
  const ruleFalseMerges = JSON.parse(
    fs.readFileSync(path.join(ROOT, "reports/expanded/rule-attribution.json"), "utf8"),
  ) as { results: { id: string; falseMerges: { pairId: string }[] }[] };
  const guardBlocked = new Set(negatives.filter((n) => n.publisherRelated).map((n) => n.pairId));
  const perRule = ruleFalseMerges.results.map((r) => {
    const ids = r.falseMerges.map((f) => f.pairId);
    const stopped = ids.filter((id) => guardBlocked.has(id));
    return {
      rule: r.id,
      falseMergesBefore: ids.length,
      stoppedByGuard: stopped.length,
      falseMergesAfter: ids.length - stopped.length,
      stoppedPairIds: stopped,
      survivingPairIds: ids.filter((id) => !guardBlocked.has(id)),
    };
  });

  const askedNegatives = negatives.filter((n) => n.coverage.every((c) => c === "asked"));
  const out = {
    study: "P6.20.3 publisher-stated ownership as a false-merge guard",
    disclaimer:
      "Measurement only. No resolver imported, no pipeline run, no database written, no ground truth modified. The guard is NOT enabled by this script or this commit.",
    hypothesis:
      "The pairs guarded containment merges wrongly are parent/subsidiary and group-structure pairs that GLEIF Level 2 already states. If so the containment residual is a relationship to record, not a match to make.",
    ranAt: new Date().toISOString(),
    source: "SRC-002 GLEIF Level 2 (direct-parent, ultimate-parent), CC0 1.0",
    recordsFile: recordsPath,
    coverage: {
      leisAsked: askedFor.size,
      leisWithAtLeastOneStatedParent: parents.size,
      statedEdges: edgeCount,
      note: "An LEI with no edge was ASKED and the publisher stated none (HTTP 404). That is an answer, not a gap.",
    },
    hardNegatives: {
      total: negatives.length,
      bothEndsAsked: askedNegatives.length,
      publisherRelated: negatives.filter((n) => n.publisherRelated).length,
      publisherRelatedAmongAsked: askedNegatives.filter((n) => n.publisherRelated).length,
      pairs: negatives.filter((n) => n.publisherRelated),
    },
    positives: {
      total: positives.length,
      guardWouldBlock: blockedPositives.length,
      blocked: blockedPositives,
      note: "A positive is two publishers stating the SAME identifier, so a guard keyed on DIFFERENT LEIs should never fire here. This is the falsification test, not a formality.",
    },
    control: {
      sampledPairs: control.length,
      publisherRelated: controlRelated,
      rate: `${((controlRelated / control.length) * 100).toFixed(1)}%`,
      note: "Random distinct-LEI pairs from the same asked-for population. If this rate approached the hard-negative rate the edges would separate nothing.",
    },
    perRule,
  };

  fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(out, null, 2)}\n`);

  console.log(`COVERAGE  ${askedFor.size} LEIs asked, ${parents.size} with a stated parent, ${edgeCount} edges\n`);
  console.log(`HARD NEGATIVES  ${out.hardNegatives.publisherRelated}/${negatives.length} carry a publisher-stated ownership relation`);
  for (const n of out.hardNegatives.pairs) console.log(`   ${n.pairId}  "${n.a}" / "${n.b}"\n      ${n.statedAs}`);
  console.log(`\nPOSITIVES  guard would wrongly block ${blockedPositives.length}/${positives.length}`);
  console.log(`CONTROL    ${controlRelated}/${control.length} random distinct-LEI pairs related (${out.control.rate})\n`);
  console.log("PER RULE (false merges, before -> after the guard)");
  for (const r of perRule) console.log(`   ${r.rule.padEnd(22)} ${r.falseMergesBefore} -> ${r.falseMergesAfter}  (stopped ${r.stoppedByGuard})`);
  console.log(`\nwrote ${OUT}`);
}

main();
