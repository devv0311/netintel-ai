/**
 * P6.17.4 - what would admitting publisher-stated ALIASES as match
 * candidates actually buy, and what would it cost?
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/alias-evidence-study.ts
 *
 * THIS SCRIPT CHANGES NOTHING. It does not import the resolver, it does
 * not run the pipeline and it writes no database. It replays the same
 * deterministic normalisation the resolver uses over the same real
 * corpus, and reports what an alias-aware Tier B WOULD have decided.
 *
 * It exists because "aliases are carried, provenanced and never read"
 * was a P6.16 finding, and the obvious next move - switch them on - is
 * exactly the kind of change that should be measured before it is made
 * rather than after. The 19 hard negatives are the reason: an alias is a
 * name a publisher attached to an entity, and some of those names are
 * shared with OTHER entities.
 *
 * Four questions, answered separately, because they have different
 * answers:
 *   1. RECALL     - how many of the 22 still-unjoined positive pairs
 *                   would an alias reach?
 *   2. PRECISION  - how many joins would be to the WRONG subject?
 *   3. FALSE MERGE- would any of the 19 hard negatives collapse?
 *   4. AMBIGUITY  - how often would one alias key reach two entities,
 *                   which the resolver would have to flag rather than
 *                   merge?
 */
import fs from "node:fs";
import path from "node:path";

import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const BASE = "evidence/no-identifier/no-identifier-pilot";

interface TruthRecord {
  registry: string;
  registryRecordId: string;
  name: string;
  leis: string[];
}
interface Truth {
  positives: {
    pairId: string; lei: string;
    gleifSurrogate: string; wikidataSurrogate: string;
    gleifName: string; wikidataName: string;
  }[];
  hardNegatives: {
    pairId: string; basis: string;
    a: { surrogate: string; registry: string; name: string; lei: string };
    b: { surrogate: string; registry: string; name: string; lei: string };
  }[];
  surrogateMap: Record<string, TruthRecord>;
}
interface CorpusItem {
  content: {
    registry: string;
    registryRecordId: string;
    name: string;
    aliases?: string[];
    identifiers?: { scheme: string; value: string }[];
  };
}

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);
const key = (s: string) => normalizeName(s).normalized;

function main(): void {
  const truth = JSON.parse(
    fs.readFileSync(path.join(ROOT, `${BASE}.ground-truth.json`), "utf8"),
  ) as Truth;
  const corpus = JSON.parse(
    fs.readFileSync(path.join(ROOT, `${BASE}-anchored.corpus.json`), "utf8"),
  ) as { evidenceItems: CorpusItem[] };

  // Surrogate <-> corpus id, since GLEIF keeps its real id in this regime.
  const surrogateByCorpusId = new Map<string, string>();
  for (const [sur, real] of Object.entries(truth.surrogateMap)) {
    surrogateByCorpusId.set(`${real.registry}:${sur}`, sur);
    surrogateByCorpusId.set(`${real.registry}:${real.registryRecordId}`, sur);
  }
  const itemBySurrogate = new Map<string, CorpusItem>();
  for (const item of corpus.evidenceItems) {
    const sur = surrogateByCorpusId.get(`${item.content.registry}:${item.content.registryRecordId}`);
    if (sur) itemBySurrogate.set(sur, item);
  }

  const subjectOf = (sur: string): string => {
    const real = truth.surrogateMap[sur]!;
    return real.leis.length === 1 ? `LEI:${real.leis[0]}` : `UNDETERMINED:${sur}`;
  };

  // --- the reference side: GLEIF, which keeps the LEI it issues -------
  const gleifSurrogates = Object.entries(truth.surrogateMap)
    .filter(([, r]) => r.registry === "gleif")
    .map(([sur]) => sur);

  /** normalised key -> set of GLEIF subjects reachable by it. */
  const buildIndex = (includeAliases: boolean): Map<string, Set<string>> => {
    const index = new Map<string, Set<string>>();
    for (const sur of gleifSurrogates) {
      const item = itemBySurrogate.get(sur);
      if (!item) continue;
      const names = [item.content.name, ...(includeAliases ? (item.content.aliases ?? []) : [])];
      for (const n of names) {
        const k = key(n);
        if (k.length === 0) continue;
        const set = index.get(k) ?? new Set<string>();
        set.add(sur);
        index.set(k, set);
      }
    }
    return index;
  };

  const nameOnlyIndex = buildIndex(false);
  const aliasIndex = buildIndex(true);

  // --- replay each positive pair under both indexes -------------------
  type Outcome = "joined_correct" | "joined_wrong" | "ambiguous" | "no_match";
  const decide = (
    querySurrogate: string,
    expectedGleifSurrogate: string,
    index: Map<string, Set<string>>,
    useAliasesOnQuerySide: boolean,
  ): { outcome: Outcome; via: string | null; reached: string[] } => {
    const item = itemBySurrogate.get(querySurrogate);
    if (!item) return { outcome: "no_match", via: null, reached: [] };
    const queryNames = [
      item.content.name,
      ...(useAliasesOnQuerySide ? (item.content.aliases ?? []) : []),
    ];
    for (const qn of queryNames) {
      const k = key(qn);
      if (k.length === 0) continue;
      const hit = index.get(k);
      if (!hit || hit.size === 0) continue;
      if (hit.size > 1) return { outcome: "ambiguous", via: qn, reached: [...hit].sort() };
      const only = [...hit][0]!;
      return {
        outcome: only === expectedGleifSurrogate ? "joined_correct" : "joined_wrong",
        via: qn,
        reached: [only],
      };
    }
    return { outcome: "no_match", via: null, reached: [] };
  };

  interface Row {
    pairId: string;
    gleif: string;
    wikidata: string;
    baseline: Outcome;
    withAliases: Outcome;
    via: string | null;
    reached: string[];
  }
  const rows: Row[] = truth.positives.map((p) => {
    const baseline = decide(p.wikidataSurrogate, p.gleifSurrogate, nameOnlyIndex, false);
    const withAliases = decide(p.wikidataSurrogate, p.gleifSurrogate, aliasIndex, true);
    return {
      pairId: p.pairId,
      gleif: p.gleifName,
      wikidata: p.wikidataName,
      baseline: baseline.outcome,
      withAliases: withAliases.outcome,
      via: withAliases.via,
      reached: withAliases.reached,
    };
  });

  const count = (rs: Row[], f: (r: Row) => boolean) => rs.filter(f).length;
  const baselineJoined = count(rows, (r) => r.baseline === "joined_correct");
  const aliasJoined = count(rows, (r) => r.withAliases === "joined_correct");
  const aliasWrong = count(rows, (r) => r.withAliases === "joined_wrong");
  const aliasAmbiguous = count(rows, (r) => r.withAliases === "ambiguous");
  const newlyJoined = rows.filter(
    (r) => r.baseline !== "joined_correct" && r.withAliases === "joined_correct",
  );
  const newlyBroken = rows.filter(
    (r) => r.baseline === "joined_correct" && r.withAliases !== "joined_correct",
  );

  // --- hard negatives: would an alias collapse two real entities? -----
  //
  // Asked directly: do the two records' name-plus-alias key sets
  // intersect? If they do, an alias-aware Tier B has a route to merge
  // two entities GLEIF says are different.
  const keysOf = (sur: string): Set<string> => {
    const item = itemBySurrogate.get(sur);
    if (!item) return new Set();
    return new Set(
      [item.content.name, ...(item.content.aliases ?? [])]
        .map(key)
        .filter((k) => k.length > 0),
    );
  };
  const negativeCollisions = truth.hardNegatives
    .map((n) => {
      const ka = keysOf(n.a.surrogate);
      const kb = keysOf(n.b.surrogate);
      const shared = [...ka].filter((k) => kb.has(k));
      return { pairId: n.pairId, basis: n.basis, a: n.a.name, b: n.b.name, shared };
    })
    .filter((n) => n.shared.length > 0);

  // --- ambiguity: how many alias keys reach more than one subject? ----
  const aliasKeyCollisions = [...aliasIndex.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([k, set]) => ({
      key: k,
      subjects: [...set].map((s) => ({
        surrogate: s,
        name: truth.surrogateMap[s]!.name,
        subject: subjectOf(s),
      })),
    }));
  const nameKeyCollisions = [...nameOnlyIndex.entries()].filter(([, set]) => set.size > 1).length;

  const totalAliasStrings = corpus.evidenceItems.reduce(
    (n, i) => n + (i.content.aliases?.length ?? 0),
    0,
  );

  const results = {
    study: "publisher-stated-aliases-as-match-candidates",
    question:
      "If Tier B were allowed to match on publisher-stated aliases as well as the primary name, " +
      "what would it gain and what would it break?",
    changesNothing:
      "This script does not import the resolver, run the pipeline or write a database. It replays " +
      "the resolver's own deterministic normalisation over the same real corpus and reports what " +
      "an alias-aware Tier B WOULD have decided. No behaviour was enabled.",
    corpus: `${BASE}-anchored.corpus.json`,
    ranAt: new Date().toISOString(),
    counts: {
      positivePairs: rows.length,
      aliasStringsInCorpus: totalAliasStrings,
      gleifReferenceRecords: gleifSurrogates.length,
      nameOnlyIndexKeys: nameOnlyIndex.size,
      aliasIndexKeys: aliasIndex.size,
    },
    recall: {
      baselineJoined: { n: baselineJoined, d: rows.length, pct: pct(baselineJoined, rows.length) },
      withAliasesJoined: { n: aliasJoined, d: rows.length, pct: pct(aliasJoined, rows.length) },
      newlyJoined: newlyJoined.length,
      newlyBroken: newlyBroken.length,
    },
    precision: {
      joinedToWrongSubject: aliasWrong,
      becameAmbiguous: aliasAmbiguous,
    },
    falseMergeRisk: {
      hardNegativePairsSharingAKey: negativeCollisions.length,
      of: truth.hardNegatives.length,
      cases: negativeCollisions,
    },
    ambiguityIntroduced: {
      keysReachingMoreThanOneSubjectWithAliases: aliasKeyCollisions.length,
      keysReachingMoreThanOneSubjectNameOnly: nameKeyCollisions,
      cases: aliasKeyCollisions.slice(0, 20),
    },
    newlyJoinedCases: newlyJoined.map((r) => ({
      pairId: r.pairId, gleif: r.gleif, wikidata: r.wikidata, matchedVia: r.via,
    })),
    newlyBrokenCases: newlyBroken.map((r) => ({
      pairId: r.pairId, gleif: r.gleif, wikidata: r.wikidata,
      baseline: r.baseline, withAliases: r.withAliases, reached: r.reached,
    })),
    provenanceRequirement:
      "An alias row already carries full provenance (source evidence item, location, method, " +
      "confidence, processing history) because resolution mints it through the same buildProvenance " +
      "path as an entity. Admitting aliases as MATCH candidates would additionally require the " +
      "decision to name WHICH alias string matched and which publisher stated it - a merge " +
      "justified by an alias is only auditable if the alias is attributable. The `via` field in " +
      "this study is the shape that reason text would need.",
    allRows: rows,
  };

  const outDir = path.resolve(ROOT, "reports/no-identifier");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "alias-evidence-study.json"), JSON.stringify(results, null, 2) + "\n");

  console.log("\nALIAS EVIDENCE STUDY - measurement only, nothing was enabled\n");
  console.log(`  positive pairs                       ${rows.length}`);
  console.log(`  alias strings in corpus              ${totalAliasStrings}`);
  console.log("");
  console.log(`  RECALL   name only                   ${pct(baselineJoined, rows.length)}  (${baselineJoined}/${rows.length})`);
  console.log(`           name + publisher aliases    ${pct(aliasJoined, rows.length)}  (${aliasJoined}/${rows.length})`);
  console.log(`           newly joined                ${newlyJoined.length}`);
  console.log(`           newly broken                ${newlyBroken.length}`);
  console.log("");
  console.log(`  PRECISION joined to WRONG subject    ${aliasWrong}`);
  console.log(`            became ambiguous           ${aliasAmbiguous}`);
  console.log("");
  console.log(`  FALSE MERGE RISK`);
  console.log(`    hard negatives sharing a key       ${negativeCollisions.length}/${truth.hardNegatives.length}`);
  for (const c of negativeCollisions) {
    console.log(`      ${c.pairId} [${c.basis}] "${c.a}" == "${c.b}" via ${JSON.stringify(c.shared)}`);
  }
  console.log("");
  console.log(`  AMBIGUITY  keys reaching >1 subject`);
  console.log(`    name only                          ${nameKeyCollisions}`);
  console.log(`    with aliases                       ${aliasKeyCollisions.length}`);
  for (const c of aliasKeyCollisions.slice(0, 8)) {
    console.log(`      "${c.key}" -> ${c.subjects.map((s) => s.name).join(" | ")}`);
  }
  if (newlyJoined.length > 0) {
    console.log("\n  newly joined pairs:");
    for (const r of newlyJoined.slice(0, 12)) {
      console.log(`    ${r.pairId}  "${r.wikidata}" -> "${r.gleif}"  via "${r.via}"`);
    }
  }
  console.log(`\nWrote reports/no-identifier/alias-evidence-study.json`);
}

main();
