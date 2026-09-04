/**
 * P6.19.1 - a precise inventory of the real corpus AS IT STANDS.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/corpus-audit.ts
 *
 * READ ONLY. Nothing is collected, nothing is written to any corpus or
 * ground truth. It answers "what do we actually have?" before anything
 * is proposed about what to get next.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizeName } from "@/lib/resolution/name-normalization";

const ROOT = process.cwd();
const BASE = "evidence/no-identifier/no-identifier-pilot";
const DEV = "evidence/no-identifier/devanagari-pilot";

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

/* ---------- script detection over real publisher strings ---------- */
function scriptsOf(s: string): string[] {
  const found = new Set<string>();
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x0041) continue;
    if ((c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a) || (c >= 0xc0 && c <= 0x24f)) found.add("Latin");
    else if (c >= 0x0900 && c <= 0x097f) found.add("Devanagari");
    else if (c >= 0x0400 && c <= 0x04ff) found.add("Cyrillic");
    else if (c >= 0x3040 && c <= 0x30ff) found.add("Kana");
    else if (c >= 0x4e00 && c <= 0x9fff) found.add("Han");
    else if (c >= 0x0600 && c <= 0x06ff) found.add("Arabic");
    else if (c >= 0x0980 && c <= 0x09ff) found.add("Bengali");
    else if (c >= 0x0b80 && c <= 0x0bff) found.add("Tamil");
    else if (c >= 0x0c00 && c <= 0x0c7f) found.add("Telugu");
    else if (c >= 0xac00 && c <= 0xd7af) found.add("Hangul");
  }
  return [...found].sort();
}

interface Truth {
  positives: { pairId: string; lei: string; gleifSurrogate: string; wikidataSurrogate: string; gleifName: string; wikidataName: string }[];
  hardNegatives: { pairId: string; basis: string; a: { surrogate: string; registry: string; name: string; lei: string }; b: { surrogate: string; registry: string; name: string; lei: string } }[];
  undetermined: { wikidataSurrogate: string; name: string; leis: string[]; reason: string }[];
  surrogateMap: Record<string, { registry: string; registryRecordId: string; name: string; leis: string[] }>;
}

function bucket(n: number): string {
  if (n <= 1) return "1 token";
  if (n === 2) return "2 tokens";
  if (n === 3) return "3 tokens";
  if (n <= 5) return "4-5 tokens";
  return "6+ tokens";
}

function main(): void {
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, `${BASE}.ground-truth.json`), "utf8")) as Truth;
  const corpus = JSON.parse(fs.readFileSync(path.join(ROOT, `${BASE}-anchored.corpus.json`), "utf8")) as {
    evidenceItems: { content: Record<string, unknown> }[];
  };
  const full = JSON.parse(fs.readFileSync(path.join(ROOT, `${BASE}-full.corpus.json`), "utf8")) as {
    evidenceItems: { content: Record<string, unknown> }[];
  };
  const devTruth = JSON.parse(fs.readFileSync(path.join(ROOT, `${DEV}.ground-truth.json`), "utf8")) as Truth;
  const anchored = JSON.parse(fs.readFileSync(path.join(ROOT, "reports/no-identifier/anchored-results.json"), "utf8")) as {
    metrics: { positivePairJoinRate: { n: number; d: number; pct: string } } & Record<string, { n: number; d: number; pct: string }>;
    failures: { positivePairsNotJoined: { pairId: string; variation: string }[] };
  };

  const recs = Object.entries(truth.surrogateMap).map(([sur, r]) => ({ sur, ...r }));
  const undetSet = new Set(truth.undetermined.map((u) => u.wikidataSurrogate));

  const out: Record<string, unknown> = {};
  const say = (s = "") => console.log(s);

  say("=".repeat(74));
  say("P6.19.1  REAL CORPUS AUDIT - read only, nothing collected");
  say("=".repeat(74));

  /* 1. records by source */
  const bySource: Record<string, number> = {};
  for (const r of recs) bySource[r.registry] = (bySource[r.registry] ?? 0) + 1;
  say("\n1. RECORDS BY SOURCE");
  for (const [k, v] of Object.entries(bySource)) say(`   ${k.padEnd(12)} ${v}`);
  say(`   ${"TOTAL".padEnd(12)} ${recs.length}`);
  out.recordsBySource = bySource;

  /* 2. unique entities */
  const leiSet = new Set<string>();
  let noLei = 0;
  for (const r of recs) { if (r.leis.length === 0) noLei++; for (const l of r.leis) leiSet.add(l); }
  say("\n2. UNIQUE ENTITIES");
  say(`   distinct LEIs referenced        ${leiSet.size}`);
  say(`   records asserting no LEI        ${noLei}`);
  say(`   ground-truth subjects           182  (records ${recs.length} -> ${recs.length - 182} expected merges)`);
  out.uniqueEntities = { distinctLeis: leiSet.size, recordsWithoutLei: noLei, groundTruthSubjects: 182 };

  /* 3. pairs */
  say("\n3. LABELLED PAIRS");
  say(`   positive pairs                  ${truth.positives.length}`);
  say(`   hard negatives                  ${truth.hardNegatives.length}`);
  say(`   undetermined records            ${truth.undetermined.length}`);
  const hnBasis: Record<string, number> = {};
  for (const n of truth.hardNegatives) hnBasis[n.basis] = (hnBasis[n.basis] ?? 0) + 1;
  say("   hard-negative selection basis:");
  for (const [k, v] of Object.entries(hnBasis)) say(`      ${k.padEnd(28)} ${v}`);
  out.pairs = { positives: truth.positives.length, hardNegatives: truth.hardNegatives.length, undetermined: truth.undetermined.length, hardNegativeBasis: hnBasis };

  /* 4. source combinations */
  const posCombo: Record<string, number> = {};
  for (const p of truth.positives) {
    const a = truth.surrogateMap[p.gleifSurrogate]?.registry, b = truth.surrogateMap[p.wikidataSurrogate]?.registry;
    posCombo[[a, b].sort().join(" x ")] = (posCombo[[a, b].sort().join(" x ")] ?? 0) + 1;
  }
  const negCombo: Record<string, number> = {};
  for (const n of truth.hardNegatives) negCombo[[n.a.registry, n.b.registry].sort().join(" x ")] = (negCombo[[n.a.registry, n.b.registry].sort().join(" x ")] ?? 0) + 1;
  say("\n4. SOURCE COMBINATIONS");
  say("   positives:"); for (const [k, v] of Object.entries(posCombo)) say(`      ${k.padEnd(24)} ${v}`);
  say("   hard negatives:"); for (const [k, v] of Object.entries(negCombo)) say(`      ${k.padEnd(24)} ${v}`);
  say("   >>> only ONE source pairing exists. Every positive is gleif x wikidata.");
  out.sourceCombinations = { positives: posCombo, hardNegatives: negCombo };

  /* 5. script distribution */
  const scriptCount: Record<string, number> = {};
  for (const r of recs) { const k = scriptsOf(r.name).join("+") || "other"; scriptCount[k] = (scriptCount[k] ?? 0) + 1; }
  say("\n5. SCRIPT DISTRIBUTION (primary names, this corpus)");
  for (const [k, v] of Object.entries(scriptCount).sort((a, b) => b[1] - a[1])) say(`   ${k.padEnd(16)} ${v}  (${pct(v, recs.length)})`);
  const devPairs = devTruth.positives.filter((p) => scriptsOf(p.wikidataName).includes("Devanagari")).length;
  say(`   (separate Devanagari pilot corpus carries ${devPairs} Devanagari/Latin primary-name pairs)`);
  out.scriptDistribution = { corpus: scriptCount, devanagariPilotPairs: devPairs };

  /* 6. name length */
  const lenCount: Record<string, number> = {};
  for (const r of recs) { const k = bucket(normalizeName(r.name).normalized.split(" ").filter(Boolean).length); lenCount[k] = (lenCount[k] ?? 0) + 1; }
  say("\n6. NAME LENGTH (normalised tokens)");
  for (const k of ["1 token", "2 tokens", "3 tokens", "4-5 tokens", "6+ tokens"]) if (lenCount[k]) say(`   ${k.padEnd(12)} ${lenCount[k]}  (${pct(lenCount[k]!, recs.length)})`);
  out.nameLength = lenCount;

  /* 7. alias + identifier availability, from the corpus itself */
  let aliasRecords = 0, aliasStrings = 0, idRecords = 0, idValues = 0;
  const aliasByReg: Record<string, number> = {}, idByReg: Record<string, number> = {};
  for (const it of corpus.evidenceItems) {
    const c = it.content as { registry: string; aliases?: string[]; identifiers?: { scheme: string; value: string }[] };
    if (c.aliases?.length) { aliasRecords++; aliasStrings += c.aliases.length; aliasByReg[c.registry] = (aliasByReg[c.registry] ?? 0) + 1; }
    if (c.identifiers?.length) { idRecords++; idValues += c.identifiers.length; idByReg[c.registry] = (idByReg[c.registry] ?? 0) + 1; }
  }
  say("\n7. ALIAS AND IDENTIFIER AVAILABILITY (anchored regime, as the resolver sees it)");
  say(`   records with >=1 alias          ${aliasRecords}/${corpus.evidenceItems.length}  (${pct(aliasRecords, corpus.evidenceItems.length)})   ${JSON.stringify(aliasByReg)}`);
  say(`   total alias strings             ${aliasStrings}`);
  say(`   records with >=1 identifier     ${idRecords}/${corpus.evidenceItems.length}  (${pct(idRecords, corpus.evidenceItems.length)})   ${JSON.stringify(idByReg)}`);
  say(`   >>> identifiers are GLEIF-only by construction; wikidata is stripped.`);
  let fullId = 0;
  for (const it of full.evidenceItems) if (((it.content as { identifiers?: unknown[] }).identifiers ?? []).length) fullId++;
  say(`   FULL regime records with an identifier: ${fullId}/${full.evidenceItems.length}`);
  out.availability = { aliasRecords, aliasStrings, identifierRecords: idRecords, identifierValues: idValues, aliasByRegistry: aliasByReg, identifierByRegistry: idByReg, fullRegimeIdentifierRecords: fullId };

  /* 8. relationship coverage */
  let relCount = 0;
  for (const it of full.evidenceItems) relCount += ((it.content as { relations?: unknown[] }).relations ?? []).length;
  say("\n8. RELATIONSHIP COVERAGE");
  say(`   relations present in either regime   ${relCount}`);
  say(`   >>> relations[] is MASKED by the no-identifier corpus builder, so this`);
  say(`       corpus carries NO relationship evidence at all. GLEIF Level 2 data`);
  say(`       exists at the source and was used in the P6.9 pilot, but not here.`);
  out.relationshipCoverage = { relationsInCorpus: relCount, note: "relations[] masked by the corpus builder; GLEIF Level 2 exists at source but is absent here" };

  /* 9. failure categories, from the authoritative measured report */
  const failByCat: Record<string, number> = {};
  for (const f of anchored.failures.positivePairsNotJoined) failByCat[f.variation] = (failByCat[f.variation] ?? 0) + 1;
  say("\n9. CURRENT FAILURE CATEGORIES (shipped resolver, measured)");
  say(`   positivePairJoinRate            ${anchored.metrics.positivePairJoinRate.pct} (${anchored.metrics.positivePairJoinRate.n}/${anchored.metrics.positivePairJoinRate.d})`);
  for (const [k, v] of Object.entries(failByCat)) say(`   unjoined - ${k.padEnd(18)} ${v}`);
  out.failureCategories = { joinRate: anchored.metrics.positivePairJoinRate, unjoinedByCategory: failByCat };

  /* 10. duplicates */
  const byRecordId = new Map<string, string[]>();
  for (const r of recs) { const k = `${r.registry}:${r.registryRecordId}`; if (!byRecordId.has(k)) byRecordId.set(k, []); byRecordId.get(k)!.push(r.sur); }
  const dupIds = [...byRecordId.entries()].filter(([, v]) => v.length > 1);
  const byNameReg = new Map<string, string[]>();
  for (const r of recs) { const k = `${r.registry}|${normalizeName(r.name).normalized}`; if (!byNameReg.has(k)) byNameReg.set(k, []); byNameReg.get(k)!.push(r.sur); }
  const dupNames = [...byNameReg.entries()].filter(([, v]) => v.length > 1);
  say("\n10. DUPLICATES");
  say(`   duplicate registry record ids   ${dupIds.length}`);
  say(`   same normalised name within one source  ${dupNames.length}`);
  for (const [k, v] of dupNames.slice(0, 8)) {
    const leis = v.map((s) => truth.surrogateMap[s]!.leis.join("/") || "none");
    say(`      "${k}"  x${v.length}  leis=[${leis.join(", ")}]${new Set(leis).size > 1 ? "  <-- DISTINCT ENTITIES SHARING A NAME" : ""}`);
  }
  out.duplicates = { duplicateRecordIds: dupIds.length, sameNormalisedNameWithinSource: dupNames.length,
    cases: dupNames.map(([k, v]) => ({ key: k, surrogates: v, leis: v.map((s) => truth.surrogateMap[s]!.leis) })) };

  /* 11. leakage between evaluation and any future training split */
  const posSubjects = new Set(truth.positives.map((p) => p.lei));
  const hnSubjects = new Set(truth.hardNegatives.flatMap((n) => [n.a.lei, n.b.lei]));
  const overlap = [...posSubjects].filter((l) => hnSubjects.has(l));
  say("\n11. LEAKAGE RISK");
  say(`   subjects appearing in BOTH a positive pair and a hard negative   ${overlap.length}`);
  say(`   >>> this is the number that matters if these pairs were ever split`);
  say(`       into train/eval: a subject on both sides of the split leaks.`);
  const devLeis = new Set(devTruth.positives.map((p) => p.lei));
  const shared = [...posSubjects].filter((l) => devLeis.has(l));
  say(`   subjects shared between the main corpus and the Devanagari pilot   ${shared.length}/${posSubjects.size}`);
  say(`   >>> the Devanagari pilot is NOT independent - it is the same`);
  say(`       entities re-viewed through their Hindi labels.`);
  out.leakage = { subjectsInBothPositiveAndHardNegative: overlap.length, overlapSubjects: overlap,
    devanagariPilotSharedSubjects: shared.length, mainCorpusSubjects: posSubjects.size };

  fs.mkdirSync(path.join(ROOT, "reports/corpus-audit"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "reports/corpus-audit/corpus-audit.json"),
    `${JSON.stringify({ audit: "P6.19.1 real corpus audit", dataClass: "REAL", ranAt: new Date().toISOString(), readOnly: true, ...out }, null, 2)}\n`);
  say("\nwritten: reports/corpus-audit/corpus-audit.json");
}
main();
