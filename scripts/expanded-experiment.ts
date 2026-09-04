/**
 * P6.19.3 — the SHIPPED deterministic resolver, measured on the expanded
 * three-source real corpus.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/expanded-experiment.ts
 *
 * The resolver is NOT modified. `src/lib/resolution/` is byte-identical
 * to P6.18, so this measures a harder, more diverse corpus against the
 * same system rather than a new system against the same corpus.
 *
 * Full pipeline: ingestion -> extraction -> resolution -> graph, in its
 * own database, never mixed with Operation DarkNet Delhi, the synthetic
 * fixtures, or the P6.16 no-identifier corpus.
 *
 * FORMER-NAME PAIRS ARE NOT SCORED HERE. They are one authority's
 * temporal claim, not two publishers agreeing, and the superseded name is
 * carried as an alias rather than as a record of its own — so there is no
 * second mention to join to. Counting them as cross-source joins would
 * inflate the headline number with a different kind of evidence. They are
 * reported separately, as what they are: training material for a class
 * the resolver currently cannot address at all.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 ? process.argv[i + 1] : undefined; };
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${((n / d) * 100).toFixed(1)}%`);

interface Truth {
  counts: Record<string, number>;
  split: Record<string, string>;
  positives: { pairId: string; basis: string; sourcePairing: string; corroboration: string[]; variation: string;
    a: { recordRef: string; registry: string; name: string }; b: { recordRef: string; registry: string; name: string }; subject: string }[];
  formerNamePairs: { pairId: string; variation: string; a: { name: string }; b: { name: string }; subject: string }[];
  hardNegatives: { pairId: string; basis: string; sourcePairing: string;
    a: { recordRef: string; registry: string; name: string; id: string }; b: { recordRef: string; registry: string; name: string; id: string } }[];
  undetermined: { recordRef: string; name: string }[];
  surrogateMap: Record<string, { registry: string; registryRecordId: string; recordRef: string; name: string;
    officialName: string | null; leis: string[]; ciks: string[]; ocids: string[] }>;
}

async function main(): Promise<void> {
  const BASE = "evidence/expanded";
  const corpusPath = `${BASE}/expanded-anchored.corpus.json`;
  const truthPath = `${BASE}/expanded.ground-truth.json`;
  const DB_PATH = arg("db") ?? "./data/netintel-expanded.db";
  process.env.DATABASE_URL = DB_PATH;
  for (const s of ["", "-wal", "-shm"]) fs.rmSync(path.resolve(ROOT, DB_PATH + s), { force: true });
  fs.mkdirSync(path.dirname(path.resolve(ROOT, DB_PATH)), { recursive: true });

  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, corpusPath), "utf8"));
  const truth = JSON.parse(fs.readFileSync(path.join(ROOT, truthPath), "utf8")) as Truth;

  /* corpus id -> surrogate -> ground-truth subject */
  const surBy = new Map<string, string>(); const subjectOf = new Map<string, string>();
  for (const [sur, r] of Object.entries(truth.surrogateMap)) {
    surBy.set(`${r.registry}:${sur}`, sur);
    surBy.set(`${r.registry}:${r.registryRecordId}`, sur);
    const subj = r.leis.length === 1 ? `LEI:${r.leis[0]}` : r.leis.length > 1 ? `UNDETERMINED:${sur}`
      : r.ciks.length === 1 ? `CIK:${r.ciks[0]}` : `SOLO:${sur}`;
    subjectOf.set(sur, subj);
  }
  const surByRecordRef = new Map<string, string>();
  for (const [sur, r] of Object.entries(truth.surrogateMap)) surByRecordRef.set(r.recordRef, sur);

  const { runIngestion } = await import("@/lib/ingestion/service");
  const { runExtraction } = await import("@/lib/extraction/service");
  const { runResolution } = await import("@/lib/resolution/service");
  const { runGraphSynthesis } = await import("@/lib/graph/service");
  const repo = await import("@/lib/db/repository");

  const ingestion = await runIngestion({ kind: "uploaded", contents: manifest, filename: corpusPath });
  if (ingestion.status !== "ingested") {
    console.error("ingestion failed:", JSON.stringify(ingestion.error ?? ingestion.stages.at(-1), null, 2));
    process.exitCode = 1; return;
  }
  await runExtraction();
  const resolution = await runResolution();
  const graph = await runGraphSynthesis();

  const [records, decisions, entities, aliases, relationships] = await Promise.all([
    repo.listExtractedRecords(), repo.listResolutionDecisions(), repo.listEntities(), repo.listAliases(), repo.listRelationships(),
  ]);

  const decByRecord = new Map<string, { entityId: string; status: string; type: string }>();
  for (const d of decisions) for (const rid of d.extractedRecordIds)
    decByRecord.set(rid, { entityId: d.canonicalEntityId, status: d.status, type: d.resolutionType });

  interface M { sur: string; registry: string; subject: string; name: string; entityId: string | null; status: string | null; type: string | null }
  const mentions: M[] = [];
  for (const rec of records) {
    if (rec.recordType !== "entity_mention") continue;
    const kind = rec.data.mentionKind;
    if (kind !== "organisation" && kind !== "person") continue;
    const ref = rec.provenance.location.split("#")[0]!;
    const sur = surBy.get(ref); if (!sur) continue;
    const d = decByRecord.get(rec.id) ?? null;
    mentions.push({ sur, registry: truth.surrogateMap[sur]!.registry, subject: subjectOf.get(sur)!,
      name: String(rec.data.observedValue), entityId: d?.entityId ?? null, status: d?.status ?? null, type: d?.type ?? null });
  }
  const bySur = new Map(mentions.map((m) => [m.sur, m]));

  /* ---------------- positives ---------------- */
  const posResults = truth.positives.flatMap((p) => {
    const a = bySur.get(surByRecordRef.get(p.a.recordRef) ?? ""), b = bySur.get(surByRecordRef.get(p.b.recordRef) ?? "");
    if (!a || !b) return [];
    return [{ ...p, joined: a.entityId !== null && a.entityId === b.entityId,
      aType: a.type, bType: b.type, aStatus: a.status, bStatus: b.status,
      split: truth.split[p.subject] ?? "unassigned" }];
  });
  const joined = posResults.filter((p) => p.joined);

  const group = <T>(rows: T[], k: (r: T) => string) => {
    const m: Record<string, { n: number; d: number }> = {};
    for (const r of rows) { const g = k(r); m[g] ??= { n: 0, d: 0 }; m[g]!.d++; }
    return m;
  };
  const rate = (rows: typeof posResults, k: (r: typeof posResults[number]) => string) => {
    const m = group(rows, k);
    for (const r of rows) if (r.joined) m[k(r)]!.n++;
    return Object.fromEntries(Object.entries(m).map(([g, v]) => [g, { n: v.n, d: v.d, pct: pct(v.n, v.d) }]));
  };

  /* ---------------- hard negatives ---------------- */
  const negResults = truth.hardNegatives.flatMap((n) => {
    const a = bySur.get(surByRecordRef.get(n.a.recordRef) ?? ""), b = bySur.get(surByRecordRef.get(n.b.recordRef) ?? "");
    if (!a || !b) return [];
    return [{ ...n, falselyMerged: a.entityId !== null && a.entityId === b.entityId }];
  });
  const negMerged = negResults.filter((n) => n.falselyMerged);

  /* ---------------- corpus-wide integrity ---------------- */
  const membersByEntity = new Map<string, M[]>();
  for (const m of mentions) { if (!m.entityId) continue; membersByEntity.set(m.entityId, [...(membersByEntity.get(m.entityId) ?? []), m]); }
  /**
   * An entity is a FALSE MERGE only when it contains two subjects that are
   * COMPARABLE and different — two distinct LEIs, or two distinct CIKs.
   *
   * Counting "more than one subject key" would punish the resolver for
   * being right: EDGAR publishes no LEI and GLEIF publishes no CIK, so the
   * GLEIF and the EDGAR record for one company carry subject keys from
   * different schemes and can never be shown equal. Merging them is
   * correct and unprovable at the same time, and calling it a false merge
   * would be asserting a difference the evidence does not support.
   */
  const comparableConflict = (subjects: string[]) => {
    for (const scheme of ["LEI:", "CIK:"]) {
      if (new Set(subjects.filter((s) => s.startsWith(scheme))).size > 1) return true;
    }
    return false;
  };
  const falseMerges = [...membersByEntity.entries()]
    .filter(([, ms]) => comparableConflict(ms.filter((m) => !m.subject.startsWith("UNDETERMINED")).map((m) => m.subject)))
    .map(([id, ms]) => ({ entityId: id, subjects: [...new Set(ms.map((m) => m.subject))], names: [...new Set(ms.map((m) => m.name))] }));
  const crossSchemeMergesUnprovable = [...membersByEntity.entries()]
    .filter(([, ms]) => {
      const s = [...new Set(ms.map((m) => m.subject))];
      return s.length > 1 && !comparableConflict(s);
    }).length;

  const bySubject = new Map<string, M[]>();
  for (const m of mentions) bySubject.set(m.subject, [...(bySubject.get(m.subject) ?? []), m]);
  const multi = [...bySubject.entries()].filter(([s, ms]) => ms.length > 1 && !s.startsWith("UNDETERMINED"));
  const fragmented = multi.filter(([, ms]) => new Set(ms.map((m) => m.entityId)).size > 1);

  const unresolved = mentions.filter((m) => !m.entityId || m.status === "ambiguous");
  const selfUnresolved = mentions.filter((m) => m.status === "unresolved");

  const typeHist: Record<string, number> = {};
  for (const d of decisions) typeHist[d.resolutionType] = (typeHist[d.resolutionType] ?? 0) + 1;
  const statusHist: Record<string, number> = {};
  for (const d of decisions) statusHist[d.status] = (statusHist[d.status] ?? 0) + 1;

  const { collectProvenanceBearingRows } = await import("@/lib/evaluation/snapshot");
  const provRows = collectProvenanceBearingRows({ entities, aliases, locations: [], evidenceItems: [],
    extractedRecords: records, resolutionDecisions: decisions, relationships, analyticalSignals: [], corroborationFindings: [] });
  const provComplete = provRows.filter((r) => {
    const p = r.provenance as unknown as Record<string, unknown>;
    return typeof p.source === "string" && p.source.length > 0 && typeof p.location === "string" && p.location.length > 0
      && typeof p.method === "string" && p.method.length > 0 && typeof p.confidence === "number"
      && Array.isArray(p.processingHistory) && p.processingHistory.length > 0
      && typeof p.timestamp === "string" && !Number.isNaN(Date.parse(p.timestamp));
  }).length;

  /* leak check: no masked identifier may reach extraction */
  const maskedIds: string[] = [];
  for (const [, r] of Object.entries(truth.surrogateMap)) if (r.registry !== "gleif") maskedIds.push(...r.leis, ...r.ciks);
  const blob = JSON.stringify(records.filter((rec) => {
    const ref = rec.provenance.location.split("#")[0]!; const sur = surBy.get(ref);
    return sur ? truth.surrogateMap[sur]!.registry !== "gleif" : false;
  }));
  const leaked = [...new Set(maskedIds)].filter((id) => id.length > 6 && blob.includes(id));

  const out = {
    experiment: "P6.19.3 expanded three-source real corpus, shipped resolver",
    dataClass: "REAL - GLEIF SRC-002 + Wikidata SRC-001 + SEC EDGAR SRC-006",
    regime: "anchored (GLEIF keeps the LEI it issues; Wikidata and EDGAR stripped)",
    resolverPolicy: "UNMODIFIED - src/lib/resolution is byte-identical to P6.18",
    corpus: corpusPath, groundTruth: truthPath, database: DB_PATH, ranAt: new Date().toISOString(),
    isolation: "own corpus, own ground truth, own database; never mixed with DarkNet Delhi, synthetic fixtures, or the P6.16 no-identifier corpus",
    leakCheck: { maskedIdentifiersSearchedFor: [...new Set(maskedIds)].length, occurrences: leaked.length,
      verdict: leaked.length === 0 ? "CLEAN" : "VOID", leaked },
    counts: { records: manifest.evidenceItems.length, mentions: mentions.length, entities: entities.length,
      aliases: aliases.length, relationships: relationships.length, graphCounts: graph.counts,
      positivePairs: posResults.length, hardNegativePairs: negResults.length,
      formerNamePairsNotScored: truth.formerNamePairs.length, undetermined: truth.undetermined.length,
      resolutionWarnings: resolution.warnings?.length ?? 0 },
    metrics: {
      positivePairJoinRate: { n: joined.length, d: posResults.length, pct: pct(joined.length, posResults.length) },
      falseMergeRate: { n: falseMerges.length, d: membersByEntity.size, pct: pct(falseMerges.length, membersByEntity.size) },
      hardNegativeFalseMergeRate: { n: negMerged.length, d: negResults.length, pct: pct(negMerged.length, negResults.length) },
      unresolvedRate: { n: unresolved.length, d: mentions.length, pct: pct(unresolved.length, mentions.length) },
      selfReportedUnresolvedRate: { n: selfUnresolved.length, d: mentions.length, pct: pct(selfUnresolved.length, mentions.length) },
      fragmentationRate: { n: fragmented.length, d: multi.length, pct: pct(fragmented.length, multi.length) },
      provenanceCompleteness: { n: provComplete, d: provRows.length, pct: pct(provComplete, provRows.length) },
      crossSchemeMergesUnprovable: { n: crossSchemeMergesUnprovable, d: membersByEntity.size,
        pct: pct(crossSchemeMergesUnprovable, membersByEntity.size),
        note: "entities joining records that share no identifier scheme (GLEIF x EDGAR). Neither confirmable nor refutable from identifiers; reported, never scored as an error." },
    },
    joinRateBy: {
      basis: rate(posResults, (p) => p.basis),
      sourcePairing: rate(posResults, (p) => p.sourcePairing),
      nameVariation: rate(posResults, (p) => p.variation),
      split: rate(posResults, (p) => p.split),
      ocidCorroborated: rate(posResults, (p) => (p.corroboration.length ? "ocid_agrees" : "no_corroboration")),
    },
    resolutionTypeHistogram: typeHist,
    resolutionStatusHistogram: statusHist,
    hardNegativesFalselyMerged: negMerged,
    corpusWideFalseMerges: falseMerges,
    unjoinedPositives: posResults.filter((p) => !p.joined).map((p) => ({
      pairId: p.pairId, basis: p.basis, sourcePairing: p.sourcePairing, variation: p.variation,
      a: p.a.name, b: p.b.name, split: p.split })),
    formerNamePairs: { note: "ONE authority's temporal claim, not two publishers agreeing. Carried as aliases, so there is no second mention to join to. Not scored; reported as available training material.",
      total: truth.formerNamePairs.length,
      byVariation: Object.entries(truth.formerNamePairs.reduce<Record<string, number>>((a, p) => { a[p.variation] = (a[p.variation] ?? 0) + 1; return a; }, {})) },
  };

  fs.mkdirSync(path.join(ROOT, "reports/expanded"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "reports/expanded/expanded-anchored-results.json"), `${JSON.stringify(out, null, 2)}\n`);

  console.log("=".repeat(74));
  console.log("P6.19.3  EXPANDED CORPUS - SHIPPED RESOLVER, UNMODIFIED");
  console.log("=".repeat(74));
  console.log(`records ${out.counts.records}  mentions ${out.counts.mentions}  entities ${out.counts.entities}  leak: ${out.leakCheck.verdict}`);
  console.log("\nMETRICS");
  for (const [k, v] of Object.entries(out.metrics)) console.log(`  ${k.padEnd(30)} ${v.pct.padStart(7)}  (${v.n}/${v.d})`);
  console.log("\nJOIN RATE BY BASIS");
  for (const [k, v] of Object.entries(out.joinRateBy.basis)) console.log(`  ${k.padEnd(30)} ${v.pct.padStart(7)}  (${v.n}/${v.d})`);
  console.log("JOIN RATE BY SOURCE PAIRING");
  for (const [k, v] of Object.entries(out.joinRateBy.sourcePairing)) console.log(`  ${k.padEnd(30)} ${v.pct.padStart(7)}  (${v.n}/${v.d})`);
  console.log("JOIN RATE BY NAME VARIATION");
  for (const [k, v] of Object.entries(out.joinRateBy.nameVariation)) console.log(`  ${k.padEnd(30)} ${v.pct.padStart(7)}  (${v.n}/${v.d})`);
  console.log("JOIN RATE BY SPLIT (must be similar, or the split is biased)");
  for (const [k, v] of Object.entries(out.joinRateBy.split)) console.log(`  ${k.padEnd(30)} ${v.pct.padStart(7)}  (${v.n}/${v.d})`);
  console.log("\nRESOLUTION TYPES");
  for (const [k, v] of Object.entries(typeHist)) console.log(`  ${k.padEnd(34)} ${v}`);
  console.log("\nwritten: reports/expanded/expanded-anchored-results.json");
}
main();
