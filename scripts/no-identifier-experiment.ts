/**
 * P6.16.2 - BASELINE the existing resolver on the real no-identifier corpus.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/no-identifier-experiment.ts \
 *     --regime full|anchored
 *
 * The resolver is NOT modified by this script and NOT modified by this
 * milestone. `src/lib/resolution` is byte-identical to what P6.15.1 left.
 * This measures what the current system does when the identifier that has
 * carried every real cross-source join so far is taken away.
 *
 * The identifier is absent from the CORPUS (see
 * scripts/build-no-identifier-corpus.ts), not suppressed behind a flag, so
 * there is no path by which the resolver could read it. The ground truth
 * lives in a file the pipeline never opens. A leak check runs at
 * MEASUREMENT time as well as at build time: if any masked identifier
 * reached an extracted record, the run reports VOID instead of a metric.
 *
 * Its database is separate from the synthetic evaluation database, the
 * generalisation database, the GLEIF-only pilot database and the
 * GLEIF x Wikidata cross-source database.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

// --- observed name-difference categories -----------------------------
//
// These label the difference between two REAL publisher strings. They are
// descriptions of what was observed, never ground truth and never a
// matching rule: nothing here is used to resolve anything. They exist so
// a failure can be reported as "legal suffix" or "transliteration"
// instead of as an undifferentiated miss.

const LEGAL_SUFFIXES = [
  "private limited", "public limited", "limited", "ltd", "plc", "llp", "llc",
  "incorporated", "inc", "corporation", "corp", "company", "co",
  "lp", "pvt", "gmbh", "ag", "sa", "nv", "bv",
];

/**
 * Punctuation publishers vary freely, ASCII and Unicode. Built from code
 * points rather than written literally so this file stays pure ASCII.
 * 2010-2015 are the hyphen/dash family, 00AB/00BB the guillemets,
 * 2018/2019/201C/201D the curly quotes.
 */
const PUNCTUATION_CHARS = [
  ".", ",", "'", '"', "(", ")", "-",
  ...[0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,
      0x00ab, 0x00bb, 0x2018, 0x2019, 0x201c, 0x201d].map((c) => String.fromCharCode(c)),
];

const foldCase = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const stripPunct = (s: string) => {
  let out = foldCase(s);
  for (const ch of PUNCTUATION_CHARS) out = out.split(ch).join(" ");
  return out.replace(/\s+/g, " ").trim();
};
const expandAmp = (s: string) => stripPunct(s).replace(/&/g, " and ").replace(/\s+/g, " ").trim();
const noSpace = (s: string) => foldCase(s).replace(/\s+/g, "");

function stripSuffix(s: string): string {
  let out = expandAmp(s);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (out.endsWith(` ${suffix}`)) {
        out = out.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out;
}

/**
 * True when every character is Latin or extended Latin (up to 024F) or
 * general punctuation (2000-206F). Devanagari, Cyrillic and CJK are all
 * outside that range, so a Latin/non-Latin difference between two names
 * is a transliteration difference.
 */
const isLatin = (s: string) =>
  [...s].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c <= 0x024f || (c >= 0x2000 && c <= 0x206f);
  });

const tokens = (s: string) => expandAmp(s).split(" ").filter(Boolean);
const sameMultiset = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export type Variation =
  | "identical"
  | "case_only"
  | "transliteration"
  | "punctuation_only"
  | "spacing_only"
  | "suffix"
  | "name_order"
  | "abbreviation"
  | "divergent";

export function classify(a: string, b: string): Variation {
  if (a === b) return "identical";
  if (foldCase(a) === foldCase(b)) return "case_only";
  if (isLatin(a) !== isLatin(b)) return "transliteration";
  if (stripPunct(a) === stripPunct(b)) return "punctuation_only";
  if (noSpace(a) === noSpace(b)) return "spacing_only";
  const sa = stripSuffix(a);
  if (sa.length > 0 && sa === stripSuffix(b)) return "suffix";
  const ta = tokens(a);
  const tb = tokens(b);
  if (sameMultiset(ta, tb)) return "name_order";
  if (expandAmp(a) === expandAmp(b)) return "abbreviation";
  const setA = new Set(ta);
  const setB = new Set(tb);
  if (
    setA.size > 0 && setB.size > 0 &&
    ([...setA].every((t) => setB.has(t)) || [...setB].every((t) => setA.has(t)))
  ) return "abbreviation";
  return "divergent";
}

interface Truth {
  counts: Record<string, number>;
  sources: unknown[];
  maskedFromResolver: unknown;
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
  undetermined: { wikidataSurrogate: string; name: string; leis: string[]; reason: string }[];
  surrogateMap: Record<string, { registry: string; registryRecordId: string; name: string; leis: string[] }>;
}

interface Mention {
  surrogate: string; registry: string; subjectKey: string; name: string;
  entityId: string | null; status: string | null; resolutionType: string | null;
}

async function main(): Promise<void> {
  const regime = (arg("regime") ?? "anchored") as "full" | "anchored";
  if (regime !== "full" && regime !== "anchored") {
    console.error("--regime must be full or anchored");
    process.exitCode = 1;
    return;
  }
  const base = arg("corpus") ?? "evidence/no-identifier/no-identifier-pilot";
  const corpusPath = `${base}-${regime}.corpus.json`;
  const truthPath = `${base}.ground-truth.json`;
  // The database is scratch, not evidence: nothing downstream reads it
  // after the run. `--db` exists because some working copies live on a
  // filesystem that will not let SQLite manage its own journal files, and
  // a measurement should not be blocked by where the checkout happens to
  // sit. It changes no input and no metric.
  const DB_PATH = arg("db") ?? `./data/cipher-no-identifier-${regime}.db`;
  process.env.DATABASE_URL = DB_PATH;

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.resolve(ROOT, DB_PATH + suffix), { force: true });
  }
  fs.mkdirSync(path.dirname(path.resolve(ROOT, DB_PATH)), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, corpusPath), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, truthPath), "utf8")) as Truth;

  // The subject a record belongs to, in ground-truth terms. GLEIF records
  // are keyed by their own LEI; a Wikidata record by the single LEI it
  // states. A record whose subject the publishers do not agree on is its
  // own subject - see `undetermined`.
  const subjectOf = new Map<string, string>();
  for (const [sur, real] of Object.entries(truth.surrogateMap)) {
    subjectOf.set(sur, real.leis.length === 1 ? `LEI:${real.leis[0]}` : `UNDETERMINED:${sur}`);
  }
  // In the anchored regime GLEIF records keep their real ids, so a record
  // is addressed by whichever id actually appears in the corpus.
  const surrogateByCorpusId = new Map<string, string>();
  for (const [sur, real] of Object.entries(truth.surrogateMap)) {
    surrogateByCorpusId.set(`${real.registry}:${sur}`, sur);
    surrogateByCorpusId.set(`${real.registry}:${real.registryRecordId}`, sur);
  }

  const { runIngestion } = await import("@/lib/ingestion/service");
  const { runExtraction } = await import("@/lib/extraction/service");
  const { runResolution } = await import("@/lib/resolution/service");
  const { runGraphSynthesis } = await import("@/lib/graph/service");
  const repo = await import("@/lib/db/repository");

  const ingestion = await runIngestion({ kind: "uploaded", contents: manifest, filename: corpusPath });
  if (ingestion.status !== "ingested") {
    console.error("ingestion failed:", JSON.stringify(ingestion.error ?? ingestion.stages.at(-1), null, 2));
    process.exitCode = 1;
    return;
  }
  await runExtraction();
  const resolution = await runResolution();
  const graph = await runGraphSynthesis();

  const [records, decisions, entities, aliases, relationships] = await Promise.all([
    repo.listExtractedRecords(),
    repo.listResolutionDecisions(),
    repo.listEntities(),
    repo.listAliases(),
    repo.listRelationships(),
  ]);

  const entityByRecordId = new Map<string, { entityId: string; status: string; type: string }>();
  for (const decision of decisions) {
    for (const recordId of decision.extractedRecordIds) {
      entityByRecordId.set(recordId, {
        entityId: decision.canonicalEntityId,
        status: decision.status,
        type: decision.resolutionType,
      });
    }
  }

  const mentions: Mention[] = [];
  for (const record of records) {
    if (record.recordType !== "entity_mention") continue;
    const kind = record.data.mentionKind;
    if (kind !== "organisation" && kind !== "person") continue;
    const ref = record.provenance.location.split("#")[0]!;
    const sur = surrogateByCorpusId.get(ref);
    if (!sur) continue;
    const real = truth.surrogateMap[sur]!;
    const decided = entityByRecordId.get(record.id) ?? null;
    mentions.push({
      surrogate: sur,
      registry: real.registry,
      subjectKey: subjectOf.get(sur)!,
      name: String(record.data.observedValue),
      entityId: decided?.entityId ?? null,
      status: decided?.status ?? null,
      resolutionType: decided?.type ?? null,
    });
  }
  const bySurrogate = new Map(mentions.map((m) => [m.surrogate, m]));

  // --- positive pairs: same real entity, shared identifier withheld ---
  interface PosResult {
    pairId: string; variation: Variation;
    gleifName: string; wikidataName: string;
    joined: boolean; gleifEntity: string | null; wikidataEntity: string | null;
    wikidataResolution: string | null; gleifResolution: string | null;
  }
  const positiveResults: PosResult[] = [];
  for (const p of truth.positives) {
    const g = bySurrogate.get(p.gleifSurrogate);
    const w = bySurrogate.get(p.wikidataSurrogate);
    if (!g || !w) continue;
    positiveResults.push({
      pairId: p.pairId,
      variation: classify(p.gleifName, p.wikidataName),
      gleifName: p.gleifName,
      wikidataName: p.wikidataName,
      joined: g.entityId !== null && g.entityId === w.entityId,
      gleifEntity: g.entityId,
      wikidataEntity: w.entityId,
      wikidataResolution: w.resolutionType,
      gleifResolution: g.resolutionType,
    });
  }

  // --- hard negatives: different real entities, confusable names ------
  const negativeResults = truth.hardNegatives.flatMap((neg) => {
    const a = bySurrogate.get(neg.a.surrogate);
    const b = bySurrogate.get(neg.b.surrogate);
    if (!a || !b) return [];
    return [{
      pairId: neg.pairId,
      basis: neg.basis,
      aName: neg.a.name,
      bName: neg.b.name,
      variation: classify(neg.a.name, neg.b.name),
      falselyMerged: a.entityId !== null && a.entityId === b.entityId,
      aStatus: a.status,
      bStatus: b.status,
    }];
  });

  // --- corpus-wide integrity ------------------------------------------
  const membersByEntity = new Map<string, Mention[]>();
  for (const m of mentions) {
    if (!m.entityId) continue;
    if (!membersByEntity.has(m.entityId)) membersByEntity.set(m.entityId, []);
    membersByEntity.get(m.entityId)!.push(m);
  }
  const falseMerges = [...membersByEntity.entries()]
    .map(([entityId, members]) => ({
      entityId,
      subjects: [...new Set(members.map((m) => m.subjectKey))],
      names: [...new Set(members.map((m) => m.name))],
    }))
    .filter((g) => g.subjects.length > 1);

  const entitiesBySubject = new Map<string, Set<string>>();
  for (const m of mentions) {
    if (!m.entityId) continue;
    if (!entitiesBySubject.has(m.subjectKey)) entitiesBySubject.set(m.subjectKey, new Set());
    entitiesBySubject.get(m.subjectKey)!.add(m.entityId);
  }
  // A subject can only be FRAGMENTED if it was observed more than once.
  // Counting single-observation subjects in the denominator would make
  // the rate a function of corpus padding rather than of the resolver.
  const observationCount = new Map<string, number>();
  for (const m of mentions) observationCount.set(m.subjectKey, (observationCount.get(m.subjectKey) ?? 0) + 1);
  const observedTwice = new Set([...observationCount.entries()].filter(([, n]) => n > 1).map(([k]) => k));
  const fragmented = [...entitiesBySubject.entries()].filter(
    ([subject, set]) => set.size > 1 && observedTwice.has(subject),
  );
  const unresolved = mentions.filter((m) => !m.entityId || m.status === "ambiguous");

  const aliasValues = new Set(aliases.map((a) => a.aliasValue));
  const expectedAliases = (manifest.evidenceItems as { content: { aliases?: string[] } }[])
    .flatMap((i) => i.content.aliases ?? []);
  const aliasAttached = expectedAliases.filter((a) => aliasValues.has(a));

  // --- Tier B: did the name path fire at all? -------------------------
  const typeHistogram = new Map<string, number>();
  for (const m of mentions) {
    const k = m.resolutionType ?? "(unresolved)";
    typeHistogram.set(k, (typeHistogram.get(k) ?? 0) + 1);
  }
  // Tier B is now two branches: B1 exact, B2 normalised (P6.17.1). Both
  // count as "the name path fired", and the ambiguity types count too -
  // a flagged near-collision is the name path working, not failing.
  const tierBTypes = [
    "exact_name_match",
    "normalized_name_match",
    "ambiguous_name_conflict",
    "ambiguous_normalized_name_conflict",
  ];
  const tierBFirings = tierBTypes.reduce((n, t) => n + (typeHistogram.get(t) ?? 0), 0);

  const VARIATIONS: Variation[] = [
    "identical", "case_only", "transliteration", "punctuation_only", "spacing_only",
    "suffix", "name_order", "abbreviation", "divergent",
  ];
  const byVariation = VARIATIONS.map((variation) => {
    const inClass = positiveResults.filter((p) => p.variation === variation);
    const failed = inClass.filter((p) => !p.joined);
    return {
      variation,
      pairs: inClass.length,
      joined: inClass.length - failed.length,
      failed: failed.length,
      failureRate: pct(failed.length, inClass.length),
      cases: inClass.map((p) => ({
        pairId: p.pairId, gleif: p.gleifName, wikidata: p.wikidataName,
        joined: p.joined, wikidataResolution: p.wikidataResolution,
      })),
    };
  });

  const { collectProvenanceBearingRows } = await import("@/lib/evaluation/snapshot");
  const provRows = collectProvenanceBearingRows({
    entities, aliases, locations: [], evidenceItems: [],
    extractedRecords: records, resolutionDecisions: decisions,
    relationships, analyticalSignals: [], corroborationFindings: [],
  });
  const provComplete = provRows.filter((r) => {
    const p = r.provenance as unknown as Record<string, unknown>;
    return (
      typeof p.source === "string" && p.source.length > 0 &&
      typeof p.location === "string" && p.location.length > 0 &&
      typeof p.method === "string" && p.method.length > 0 &&
      typeof p.confidence === "number" &&
      Array.isArray(p.processingHistory) && p.processingHistory.length > 0 &&
      typeof p.timestamp === "string" && !Number.isNaN(Date.parse(p.timestamp))
    );
  }).length;

  // A leak check that runs at MEASUREMENT time, not only at build time.
  //
  // It is scoped PER RECORD, not over the whole corpus, because "this LEI
  // appears somewhere" is not the question. In the anchored regime GLEIF
  // legitimately carries the LEI it issues - that is the reference set -
  // and a corpus-wide string search would flag it and call a correct run
  // void. What must be true is narrower and is the actual experimental
  // claim: no record on the MASKED side may carry any identifying value,
  // so nothing on that side can join by anything but its name.
  const maskedSurrogates = new Set(
    Object.entries(truth.surrogateMap)
      .filter(([, real]) => regime === "full" || real.registry !== "gleif")
      .map(([sur]) => sur),
  );
  const maskedIds = [...new Set(
    Object.entries(truth.surrogateMap)
      .filter(([sur]) => maskedSurrogates.has(sur))
      .flatMap(([, real]) => [real.registryRecordId, ...real.leis]),
  )];
  const leaked: { surrogate: string; identifier: string; recordId: string }[] = [];
  for (const record of records) {
    const ref = record.provenance.location.split("#")[0]!;
    const sur = surrogateByCorpusId.get(ref);
    if (!sur || !maskedSurrogates.has(sur)) continue;
    const blob = JSON.stringify({ d: record.data, p: record.provenance });
    for (const id of maskedIds) {
      if (blob.includes(id)) leaked.push({ surrogate: sur, identifier: id, recordId: record.id });
    }
  }

  const joinedCount = positiveResults.filter((p) => p.joined).length;
  const exactNameJoins = positiveResults.filter((p) => p.wikidataResolution === "exact_name_match").length;
  const normalizedNameJoins = positiveResults.filter(
    (p) => p.wikidataResolution === "normalized_name_match",
  ).length;
  const unresolvedMentions = mentions.filter((m) => m.status === "unresolved").length;
  const byteIdentical = positiveResults.filter((p) => p.variation === "identical").length;
  const falselyMergedNegatives = negativeResults.filter((n) => n.falselyMerged);

  const results = {
    experiment: "no-identifier-entity-resolution",
    regime,
    dataClass: "real-collected-public-record",
    corpus: corpusPath,
    groundTruth: truthPath,
    database: DB_PATH,
    ranAt: new Date().toISOString(),
    resolverPolicy:
      "P6.15-identifier-authority (UNMODIFIED - P6.16 changed no matching logic, no tier, no threshold)",
    sources: truth.sources,
    maskedFromResolver: truth.maskedFromResolver,
    leakCheck: {
      scope: regime === "full"
        ? "every record in the corpus is masked"
        : "every Wikidata record is masked; GLEIF legitimately carries the LEI it issues",
      maskedRecords: maskedSurrogates.size,
      maskedIdentifiersSearchedFor: maskedIds.length,
      occurrencesInMaskedRecords: leaked.length,
      verdict: leaked.length === 0
        ? "CLEAN - no masked identifier reached extraction on the masked side"
        : "VOID - masked identifiers leaked into the pipeline",
      leaked,
    },
    counts: {
      records: manifest.evidenceItems.length,
      mentions: mentions.length,
      entities: entities.length,
      aliases: aliases.length,
      relationships: relationships.length,
      positivePairs: positiveResults.length,
      hardNegativePairs: negativeResults.length,
      subjectsObservedMoreThanOnce: observedTwice.size,
      graphCounts: graph.counts,
      resolutionWarnings: resolution.warnings?.length ?? 0,
    },
    metrics: {
      positivePairJoinRate: { n: joinedCount, d: positiveResults.length, pct: pct(joinedCount, positiveResults.length) },
      exactNameMatchRate: { n: exactNameJoins, d: positiveResults.length, pct: pct(exactNameJoins, positiveResults.length) },
      normalizedNameMatchRate: {
        n: normalizedNameJoins, d: positiveResults.length,
        pct: pct(normalizedNameJoins, positiveResults.length),
      },
      byteIdenticalNamePairs: { n: byteIdentical, d: positiveResults.length, pct: pct(byteIdentical, positiveResults.length) },
      aliasMatchRate: { n: aliasAttached.length, d: expectedAliases.length, pct: pct(aliasAttached.length, expectedAliases.length) },
      unresolvedRate: { n: unresolved.length, d: mentions.length, pct: pct(unresolved.length, mentions.length) },
      falseMergeRate: { n: falseMerges.length, d: membersByEntity.size, pct: pct(falseMerges.length, membersByEntity.size) },
      hardNegativeFalseMergeRate: {
        n: falselyMergedNegatives.length, d: negativeResults.length,
        pct: pct(falselyMergedNegatives.length, negativeResults.length),
      },
      fragmentationRate: { n: fragmented.length, d: observedTwice.size, pct: pct(fragmented.length, observedTwice.size) },
      provenanceCompleteness: { n: provComplete, d: provRows.length, pct: pct(provComplete, provRows.length) },
      /**
       * Mentions the resolver itself reports as uncorroborated. Before
       * P6.17.2 this was structurally 0 whatever happened, because an
       * uncorroborated mention was recorded as `resolved` / `new_entity` -
       * the silent-failure defect. It is a SELF-REPORTED number, not a
       * ground-truth one: its value is that the system now says it.
       */
      selfReportedUnresolvedRate: {
        n: unresolvedMentions, d: mentions.length, pct: pct(unresolvedMentions, mentions.length),
      },
    },
    tierB: {
      fired: tierBFirings > 0,
      firings: tierBFirings,
      exactNameMatch: typeHistogram.get("exact_name_match") ?? 0,
      ambiguousNameConflict: typeHistogram.get("ambiguous_name_conflict") ?? 0,
      normalizedNameMatch: typeHistogram.get("normalized_name_match") ?? 0,
      ambiguousNormalizedNameConflict: typeHistogram.get("ambiguous_normalized_name_conflict") ?? 0,
      note:
        "Tier B can only match an identifier-less mention into a Tier-A cluster. Where no record " +
        "carries an identifier there are no Tier-A clusters, so Tier B has nothing to match " +
        "against and cannot fire however similar the names are - which is why the FULL regime is " +
        "unchanged by normalisation and the ANCHORED regime is not. That is a property of the " +
        "tier structure, not of the normalisation rules.",
    },
    nameVariation: byVariation,
    resolutionTypeHistogram: Object.fromEntries([...typeHistogram].sort()),
    failures: {
      positivePairsNotJoined: positiveResults.filter((p) => !p.joined).map((p) => ({
        pairId: p.pairId, variation: p.variation,
        gleif: p.gleifName, wikidata: p.wikidataName,
        wikidataResolution: p.wikidataResolution, gleifResolution: p.gleifResolution,
        gleifEntity: p.gleifEntity, wikidataEntity: p.wikidataEntity,
      })),
      hardNegativesFalselyMerged: falselyMergedNegatives,
      hardNegativesHeldApart: negativeResults.filter((n) => !n.falselyMerged),
      corpusWideFalseMerges: falseMerges,
      fragmentedSubjects: fragmented.map(([subject, set]) => ({ subject, entities: [...set] })),
      undetermined: truth.undetermined,
    },
  };

  const outDir = path.resolve(ROOT, "reports/no-identifier");
  fs.mkdirSync(outDir, { recursive: true });
  // Named after the corpus as well as the regime, so a second corpus
  // (the Devanagari-primary pilot) cannot overwrite the first one's
  // report - which it silently did the first time this was run.
  const corpusName = path.basename(base);
  const reportName =
    corpusName === "no-identifier-pilot" ? `${regime}-results.json` : `${corpusName}-${regime}-results.json`;
  fs.writeFileSync(path.join(outDir, reportName), JSON.stringify(results, null, 2) + "\n");

  console.log(`\nNO-IDENTIFIER EXPERIMENT - regime: ${regime}`);
  console.log(
    `${manifest.evidenceItems.length} real records, ${positiveResults.length} positive pairs, ` +
    `${negativeResults.length} hard negatives`,
  );
  console.log(`resolver: ${results.resolverPolicy}`);
  console.log(`leak check: ${results.leakCheck.verdict}\n`);
  for (const [name, m] of Object.entries(results.metrics)) {
    console.log(`  ${name.padEnd(28)}${String(m.pct).padStart(7)}  (${m.n}/${m.d})`);
  }
  console.log(`\n  Tier B fired: ${results.tierB.fired} (${results.tierB.firings} firing(s))`);
  console.log("\n  positive pairs by observed name difference:");
  console.log(`    ${"variation".padEnd(19)}${"pairs".padStart(6)}${"joined".padStart(8)}${"failed".padStart(8)}`);
  for (const v of byVariation) {
    if (v.pairs === 0) continue;
    console.log(
      `    ${v.variation.padEnd(19)}${String(v.pairs).padStart(6)}` +
      `${String(v.joined).padStart(8)}${String(v.failed).padStart(8)}`,
    );
  }
  console.log("\n  resolution types:");
  for (const [t, n] of [...typeHistogram].sort()) console.log(`    ${t.padEnd(32)} ${n}`);
  console.log(`\n  hard negatives falsely merged: ${falselyMergedNegatives.length}/${negativeResults.length}`);
  for (const n of falselyMergedNegatives.slice(0, 10)) {
    console.log(`    ${n.pairId} [${n.basis}] ${n.aName}  ==  ${n.bName}`);
  }
  console.log(`\nWrote reports/no-identifier/${reportName}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
