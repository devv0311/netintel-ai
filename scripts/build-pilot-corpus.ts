/**
 * Turns a collected public-record manifest into a corpus manifest the
 * existing ingestion path accepts.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-pilot-corpus.ts \
 *     --from data/public/raw/SRC-002/<retrievedAt> \
 *     --out evidence/public-pilot/gleif-in-pilot
 *
 * --from accepts a comma-separated list of collected manifests. With more
 * than one, the result is a CROSS-SOURCE corpus: records from different
 * publishers that state the same identifier are the same subject, and the
 * ground truth keys subjects by that shared identifier rather than by one
 * publisher's record id. The identifier is the publishers' own claim, not
 * an inference of ours — which is what makes it usable as ground truth for
 * measuring a resolver that has to rediscover it.
 *
 * This is a transformation step, not a collection step: it opens no
 * socket and invents no field. Every value it writes came from the
 * collected records, and the corpus records the manifest it was built
 * from so a reader can walk back to the raw payloads and their hashes.
 *
 * It also writes a ground-truth document. The only claim that document
 * makes is GLEIF's own: one LEI denotes one legal entity, so two records
 * with different LEIs are different subjects. Nothing about name
 * similarity is asserted as truth — that is what the pilot measures.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

interface PublicRecord {
  recordRef: string;
  registry: string;
  registryRecordId: string;
  subjectKind: string;
  name: string;
  aliases?: string[];
  identifiers?: { scheme: string; value: string }[];
  relations?: { predicate: string; targetRegistryRecordId: string }[];
  jurisdiction?: string;
  status?: string;
}

function main(): void {
  const from = arg("from");
  const out = arg("out") ?? "evidence/public-pilot/gleif-in-pilot";
  if (!from) {
    console.error("usage: --from <collected manifest dir>[,<dir>...] [--out <basename>]");
    process.exitCode = 1;
    return;
  }

  const dirs = from.split(",").map((d) => path.resolve(ROOT, d.trim())).filter(Boolean);
  const manifests = dirs.map((dir) =>
    JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8")),
  );
  const records: PublicRecord[] = dirs.flatMap((dir) =>
    JSON.parse(fs.readFileSync(path.join(dir, "public-records.json"), "utf8")) as PublicRecord[],
  );
  const manifest = manifests[0]!;
  const crossSource = dirs.length > 1;

  // Subject key: the shared identifier where two publishers state one, the
  // publisher's own record id otherwise. Deduplicate identical records —
  // the Wikidata SPARQL cross-product emits a row per (item, LEI, label)
  // combination, so one item legitimately arrives several times.
  const identifierOf = (record: PublicRecord): string | null => {
    const lei = (record.identifiers ?? []).find((i: { scheme: string }) => i.scheme === "LEI");
    return lei ? `LEI:${lei.value}` : null;
  };
  const seen = new Set<string>();
  const deduped = records.filter((record) => {
    const key = `${record.registry}|${record.registryRecordId}|${record.name}|${identifierOf(record) ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const droppedDuplicates = records.length - deduped.length;

  const corpus = {
    corpus: {
      name: "gleif-in-pilot",
      version: "1.0.0",
      seed: null,
      generatedAt: manifest.retrievedAt,
      description:
        `REAL collected public-register records — GLEIF LEI (${manifest.sourceId}), ` +
        `licence ${manifest.license}. Retrieval channel: ${manifest.retrievalChannel}. ` +
        `Built from ${dirs.map((d) => path.relative(ROOT, d)).join(", ")}. ` +
        `NOT synthetic, and never to be mixed with the Operation DarkNet Delhi evaluation corpus.`,
    },
    investigation: {
      name: "GLEIF real-data pilot",
      status: "in_progress",
    },
    evidenceSources: [...new Set(deduped.map((r) => r.registry))].map((registry) => ({
      key: registry,
      label: `${registry} public records (real, ${manifest.license})`,
      sourceType: "structured_dataset",
    })),
    evidenceItems: deduped.map((record) => ({
      sourceKey: record.registry,
      ref: record.recordRef,
      itemType: "public_record",
      content: record,
    })),
    locations: [],
    communicationEvents: [],
    financialTransactions: [],
  };

  // Ground truth: one LEI = one legal entity, per GLEIF's own definition
  // (ISO 17442). That is the whole of it. Name-similarity groups are
  // recorded as OBSERVATIONS for the report, never as expected merges.
  const byName = new Map<string, string[]>();
  for (const record of deduped) {
    const key = record.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) ?? []), record.registryRecordId]);
  }
  const exactNameCollisions = [...byName.entries()]
    .filter(([, leis]) => leis.length > 1)
    .map(([name, leis]) => ({ name, leis }));

  const truth = {
    source: manifest.sourceId,
    license: manifest.license,
    licenseUrl: manifest.licenseUrl,
    retrievedAt: manifest.retrievedAt,
    retrievalChannel: manifest.retrievalChannel,
    builtFrom: dirs.map((d) => path.relative(ROOT, d)),
    rawSha256: manifest.rawSha256,
    basis: crossSource
      ? "One LEI denotes exactly one legal entity (ISO 17442). Two records from DIFFERENT publishers " +
        "that state the same LEI are two observations of one subject — asserted by both publishers, " +
        "not inferred by us. That is what the resolver has to rediscover from names and identifiers."
      : "One LEI denotes exactly one legal entity (ISO 17442). Records with distinct LEIs are " +
        "distinct subjects; no record in this set is a second observation of another subject.",
    crossSource,
    sources: manifests.map((m) => ({
      sourceId: m.sourceId, license: m.license, licenseUrl: m.licenseUrl,
      retrievedAt: m.retrievedAt, retrievalChannel: m.retrievalChannel, rawSha256: m.rawSha256,
    })),
    subjectCount: new Set(deduped.map((r) => identifierOf(r) ?? `${r.registry}:${r.registryRecordId}`)).size,
    recordCount: deduped.length,
    records: deduped.map((record) => ({
      recordRef: record.recordRef,
      registry: record.registry,
      subjectKey: identifierOf(record) ?? `${record.registry}:${record.registryRecordId}`,
      name: record.name,
      subjectKind: record.subjectKind,
      jurisdiction: record.jurisdiction ?? null,
      status: record.status ?? null,
      aliases: record.aliases ?? [],
      relations: record.relations ?? [],
    })),
    observations: {
      exactNameCollisions,
      recordsWithAliases: deduped.filter((r) => (r.aliases ?? []).length > 0).length,
      recordsWithRelations: deduped.filter((r) => (r.relations ?? []).length > 0).length,
      droppedDuplicateRows: droppedDuplicates,
    },
  };

  fs.mkdirSync(path.resolve(ROOT, path.dirname(out)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, `${out}.corpus.json`), JSON.stringify(corpus, null, 2) + "\n");
  fs.writeFileSync(path.resolve(ROOT, `${out}.ground-truth.json`), JSON.stringify(truth, null, 2) + "\n");
  console.log(`Wrote ${out}.corpus.json (${corpus.evidenceItems.length} items)`);
  console.log(`Wrote ${out}.ground-truth.json (${truth.subjectCount} subjects, ${deduped.length} records)`);
  if (droppedDuplicates > 0) console.log(`  dropped duplicate rows:  ${droppedDuplicates}`);
  if (crossSource) console.log(`  cross-source: ${[...new Set(deduped.map((r) => r.registry))].join(" x ")}`);
  console.log(`  exact name collisions: ${exactNameCollisions.length}`);
  console.log(`  records with aliases:  ${truth.observations.recordsWithAliases}`);
  console.log(`  records with relations:${truth.observations.recordsWithRelations}`);
}

main();
