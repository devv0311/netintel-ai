/**
 * Real-world entity-resolution generalisation experiment.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/generalisation-experiment.ts [--corpus PATH]
 *
 * Question: can the CURRENT NetIntel resolver ingest and reason over
 * public-register entities whose name strings it did not generate?
 *
 * The resolver is NOT modified for this run and must not be. If it were
 * adjusted to cope, the experiment would measure the adjustment.
 *
 * Default input is the synthetic name-morphology fixture
 * (evidence/public-pilot/), because egress to the real registers is
 * blocked by policy in this environment. Point --corpus at a real
 * collected manifest and the same measurements apply unchanged.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = "./data/netintel-generalisation.db";
process.env.DATABASE_URL = DB_PATH;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface TruthRecord {
  recordRef: string;
  subjectKey: string;
  variation: string;
  withIdentifier: boolean;
  name: string;
}

async function main(): Promise<void> {
  const corpusPath = arg("corpus") ?? "evidence/public-pilot/name-morphology.corpus.json";
  const truthPath = arg("truth") ?? "evidence/public-pilot/name-morphology.ground-truth.json";

  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.resolve(ROOT, DB_PATH + suffix), { force: true });
  }
  fs.mkdirSync(path.dirname(path.resolve(ROOT, DB_PATH)), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, corpusPath), "utf8"));
  const truth = (JSON.parse(fs.readFileSync(path.join(ROOT, truthPath), "utf8")) as { records: TruthRecord[] }).records;
  const truthByRef = new Map(truth.map((t) => [t.recordRef, t]));

  const { runIngestion } = await import("@/lib/ingestion/service");
  const { runExtraction } = await import("@/lib/extraction/service");
  const { runResolution } = await import("@/lib/resolution/service");
  const repo = await import("@/lib/db/repository");

  const ingestion = await runIngestion({ kind: "uploaded", contents: manifest, filename: corpusPath });
  if (ingestion.status !== "ingested") {
    console.error("ingestion failed:", JSON.stringify(ingestion.error ?? ingestion.stages.at(-1), null, 2));
    process.exitCode = 1;
    return;
  }
  await runExtraction();
  await runResolution();

  const [records, decisions, entities, aliases] = await Promise.all([
    repo.listExtractedRecords(),
    repo.listResolutionDecisions(),
    repo.listEntities(),
    repo.listAliases(),
  ]);

  // --- align: each subject mention -> its record ref and system cluster ---
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
    name: string;
    subjectKey: string;
    variation: string;
    withIdentifier: boolean;
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
      name: String(record.data.observedValue),
      subjectKey: t.subjectKey,
      variation: t.variation,
      withIdentifier: t.withIdentifier,
      entityId: assignment?.entityId ?? null,
      status: assignment?.status ?? null,
      resolutionType: assignment?.type ?? null,
    });
  }

  // --- the ten requested measures ---
  const total = mentions.length;
  const resolved = mentions.filter((m) => m.entityId !== null);
  const unresolved = mentions.filter((m) => m.entityId === null || m.status === "ambiguous");

  const byType = (t: string) => mentions.filter((m) => m.resolutionType === t).length;
  const identifierMatches = byType("shared_identifier_merge") + byType("canonicalized_identifier");
  const exactNameMatches = byType("exact_name_match");

  // Correctness: a mention is CORRECTLY clustered when every other
  // mention sharing its cluster has the same true subject key.
  const membersByEntity = new Map<string, Mention[]>();
  for (const m of resolved) {
    if (!membersByEntity.has(m.entityId!)) membersByEntity.set(m.entityId!, []);
    membersByEntity.get(m.entityId!)!.push(m);
  }
  const falseMerges: { entityId: string; subjects: string[]; names: string[] }[] = [];
  for (const [entityId, members] of membersByEntity) {
    const subjects = [...new Set(members.map((m) => m.subjectKey))];
    if (subjects.length > 1) {
      falseMerges.push({ entityId, subjects, names: members.map((m) => m.name) });
    }
  }

  // Per-variation outcome: did this variant land in the same cluster as
  // its subject's identifier-anchored variant?
  const anchorEntityBySubject = new Map<string, string>();
  for (const m of resolved) {
    if (m.variation === "identical_with_identifier" && m.entityId) {
      anchorEntityBySubject.set(m.subjectKey, m.entityId);
    }
  }
  const byVariation = new Map<string, { total: number; joinedAnchor: number; failures: string[] }>();
  for (const m of mentions) {
    const bucket = byVariation.get(m.variation) ?? { total: 0, joinedAnchor: 0, failures: [] };
    bucket.total++;
    const anchor = anchorEntityBySubject.get(m.subjectKey);
    if (anchor && m.entityId === anchor) bucket.joinedAnchor++;
    else if (m.variation !== "same_name_different_subject") bucket.failures.push(`${m.subjectKey}: "${m.name}"`);
    byVariation.set(m.variation, bucket);
  }

  // Alias match: aliases persisted against the entity holding the name.
  const aliasValues = new Set(aliases.map((a) => a.aliasValue));
  const expectedAliases = new Set<string>();
  for (const item of manifest.evidenceItems as { content: { aliases?: string[] } }[]) {
    for (const alias of item.content.aliases ?? []) expectedAliases.add(alias);
  }
  const aliasMatched = [...expectedAliases].filter((a) => aliasValues.has(a));

  // Provenance completeness over everything this run persisted.
  const { collectProvenanceBearingRows } = await import("@/lib/evaluation/snapshot");
  const provRows = collectProvenanceBearingRows({
    entities,
    aliases,
    locations: [],
    evidenceItems: [],
    extractedRecords: records,
    resolutionDecisions: decisions,
    relationships: [],
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

  // "Unresolved" in the flagged sense (null or ambiguous) understates the
  // failure badly: a variant that becomes its own isolated entity is not
  // flagged at all, yet the subject is just as fragmented. Both are
  // reported, and the second is the one that matters.
  const nonAnchorVariants = mentions.filter((m) => m.variation !== "identical_with_identifier");
  const unlinkedVariants = nonAnchorVariants.filter((m) => {
    const anchor = anchorEntityBySubject.get(m.subjectKey);
    return !anchor || m.entityId !== anchor;
  });
  const subjectKeys = [...new Set(mentions.map((m) => m.subjectKey))];
  const wholeSubjects = subjectKeys.filter((key) => {
    const clusters = new Set(mentions.filter((m) => m.subjectKey === key).map((m) => m.entityId));
    return clusters.size === 1 && !clusters.has(null);
  });

  const rate = (n: number, d: number) => (d === 0 ? null : n / d);
  const report = {
    meta: {
      corpus: manifest.corpus,
      corpusPath,
      note:
        "Rates are properties of this fixture by construction. How often each variation occurs in GLEIF or Wikidata is an empirical question requiring the real collection, which was blocked by egress policy.",
      subjectMentions: total,
      subjects: new Set(mentions.map((m) => m.subjectKey)).size,
      systemEntities: entities.length,
      generatedAt: new Date().toISOString(),
    },
    measures: {
      identifierMatchRate: { value: rate(identifierMatches, total), numerator: identifierMatches, denominator: total },
      exactNameMatchRate: { value: rate(exactNameMatches, total), numerator: exactNameMatches, denominator: total },
      aliasMatchRate: { value: rate(aliasMatched.length, expectedAliases.size), numerator: aliasMatched.length, denominator: expectedAliases.size },
      unresolvedRate: { value: rate(unresolved.length, total), numerator: unresolved.length, denominator: total },
      unlinkedVariantRate: { value: rate(unlinkedVariants.length, nonAnchorVariants.length), numerator: unlinkedVariants.length, denominator: nonAnchorVariants.length },
      subjectsRecoveredWhole: { value: rate(wholeSubjects.length, subjectKeys.length), numerator: wholeSubjects.length, denominator: subjectKeys.length },
      falseMergeRate: { value: rate(falseMerges.length, membersByEntity.size), numerator: falseMerges.length, denominator: membersByEntity.size },
      provenanceCompleteness: { value: rate(provComplete, provRows.length), numerator: provComplete, denominator: provRows.length },
    },
    tierComparison: {
      tierA_identifier: identifierMatches,
      tierB_exactName: exactNameMatches,
      newEntity: byType("new_entity"),
      ambiguous: mentions.filter((m) => m.status === "ambiguous").length,
    },
    byVariation: Object.fromEntries(
      [...byVariation].map(([k, v]) => [
        k,
        { total: v.total, joinedSubjectCluster: v.joinedAnchor, failed: v.total - v.joinedAnchor, examples: v.failures.slice(0, 6) },
      ]),
    ),
    falseMerges,
    clusters: [...membersByEntity].map(([entityId, members]) => ({
      entityId,
      subjects: [...new Set(members.map((m) => m.subjectKey))],
      names: members.map((m) => m.name),
    })),
  };

  const outDir = path.join(ROOT, "reports", "generalisation");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "generalisation-results.json"), JSON.stringify(report, null, 2) + "\n");

  console.log(`\nSubjects ${report.meta.subjects} · mentions ${total} · system entities ${entities.length}\n`);
  console.log("MEASURES");
  for (const [name, m] of Object.entries(report.measures)) {
    const v = m.value === null ? "—" : `${(m.value * 100).toFixed(1)}%`;
    console.log(`  ${name.padEnd(24)} ${v.padStart(7)}   (${m.numerator}/${m.denominator})`);
  }
  console.log("\nTIER A vs TIER B");
  for (const [k, v] of Object.entries(report.tierComparison)) console.log(`  ${k.padEnd(24)} ${v}`);
  console.log("\nBY VARIATION CLASS  (joined its subject's identifier-anchored cluster)");
  for (const [k, v] of Object.entries(report.byVariation)) {
    console.log(`  ${k.padEnd(30)} ${v.joinedSubjectCluster}/${v.total}  failed ${v.failed}`);
    for (const ex of v.examples) console.log(`      ${ex}`);
  }
  console.log(`\nFalse merges: ${falseMerges.length}`);
  for (const fm of falseMerges) console.log(`  ${fm.subjects.join(" + ")} → ${JSON.stringify(fm.names)}`);
  console.log(`\nWrote reports/generalisation/generalisation-results.json`);

  const { closeAllDbConnections } = await import("@/lib/db/client");
  closeAllDbConnections();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
