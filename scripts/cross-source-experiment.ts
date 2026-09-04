/**
 * Cross-source entity-resolution experiment — REAL data, two publishers.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/cross-source-experiment.ts \
 *     --corpus evidence/public-pilot/gleif-wikidata-cross.corpus.json
 *
 * This is the measurement the GLEIF-only pilot could not make. There, every
 * subject appeared exactly once, so nothing could be joined and every merge
 * metric was arithmetic rather than accuracy. Here each subject appears
 * twice — once as GLEIF states it, once as Wikidata states it — and the LEI
 * that both publishers independently assert is the ground truth the
 * resolver has to rediscover from what it is given.
 *
 * The resolver is NOT modified by this script. It measures whatever the
 * resolver currently does. No fuzzy matching, no embeddings, no
 * adjudication and no ML anywhere in the pipeline it exercises.
 *
 * The first run (P6.14) was against a resolver that merged on any shared
 * identifier. Since P6.15 the Tier-A identifier-authority policy is in
 * force, so `resolverPolicy` in the results file records which behaviour
 * produced a given set of numbers. Comparing metrics across the two is
 * only meaningful once that field has been read.
 *
 * Its database is separate from the synthetic evaluation database, the
 * generalisation database and the GLEIF-only pilot database.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = "./data/cipher-cross-source.db";
process.env.DATABASE_URL = DB_PATH;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

// --- name-difference categorisation -----------------------------------
//
// These label the OBSERVED difference between two publisher strings. They
// are not claims about anyone's intent, and they are not the ground truth:
// the ground truth is the shared LEI. They exist so that a failure can be
// reported as "suffix" or "transliteration" rather than as an
// undifferentiated miss, which is what makes the result actionable.

const LEGAL_SUFFIXES = [
  "private limited", "public limited", "limited", "ltd", "plc", "llp", "llc",
  "incorporated", "inc", "corporation", "corp", "company", "co",
  "lp", "pvt", "gmbh", "ag", "sa", "nv", "bv",
];

const foldCase = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
const stripPunct = (s: string) =>
  foldCase(s).replace(/[.,'"()\-–—«»“”]/g, " ").replace(/\s+/g, " ").trim();
const expandAmp = (s: string) => stripPunct(s).replace(/&/g, " and ").replace(/\s+/g, " ").trim();

function stripSuffix(s: string): string {
  let out = expandAmp(s);
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      const tail = ` ${suffix}`;
      if (out.endsWith(tail)) {
        out = out.slice(0, -tail.length).trim();
        changed = true;
      }
    }
  }
  return out;
}

/** True when the string is entirely Latin/extended-Latin plus separators. */
const isLatin = (s: string) => !/[^\u0000-\u024F\u2000-\u206F\s]/u.test(s);
const tokens = (s: string) => expandAmp(s).split(" ").filter(Boolean);
const sameMultiset = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

export type Variation =
  | "identical"
  | "case_only"
  | "transliteration"
  | "suffix"
  | "abbreviation"
  | "name_order"
  | "divergent";

export function classify(a: string, b: string): Variation {
  if (a === b) return "identical";
  if (foldCase(a) === foldCase(b)) return "case_only";
  if (isLatin(a) !== isLatin(b)) return "transliteration";
  if (stripSuffix(a).length > 0 && stripSuffix(a) === stripSuffix(b)) return "suffix";
  const ta = tokens(a);
  const tb = tokens(b);
  if (sameMultiset(ta, tb)) return "name_order";
  if (expandAmp(a) === expandAmp(b)) return "abbreviation";
  const sa = new Set(ta);
  const sb = new Set(tb);
  if ([...sa].every((t) => sb.has(t)) || [...sb].every((t) => sa.has(t))) return "abbreviation";
  return "divergent";
}

interface TruthRecord {
  recordRef: string;
  registry: string;
  subjectKey: string;
  name: string;
  aliases: string[];
  relations: { predicate: string; targetRegistryRecordId: string }[];
}

interface Mention {
  recordRef: string;
  registry: string;
  subjectKey: string;
  name: string;
  entityId: string | null;
  status: string | null;
  resolutionType: string | null;
}

async function main(): Promise<void> {
  const corpusPath = arg("corpus") ?? "evidence/public-pilot/gleif-wikidata-cross.corpus.json";
  const truthPath = arg("truth") ?? corpusPath.replace(".corpus.json", ".ground-truth.json");

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.resolve(ROOT, DB_PATH + suffix), { force: true });
  }
  fs.mkdirSync(path.dirname(path.resolve(ROOT, DB_PATH)), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, corpusPath), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, truthPath), "utf8")) as {
    crossSource: boolean;
    sources: { sourceId: string; license: string; retrievalChannel: string; rawSha256: string }[];
    subjectCount: number;
    records: TruthRecord[];
  };
  const truthByRef = new Map(truth.records.map((r) => [r.recordRef, r]));

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
  await runResolution();
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
    const recordRef = record.provenance.location.split("#")[0]!;
    const t = truthByRef.get(recordRef);
    if (!t) continue;
    const a = entityByRecordId.get(record.id) ?? null;
    mentions.push({
      recordRef,
      registry: t.registry,
      subjectKey: t.subjectKey,
      name: String(record.data.observedValue),
      entityId: a?.entityId ?? null,
      status: a?.status ?? null,
      resolutionType: a?.type ?? null,
    });
  }

  // --- cross-source pairs: one subject, two publishers ---
  const bySubject = new Map<string, Mention[]>();
  for (const m of mentions) {
    if (!bySubject.has(m.subjectKey)) bySubject.set(m.subjectKey, []);
    bySubject.get(m.subjectKey)!.push(m);
  }
  interface Pair {
    subjectKey: string;
    gleif: Mention;
    wikidata: Mention;
    variation: Variation;
    joined: boolean;
  }
  const pairs: Pair[] = [];
  for (const [subjectKey, ms] of bySubject) {
    const g = ms.find((m) => m.registry === "gleif");
    const w = ms.find((m) => m.registry === "wikidata");
    if (!g || !w) continue;
    pairs.push({
      subjectKey,
      gleif: g,
      wikidata: w,
      variation: classify(g.name, w.name),
      joined: g.entityId !== null && g.entityId === w.entityId,
    });
  }

  // --- the measures ---
  const joined = pairs.filter((p) => p.joined);
  const identifierTypes = new Set(["shared_identifier_merge", "canonicalized_identifier"]);
  const byIdentifier = joined.filter(
    (p) =>
      identifierTypes.has(p.gleif.resolutionType ?? "") || identifierTypes.has(p.wikidata.resolutionType ?? ""),
  );
  const byExactName = joined.filter(
    (p) => p.gleif.resolutionType === "exact_name_match" || p.wikidata.resolutionType === "exact_name_match",
  );
  const byteIdenticalPairs = pairs.filter((p) => p.variation === "identical");

  const membersByEntity = new Map<string, Mention[]>();
  for (const m of mentions.filter((m) => m.entityId)) {
    if (!membersByEntity.has(m.entityId!)) membersByEntity.set(m.entityId!, []);
    membersByEntity.get(m.entityId!)!.push(m);
  }
  const falseMerges = [...membersByEntity.entries()]
    .map(([entityId, members]) => ({
      entityId,
      subjects: [...new Set(members.map((m) => m.subjectKey))],
      names: [...new Set(members.map((m) => m.name))],
    }))
    .filter((g) => g.subjects.length > 1);

  const entitiesBySubject = new Map<string, Set<string>>();
  for (const m of mentions.filter((m) => m.entityId)) {
    if (!entitiesBySubject.has(m.subjectKey)) entitiesBySubject.set(m.subjectKey, new Set());
    entitiesBySubject.get(m.subjectKey)!.add(m.entityId!);
  }
  const fragmented = [...entitiesBySubject.entries()].filter(([, set]) => set.size > 1);
  const unresolved = mentions.filter((m) => !m.entityId || m.status === "ambiguous");

  const aliasValues = new Set(aliases.map((a) => a.aliasValue));
  const expectedAliases = truth.records.flatMap((r) => r.aliases);
  const aliasAttached = expectedAliases.filter((a) => aliasValues.has(a));

  const variations: Variation[] = [
    "identical", "case_only", "transliteration", "suffix", "abbreviation", "name_order", "divergent",
  ];
  const byVariation = variations.map((variation) => {
    const inClass = pairs.filter((p) => p.variation === variation);
    const failed = inClass.filter((p) => !p.joined);
    return {
      variation,
      pairs: inClass.length,
      joined: inClass.length - failed.length,
      failed: failed.length,
      failureRate: pct(failed.length, inClass.length),
      // Every pair in this class, so a reader can check the categorisation.
      cases: inClass.map((p) => ({
        subjectKey: p.subjectKey,
        gleif: p.gleif.name,
        wikidata: p.wikidata.name,
        joined: p.joined,
      })),
    };
  });

  const preservedRelationFacts = records.filter(
    (r) => r.recordType === "relationship_mention" && r.data.factType === "registry_relation",
  );
  const unmappedRelations = [
    ...new Set(
      (graph.warnings ?? [])
        .map((w) => /Unsupported relationship_mention type "([^"]+)"/.exec(w)?.[1])
        .filter((t): t is string => Boolean(t)),
    ),
  ];

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

  const typeHistogram = new Map<string, number>();
  for (const m of mentions) {
    const k = m.resolutionType ?? "(unresolved)";
    typeHistogram.set(k, (typeHistogram.get(k) ?? 0) + 1);
  }

  const results = {
    experiment: "cross-source-entity-resolution",
    dataClass: "real-collected-public-record",
    sources: truth.sources,
    corpus: corpusPath,
    ranAt: new Date().toISOString(),
    // Which resolver behaviour produced these numbers. Not a boolean,
    // because "modified" stops being informative once there is more than
    // one policy in the project's history.
    resolverPolicy: "P6.15-identifier-authority",
    resolverPolicyNotes:
      "Tier A merges only on schemes in MERGEABLE_IDENTIFIER_SCHEMES (LEI). A record asserting " +
      "two or more distinct values of one mergeable scheme is flagged ambiguous_identifier_conflict " +
      "and merged on none of them. Wikidata QIDs are source-local context and never merge.",
    counts: {
      records: manifest.evidenceItems.length,
      subjects: truth.subjectCount,
      crossSourcePairs: pairs.length,
      entities: entities.length,
      aliases: aliases.length,
      relationships: relationships.length,
      graphCounts: graph.counts,
    },
    metrics: {
      crossSourceJoinRate: { n: joined.length, d: pairs.length, pct: pct(joined.length, pairs.length) },
      identifierMatchRate: { n: byIdentifier.length, d: pairs.length, pct: pct(byIdentifier.length, pairs.length) },
      exactNameMatchRate: { n: byExactName.length, d: pairs.length, pct: pct(byExactName.length, pairs.length) },
      byteIdenticalNamePairs: { n: byteIdenticalPairs.length, d: pairs.length, pct: pct(byteIdenticalPairs.length, pairs.length) },
      aliasMatchRate: { n: aliasAttached.length, d: expectedAliases.length, pct: pct(aliasAttached.length, expectedAliases.length) },
      unresolvedRate: { n: unresolved.length, d: mentions.length, pct: pct(unresolved.length, mentions.length) },
      falseMergeRate: { n: falseMerges.length, d: membersByEntity.size, pct: pct(falseMerges.length, membersByEntity.size) },
      fragmentationRate: { n: fragmented.length, d: truth.subjectCount, pct: pct(fragmented.length, truth.subjectCount) },
      provenanceCompleteness: { n: provComplete, d: provRows.length, pct: pct(provComplete, provRows.length) },
    },
    nameVariation: byVariation,
    relationshipPreservation: {
      stated: truth.records.reduce((n, r) => n + r.relations.length, 0),
      preservedAsFacts: preservedRelationFacts.length,
      graphEdges: relationships.length,
      unmappedByGraph: unmappedRelations,
    },
    resolutionTypeHistogram: Object.fromEntries(typeHistogram),
    observations: {
      falseMerges,
      fragmented: fragmented.map(([subject, set]) => ({ subject, entities: [...set] })),
    },
  };

  const outDir = path.resolve(ROOT, "reports/cross-source");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gleif-wikidata-results.json"), JSON.stringify(results, null, 2) + "\n");

  console.log(`\nCROSS-SOURCE EXPERIMENT — ${truth.sources.map((s) => s.sourceId).join(" x ")}`);
  console.log(`${manifest.evidenceItems.length} real records, ${truth.subjectCount} subjects, ${pairs.length} cross-source pairs`);
  console.log(`resolver policy: ${results.resolverPolicy}\n`);
  for (const [name, m] of Object.entries(results.metrics)) {
    console.log(`  ${name.padEnd(26)}${String(m.pct).padStart(7)}  (${m.n}/${m.d})`);
  }
  console.log("\n  name variation between the two publishers' strings:");
  console.log(`    ${"variation".padEnd(17)}${"pairs".padStart(6)}${"joined".padStart(8)}${"failed".padStart(8)}`);
  for (const v of byVariation) {
    if (v.pairs === 0) continue;
    console.log(`    ${v.variation.padEnd(17)}${String(v.pairs).padStart(6)}${String(v.joined).padStart(8)}${String(v.failed).padStart(8)}`);
  }
  console.log("\n  resolution types:");
  for (const [t, n] of typeHistogram) console.log(`    ${t.padEnd(30)} ${n}`);
  console.log(
    `\n  relationship preservation: stated ${results.relationshipPreservation.stated}, ` +
      `facts ${results.relationshipPreservation.preservedAsFacts}, edges ${results.relationshipPreservation.graphEdges}`,
  );
  if (unmappedRelations.length > 0) console.log(`    unmapped by graph: ${unmappedRelations.join(", ")}`);
  console.log(`\nWrote reports/cross-source/gleif-wikidata-results.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
