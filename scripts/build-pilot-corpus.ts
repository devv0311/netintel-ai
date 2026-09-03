/**
 * Turns a collected public-record manifest into a corpus manifest the
 * existing ingestion path accepts.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-pilot-corpus.ts \
 *     --from data/public/raw/SRC-002/<retrievedAt> \
 *     --out evidence/public-pilot/gleif-in-pilot
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
  relations?: { predicate: string; targetRegistryRecordId: string }[];
  jurisdiction?: string;
  status?: string;
}

function main(): void {
  const from = arg("from");
  const out = arg("out") ?? "evidence/public-pilot/gleif-in-pilot";
  if (!from) {
    console.error("usage: --from <collected manifest dir> [--out <basename>]");
    process.exitCode = 1;
    return;
  }

  const dir = path.resolve(ROOT, from);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  const records = JSON.parse(
    fs.readFileSync(path.join(dir, "public-records.json"), "utf8"),
  ) as PublicRecord[];

  const corpus = {
    corpus: {
      name: "gleif-in-pilot",
      version: "1.0.0",
      seed: null,
      generatedAt: manifest.retrievedAt,
      description:
        `REAL collected public-register records — GLEIF LEI (${manifest.sourceId}), ` +
        `licence ${manifest.license}. Retrieval channel: ${manifest.retrievalChannel}. ` +
        `Built from ${path.relative(ROOT, dir)} (rawSha256 ${manifest.rawSha256}). ` +
        `NOT synthetic, and never to be mixed with the Operation DarkNet Delhi evaluation corpus.`,
    },
    investigation: {
      name: "GLEIF real-data pilot",
      status: "in_progress",
    },
    evidenceSources: [
      {
        key: "gleif",
        label: `GLEIF LEI records (real, ${manifest.license})`,
        sourceType: "structured_dataset",
      },
    ],
    evidenceItems: records.map((record) => ({
      sourceKey: "gleif",
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
  for (const record of records) {
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
    builtFrom: path.relative(ROOT, dir),
    rawSha256: manifest.rawSha256,
    basis:
      "One LEI denotes exactly one legal entity (ISO 17442). Records with distinct LEIs are " +
      "distinct subjects; no record in this set is a second observation of another subject.",
    subjectCount: records.length,
    records: records.map((record) => ({
      recordRef: record.recordRef,
      subjectKey: record.registryRecordId,
      name: record.name,
      subjectKind: record.subjectKind,
      jurisdiction: record.jurisdiction ?? null,
      status: record.status ?? null,
      aliases: record.aliases ?? [],
      relations: record.relations ?? [],
    })),
    observations: {
      exactNameCollisions,
      recordsWithAliases: records.filter((r) => (r.aliases ?? []).length > 0).length,
      recordsWithRelations: records.filter((r) => (r.relations ?? []).length > 0).length,
    },
  };

  fs.mkdirSync(path.resolve(ROOT, path.dirname(out)), { recursive: true });
  fs.writeFileSync(path.resolve(ROOT, `${out}.corpus.json`), JSON.stringify(corpus, null, 2) + "\n");
  fs.writeFileSync(path.resolve(ROOT, `${out}.ground-truth.json`), JSON.stringify(truth, null, 2) + "\n");
  console.log(`Wrote ${out}.corpus.json (${corpus.evidenceItems.length} items)`);
  console.log(`Wrote ${out}.ground-truth.json (${truth.subjectCount} subjects)`);
  console.log(`  exact name collisions: ${exactNameCollisions.length}`);
  console.log(`  records with aliases:  ${truth.observations.recordsWithAliases}`);
  console.log(`  records with relations:${truth.observations.recordsWithRelations}`);
}

main();
