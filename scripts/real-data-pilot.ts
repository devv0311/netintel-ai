/**
 * Real-data pilot: run REAL collected public records through the
 * existing pipeline and measure the CURRENT resolver against them.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/real-data-pilot.ts \
 *     --corpus evidence/public-pilot/gleif-in-pilot.corpus.json
 *
 * The resolver is NOT modified for this run and must not be. If it were
 * adjusted to cope, this would measure the adjustment.
 *
 * This is deliberately a different measurement from
 * generalisation-experiment.ts, which scores name variants against an
 * identifier-anchored variant of the same subject. That shape does not
 * exist here: a register publishes ONE record per entity, so every
 * record is its own anchor and every anchor-relative metric would read
 * 100% while testing nothing. Reporting those numbers off real data
 * would be the most flattering possible way to say nothing, so this
 * script measures what single-register data can actually falsify —
 * false merges, fragmentation, alias attachment, relation survival and
 * provenance — and states plainly what it cannot test at all.
 *
 * Its database is separate from both the synthetic evaluation database
 * and the generalisation database. Real and synthetic never share one.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = "./data/netintel-real-pilot.db";
process.env.DATABASE_URL = DB_PATH;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

interface TruthRecord {
  recordRef: string;
  subjectKey: string;
  name: string;
  subjectKind: string;
  jurisdiction: string | null;
  status: string | null;
  aliases: string[];
  relations: { predicate: string; targetRegistryRecordId: string }[];
}

async function main(): Promise<void> {
  const corpusPath = arg("corpus") ?? "evidence/public-pilot/gleif-in-pilot.corpus.json";
  const truthPath = arg("truth") ?? corpusPath.replace(".corpus.json", ".ground-truth.json");

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.resolve(ROOT, DB_PATH + suffix), { force: true });
  }
  fs.mkdirSync(path.dirname(path.resolve(ROOT, DB_PATH)), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, corpusPath), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, truthPath), "utf8")) as {
    source: string;
    license: string;
    retrievalChannel: string;
    rawSha256: string;
    subjectCount: number;
    records: TruthRecord[];
    observations: { exactNameCollisions: { name: string; leis: string[] }[] };
  };
  const truthByRef = new Map(truth.records.map((r) => [r.recordRef, r]));

  const { runIngestion } = await import("@/lib/ingestion/service");
  const { runExtraction } = await import("@/lib/extraction/service");
  const { runResolution } = await import("@/lib/resolution/service");
  const { runGraphSynthesis } = await import("@/lib/graph/service");
  const repo = await import("@/lib/db/repository");

  const ingestion = await runIngestion({
    kind: "uploaded",
    contents: manifest,
    filename: corpusPath,
  });
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

  interface Mention {
    recordRef: string;
    subjectKey: string;
    name: string;
    entityId: string | null;
    status: string | null;
    resolutionType: string | null;
  }
  const mentions: Mention[] = [];
  for (const record of records) {
    if (record.recordType !== "entity_mention") continue;
    const kind = record.data.mentionKind;
    if (kind !== "organisation" && kind !== "person") continue;
    const recordRef = record.provenance.location.split("#")[0]!;
    const t = truthByRef.get(recordRef);
    if (!t) continue;
    const assignment = entityByRecordId.get(record.id) ?? null;
    mentions.push({
      recordRef,
      subjectKey: t.subjectKey,
      name: String(record.data.observedValue),
      entityId: assignment?.entityId ?? null,
      status: assignment?.status ?? null,
      resolutionType: assignment?.type ?? null,
    });
  }

  // --- 1. false merges: two distinct LEIs sharing one entity ---
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

  // --- 2. fragmentation: one LEI split across entities ---
  const entitiesBySubject = new Map<string, Set<string>>();
  for (const m of mentions.filter((m) => m.entityId)) {
    if (!entitiesBySubject.has(m.subjectKey)) entitiesBySubject.set(m.subjectKey, new Set());
    entitiesBySubject.get(m.subjectKey)!.add(m.entityId!);
  }
  const fragmented = [...entitiesBySubject.entries()].filter(([, set]) => set.size > 1);

  // --- 3. subject recovery: exactly one entity per real LEI ---
  const recovered = [...entitiesBySubject.entries()].filter(([, set]) => set.size === 1).length;
  const unresolved = mentions.filter((m) => !m.entityId || m.status === "ambiguous");

  // --- 4. alias attachment ---
  const aliasValues = new Set(aliases.map((a) => a.aliasValue));
  const expectedAliases = truth.records.flatMap((r) => r.aliases);
  const aliasAttached = expectedAliases.filter((a) => aliasValues.has(a));

  // --- 5. publisher relation survival into the graph ---
  const expectedRelations = truth.records.flatMap((r) =>
    r.relations.map((rel) => ({ from: r.subjectKey, ...rel })),
  );
  const relationTypes = new Set(relationships.map((r) => r.relationshipType));

  // --- 6. provenance completeness over everything persisted ---
  const { collectProvenanceBearingRows } = await import("@/lib/evaluation/snapshot");
  const provRows = collectProvenanceBearingRows({
    entities,
    aliases,
    locations: [],
    evidenceItems: [],
    extractedRecords: records,
    resolutionDecisions: decisions,
    relationships,
    analyticalSignals: [],
    corroborationFindings: [],
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

  // --- 7. how each mention was resolved ---
  const byType = new Map<string, number>();
  for (const m of mentions) {
    const key = m.resolutionType ?? "(unresolved)";
    byType.set(key, (byType.get(key) ?? 0) + 1);
  }

  const results = {
    source: truth.source,
    license: truth.license,
    retrievalChannel: truth.retrievalChannel,
    rawSha256: truth.rawSha256,
    corpus: corpusPath,
    ranAt: new Date().toISOString(),
    dataClass: "real-collected-public-record",
    counts: {
      evidenceItems: manifest.evidenceItems.length,
      extractedRecords: records.length,
      subjectMentions: mentions.length,
      entities: entities.length,
      aliases: aliases.length,
      relationships: relationships.length,
      graphStatus: graph.status,
      graphCounts: graph.counts,
    },
    metrics: {
      subjectsRecoveredWhole: { n: recovered, d: truth.subjectCount, pct: pct(recovered, truth.subjectCount) },
      falseMergeRate: { n: falseMerges.length, d: membersByEntity.size, pct: pct(falseMerges.length, membersByEntity.size) },
      fragmentationRate: { n: fragmented.length, d: truth.subjectCount, pct: pct(fragmented.length, truth.subjectCount) },
      unresolvedOrAmbiguous: { n: unresolved.length, d: mentions.length, pct: pct(unresolved.length, mentions.length) },
      aliasAttachment: { n: aliasAttached.length, d: expectedAliases.length, pct: pct(aliasAttached.length, expectedAliases.length) },
      provenanceCompleteness: { n: provComplete, d: provRows.length, pct: pct(provComplete, provRows.length) },
    },
    resolutionTypeHistogram: Object.fromEntries(byType),
    publisherRelations: {
      stated: expectedRelations.length,
      relationshipTypesInGraph: [...relationTypes],
    },
    observations: {
      exactNameCollisions: truth.observations.exactNameCollisions,
      falseMerges,
      fragmented: fragmented.map(([subject, set]) => ({ subject, entities: [...set] })),
    },
    notTestableWithThisData: [
      "Cross-source co-reference: only ONE register was collected, so no subject appears in two independently-published records. This is the measurement entity resolution most needs and this pilot cannot supply it.",
      "Within-source co-reference: a register publishes one record per legal entity by construction, so Tier B (exact name match into a Tier A cluster) has almost nothing to act on regardless of its quality.",
      "Name-variation recall: GLEIF states one legal name per entity. Suffix, transliteration, abbreviation and name-order variation of the SAME subject are absent from this data, so the previous synthetic morphology findings remain unvalidated against real records.",
    ],
  };

  const outDir = path.resolve(ROOT, "reports/real-pilot");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "gleif-pilot-results.json"), JSON.stringify(results, null, 2) + "\n");

  console.log(`\nREAL-DATA PILOT — ${truth.source}, licence ${truth.license}, channel ${truth.retrievalChannel}`);
  console.log(`Corpus: ${corpusPath}  (${manifest.evidenceItems.length} real records)\n`);
  console.log(`  evidence items          ${results.counts.evidenceItems}`);
  console.log(`  extracted records       ${results.counts.extractedRecords}`);
  console.log(`  subject mentions        ${results.counts.subjectMentions}`);
  console.log(`  entities created        ${results.counts.entities}`);
  console.log(`  aliases persisted       ${results.counts.aliases}`);
  console.log(`  relationships           ${results.counts.relationships}`);
  console.log(`  graph                   ${results.counts.graphStatus} ${JSON.stringify(results.counts.graphCounts)}\n`);
  for (const [name, m] of Object.entries(results.metrics)) {
    console.log(`  ${name.padEnd(24)}${String(m.pct).padStart(7)}  (${m.n}/${m.d})`);
  }
  console.log("\n  resolution types:");
  for (const [type, n] of byType) console.log(`    ${type.padEnd(30)} ${n}`);
  console.log(`\n  exact name collisions in real data: ${truth.observations.exactNameCollisions.length}`);
  console.log(`  false merges: ${falseMerges.length}   fragmented subjects: ${fragmented.length}`);
  console.log(`\nWrote reports/real-pilot/gleif-pilot-results.json`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
