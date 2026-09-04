/**
 * P6.20.2 — the bounded LEI set to ask GLEIF Level 2 about.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-relationship-linkage-set.ts
 *
 * Emits a public-records-shaped file that `collect-public.ts --leis-from`
 * accepts. It COLLECTS NOTHING and opens no socket; it only decides which
 * already-collected records the next bounded request should be about.
 *
 * WHY A SUBSET, AND WHY THIS SUBSET.
 *
 * The expanded corpus holds 661 distinct LEIs. Asking for both parent
 * relations of all of them is 1,322 requests and exceeds the adapter's
 * MAX_LIMIT of 500 records, which exists precisely so a collection cannot
 * quietly grow. So the set is bounded — but the bound must not be chosen
 * by which pairs I expect to come back related, because that would decide
 * the answer by choosing the sample.
 *
 * The rule used instead is a property of the PAIR CLASS, fixed before any
 * relationship was fetched: include every LEI appearing in a pair whose
 * class leaves the parent/subsidiary question open.
 *
 *   hard negatives         — the false-merge population. A rule's cost is
 *                            measured here, so its evidence must be here.
 *   containment            — the 160 positives the prefix rule targets.
 *   partial_token_overlap  — the 69 the same rule partially reaches.
 *   divergent              — the 69 with no string relation at all, kept
 *                            in so the measurement includes a class where
 *                            a parent edge is NOT expected to help. Drop
 *                            it and the result can only look favourable.
 *
 * Excluded are identical, case_only, legal_suffix_or_punctuation and
 * script_variant: those already join, or fail, for reasons that have
 * nothing to do with ownership, so a parent edge could not change their
 * verdict either way.
 *
 * Both ends of every such pair are included even when only one end is
 * GLEIF-issued, and inclusion never depends on the names involved.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const GROUND_TRUTH = "evidence/expanded/expanded.ground-truth.json";
const OUT = "evidence/expanded/relationship-linkage-set.json";

/** Pair classes where an ownership edge could change the verdict. */
const OPEN_CLASSES = new Set(["containment", "partial_token_overlap", "divergent"]);

interface Truth {
  positives: { pairId: string; variation: string; a: { recordRef: string }; b: { recordRef: string } }[];
  hardNegatives: { pairId: string; a: { recordRef: string }; b: { recordRef: string } }[];
  surrogateMap: Record<string, { registry: string; recordRef: string; name: string; leis: string[] }>;
}

function main(): void {
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, GROUND_TRUTH), "utf8")) as Truth;
  const byRef = new Map(Object.values(truth.surrogateMap).map((r) => [r.recordRef, r]));

  /** A record contributes its LEI only when it states exactly one. */
  const leiOf = (ref: string): string | null => {
    const rec = byRef.get(ref);
    return rec && rec.leis.length === 1 ? rec.leis[0]! : null;
  };

  const reasons = new Map<string, Set<string>>();
  const include = (ref: string, why: string) => {
    const lei = leiOf(ref);
    if (!lei) return;
    if (!reasons.has(lei)) reasons.set(lei, new Set());
    reasons.get(lei)!.add(why);
  };

  for (const n of truth.hardNegatives) {
    include(n.a.recordRef, "hard_negative");
    include(n.b.recordRef, "hard_negative");
  }
  for (const p of truth.positives) {
    if (!OPEN_CLASSES.has(p.variation)) continue;
    include(p.a.recordRef, p.variation);
    include(p.b.recordRef, p.variation);
  }

  const leis = [...reasons.keys()].sort();

  // Shaped as public_records so --leis-from reads it with no special
  // case: the flag's whole point is that a linkage set is DERIVED from
  // already-collected approved records rather than hand-typed.
  const records = leis.map((lei) => ({
    recordRef: `gleif:${lei}`,
    registry: "gleif",
    registryRecordId: lei,
    identifiers: [{ scheme: "LEI", value: lei }],
    selectionReasons: [...reasons.get(lei)!].sort(),
  }));

  fs.mkdirSync(path.join(ROOT, path.dirname(OUT)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, OUT), `${JSON.stringify(records, null, 2)}\n`);

  const byReason: Record<string, number> = {};
  for (const set of reasons.values()) for (const r of set) byReason[r] = (byReason[r] ?? 0) + 1;

  console.log(`${leis.length} distinct LEIs selected from ${GROUND_TRUTH}`);
  for (const [r, n] of Object.entries(byReason).sort()) console.log(`  ${r.padEnd(22)} ${n}`);
  console.log(`\nwrote ${OUT}`);
}

main();
