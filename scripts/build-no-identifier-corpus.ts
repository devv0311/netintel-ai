/**
 * Builds the REAL NO-IDENTIFIER corpus (P6.16.1) from already-collected
 * public-register payloads.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/build-no-identifier-corpus.ts \
 *     --wikidata data/public/raw/SRC-001/<retrievedAt> \
 *     --gleif    data/public/raw/SRC-002/<retrievedAt>[,<retrievedAt>] \
 *     --out      evidence/no-identifier/no-identifier-pilot
 *
 * WHAT THIS EXPERIMENT ASKS
 *
 * Every cross-source join NetIntel has ever made on real data was made on
 * a shared LEI. Tier B — exact name match — has fired zero times on real
 * data across P6.6, P6.9 and P6.14, so the four name-variation hypotheses
 * (suffix, transliteration, abbreviation, name order) have never actually
 * been tested. They were not refuted; they were never reached, because
 * Tier A resolved every pair first and Tier A never reads a name.
 *
 * This corpus removes the identifier so the name is the only evidence
 * left, and measures what the CURRENT, UNMODIFIED resolver does with it.
 * It is a measurement, not a fix: nothing in src/lib/resolution is
 * changed by this milestone.
 *
 * GROUND TRUTH, AND WHY IT IS DEFENSIBLE
 *
 * The truth is the LEI that GLEIF and Wikidata state INDEPENDENTLY of one
 * another. An LEI denotes exactly one legal entity (ISO 17442), so:
 *   - two records from different publishers stating the same LEI are two
 *     observations of ONE subject   -> a POSITIVE pair;
 *   - two records stating DIFFERENT LEIs are different legal entities,
 *     however similar their names   -> a NEGATIVE pair.
 * Neither claim is ours and neither is inferred from a name. Nothing
 * about name similarity is ever asserted as truth — that is the thing
 * being measured.
 *
 * MASKING — REAL, NOT SIMULATED
 *
 * The identifier is removed from the CORPUS, not hidden behind a flag in
 * the resolver, so there is no code path by which the resolver could read
 * it. Two regimes are built, because they answer different questions:
 *
 *   FULL     — no record on either side carries any identifier. Tier A
 *              has nothing to anchor, so this measures the system with
 *              identifiers absent entirely.
 *   ANCHORED — GLEIF keeps the LEI it ISSUES (it is the authority for the
 *              scheme; this is the reference set an investigator would
 *              actually hold), and every Wikidata record is stripped of
 *              every identifier. The SHARED identifier is therefore
 *              unavailable: a Wikidata record can only reach its GLEIF
 *              subject through its name. This is the regime in which
 *              Tier B can fire at all.
 *
 * What is withheld from the resolver in a masked record, and why:
 *   identifiers[]      — the join key itself.
 *   registryRecordId   — GLEIF's record id IS the LEI, and Wikidata's is
 *                        the QID; both are replaced by an opaque
 *                        surrogate (NIDP-####).
 *   recordRef          — derived from registryRecordId, so surrogated too.
 *                        It is what lands in provenance.location.
 *   sourceUrl          — the per-record URL embeds the LEI/QID; reduced to
 *                        the endpoint the record genuinely came from.
 *
 * What is NOT altered, ever: `name` and `aliases` are verbatim publisher
 * strings. No variant is manufactured. Every difference this experiment
 * measures is a difference two real publishers actually published.
 *
 * The surrogate -> real mapping lives ONLY in the ground-truth file, which
 * the pipeline never reads.
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
  observedAt?: string;
  retrievedAt: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

// --- name normalisation, used ONLY to SELECT hard negatives and to
// --- categorise observed differences. It is never used to resolve
// --- anything and never enters the corpus.

const LEGAL_SUFFIXES = [
  "private limited", "public limited", "limited", "ltd", "plc", "llp", "llc",
  "incorporated", "inc", "corporation", "corp", "company", "co",
  "lp", "pvt", "gmbh", "ag", "sa", "nv", "bv",
];
const STOPWORDS = new Set([
  ...LEGAL_SUFFIXES.flatMap((s) => s.split(" ")), "and", "of", "the",
]);

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
      if (out.endsWith(` ${suffix}`)) {
        out = out.slice(0, -(suffix.length + 1)).trim();
        changed = true;
      }
    }
  }
  return out;
}
const coreTokens = (s: string) => expandAmp(s).split(" ").filter((t) => t && !STOPWORDS.has(t));

/** Why a negative pair is HARD, stated as the rule that selected it. */
type NegativeBasis =
  | "normalised_name_collision"
  | "legal_suffix_only"
  | "token_subset"
  | "shared_leading_token"
  | "conflated_by_third_party";

/**
 * P6.17.3 - the Devanagari-primary-name view.
 *
 * Wikidata's data model gives each item ONE label per language plus
 * separate aliases (skos:altLabel). The Hindi label is therefore
 * Wikidata's PRIMARY name for that item in Hindi, not an alias
 * (https://www.wikidata.org/wiki/Help:Label - "the label is the most
 * common name that the item would be known by"). Our own adapter folds
 * `itemLabelHi` into this schema's single `aliases[]` field because
 * PublicRecordContent has one `name`; that is a modelling artefact of
 * OUR adapter, not the publisher's classification.
 *
 * So building a record whose `name` is the Hindi label is NOT promoting
 * an alias into a primary name. It is presenting the publisher's own
 * primary Hindi label as what it is, and it is the only way to test the
 * transliteration hypothesis on primary names rather than on one
 * incidental Japanese pair.
 *
 * The English label is dropped from these records entirely. Carrying it
 * would hand the resolver the Latin string whose absence is the whole
 * point of the experiment.
 */
function hindiLabelsByQid(dir: string): Map<string, string> {
  const rawPath = path.resolve(ROOT, dir, "raw", "sparql-results.json");
  const out = new Map<string, string>();
  if (!fs.existsSync(rawPath)) return out;
  const payload = JSON.parse(fs.readFileSync(rawPath, "utf8")) as {
    results: { bindings: Record<string, { value: string }>[] };
  };
  for (const row of payload.results.bindings) {
    const hi = row.itemLabelHi?.value;
    const item = row.item?.value;
    if (!hi || !item) continue;
    out.set(item.slice(item.lastIndexOf("/") + 1), hi);
  }
  return out;
}

function main(): void {
  const wikidataDir = arg("wikidata");
  /** "hi" selects the Devanagari-primary view. Omitted = the Latin view. */
  const primaryLabel = arg("wikidata-primary-label");
  const gleifDirs = (arg("gleif") ?? "").split(",").map((d) => d.trim()).filter(Boolean);
  const out = arg("out") ?? "evidence/no-identifier/no-identifier-pilot";
  if (!wikidataDir || gleifDirs.length === 0) {
    console.error("usage: --wikidata <dir> --gleif <dir>[,<dir>] [--out <basename>]");
    process.exitCode = 1;
    return;
  }

  const readDir = (dir: string) => ({
    manifest: JSON.parse(fs.readFileSync(path.resolve(ROOT, dir, "manifest.json"), "utf8")),
    records: JSON.parse(
      fs.readFileSync(path.resolve(ROOT, dir, "public-records.json"), "utf8"),
    ) as PublicRecord[],
    dir,
  });

  const wd = readDir(wikidataDir);
  const gd = gleifDirs.map(readDir);

  // GLEIF records are keyed by LEI, so a record appearing in more than one
  // collected batch is one record, not two.
  const gleifById = new Map<string, PublicRecord>();
  for (const g of gd) for (const r of g.records) gleifById.set(r.registryRecordId, r);
  const gleifRecords = [...gleifById.values()].sort((a, b) =>
    a.registryRecordId < b.registryRecordId ? -1 : 1,
  );
  let wikidataRecords = [...wd.records].sort((a, b) =>
    a.registryRecordId < b.registryRecordId ? -1 : 1,
  );

  let devanagariNote: string | null = null;
  if (primaryLabel) {
    if (primaryLabel !== "hi") {
      console.error(`--wikidata-primary-label: only "hi" is supported (got "${primaryLabel}")`);
      process.exitCode = 1;
      return;
    }
    const hindi = hindiLabelsByQid(wikidataDir);
    const before = wikidataRecords.length;
    wikidataRecords = wikidataRecords
      .filter((r) => hindi.has(r.registryRecordId))
      .map((r) => ({
        ...r,
        name: hindi.get(r.registryRecordId)!,
        // The English label is dropped, not demoted: leaving it in
        // aliases would leak the Latin string back in.
        aliases: undefined,
      }));
    devanagariNote =
      `Wikidata records carry the publisher's PRIMARY Hindi label (rdfs:label @hi) as \`name\`. ` +
      `${wikidataRecords.length} of ${before} collected items have one; the rest are excluded ` +
      `because they cannot participate in a transliteration test. The English label is dropped ` +
      `entirely rather than kept as an alias, so no Latin form of the name reaches the resolver.`;
    console.log(`Devanagari-primary view: ${wikidataRecords.length} of ${before} Wikidata records`);
  }

  const leisOf = (r: PublicRecord) =>
    (r.identifiers ?? []).filter((i) => i.scheme === "LEI").map((i) => i.value).sort();

  // --- ground truth ---------------------------------------------------
  //
  // A Wikidata item asserting two DIFFERENT LEIs does not name one legal
  // entity, so no positive pair can honestly be built from it. Those items
  // are retained in the corpus and recorded as `undetermined` — they are
  // real, they are exactly the parent/subsidiary ambiguity this experiment
  // was asked to include, and dropping them would flatter the result.

  const positives: {
    pairId: string;
    lei: string;
    gleifSurrogate: string;
    wikidataSurrogate: string;
    gleifName: string;
    wikidataName: string;
  }[] = [];
  const undetermined: { wikidataSurrogate: string; name: string; leis: string[]; reason: string }[] = [];

  // Surrogates are assigned in a stable, content-independent order so the
  // corpus is byte-reproducible from the same payloads.
  const surrogate = new Map<string, string>();
  let n = 0;
  for (const r of [...gleifRecords, ...wikidataRecords]) {
    surrogate.set(`${r.registry}:${r.registryRecordId}`, `NIDP-${String(++n).padStart(4, "0")}`);
  }
  const sur = (r: PublicRecord) => surrogate.get(`${r.registry}:${r.registryRecordId}`)!;

  for (const w of wikidataRecords) {
    const leis = leisOf(w);
    if (leis.length !== 1) {
      undetermined.push({
        wikidataSurrogate: sur(w),
        name: w.name,
        leis,
        reason:
          leis.length === 0
            ? "Wikidata record states no LEI; no independent claim of identity exists."
            : `Wikidata item states ${leis.length} distinct LEIs (${leis.join(", ")}). An LEI denotes one legal entity, so at most one can be right and the record does not say which. No positive pair is asserted.`,
      });
      continue;
    }
    const g = gleifById.get(leis[0]!);
    if (!g) continue;
    positives.push({
      pairId: `POS-${String(positives.length + 1).padStart(3, "0")}`,
      lei: leis[0]!,
      gleifSurrogate: sur(g),
      wikidataSurrogate: sur(w),
      gleifName: g.name,
      wikidataName: w.name,
    });
  }

  // --- hard negatives -------------------------------------------------
  //
  // SELECTED from real records, never manufactured. Every pair is two
  // records with DIFFERENT LEIs — different legal entities by GLEIF's own
  // definition — whose published names are confusable under one of the
  // documented rules below. The rule that selected a pair is recorded, so
  // a reader can disagree with the rule rather than with a bare list.

  const negatives: {
    pairId: string;
    basis: NegativeBasis;
    a: { surrogate: string; registry: string; name: string; lei: string };
    b: { surrogate: string; registry: string; name: string; lei: string };
  }[] = [];
  const seenNeg = new Set<string>();
  const pushNeg = (basis: NegativeBasis, x: PublicRecord, y: PublicRecord) => {
    const ordered = [x, y].sort((a, b) => (sur(a) < sur(b) ? -1 : 1));
    const p = ordered[0]!;
    const q = ordered[1]!;
    const key = `${sur(p)}|${sur(q)}`;
    if (seenNeg.has(key)) return;
    seenNeg.add(key);
    negatives.push({
      pairId: `NEG-${String(negatives.length + 1).padStart(3, "0")}`,
      basis,
      a: { surrogate: sur(p), registry: p.registry, name: p.name, lei: leisOf(p)[0] ?? "" },
      b: { surrogate: sur(q), registry: q.registry, name: q.name, lei: leisOf(q)[0] ?? "" },
    });
  };

  for (let i = 0; i < gleifRecords.length; i++) {
    for (let j = i + 1; j < gleifRecords.length; j++) {
      const a = gleifRecords[i]!;
      const b = gleifRecords[j]!;
      if (a.registryRecordId === b.registryRecordId) continue;
      const na = a.name;
      const nb = b.name;
      if (expandAmp(na) === expandAmp(nb)) { pushNeg("normalised_name_collision", a, b); continue; }
      const sa = stripSuffix(na);
      const sb = stripSuffix(nb);
      if (sa.length > 0 && sa === sb) { pushNeg("legal_suffix_only", a, b); continue; }
      const ta = new Set(coreTokens(na));
      const tb = new Set(coreTokens(nb));
      if (ta.size >= 2 && tb.size >= 2) {
        const aSubB = [...ta].every((t) => tb.has(t));
        const bSubA = [...tb].every((t) => ta.has(t));
        if (aSubB !== bSubA) { pushNeg("token_subset", a, b); continue; }
      }
      const la = coreTokens(na)[0];
      const lb = coreTokens(nb)[0];
      if (la && la === lb) { pushNeg("shared_leading_token", a, b); continue; }
    }
  }

  // A third party conflating two distinct LEIs on ONE item is the hardest
  // negative in the set, because a real publisher asserts the confusion.
  for (const w of wikidataRecords) {
    const leis = leisOf(w);
    if (leis.length < 2) continue;
    for (let i = 0; i < leis.length; i++) {
      for (let j = i + 1; j < leis.length; j++) {
        const a = gleifById.get(leis[i]!);
        const b = gleifById.get(leis[j]!);
        if (a && b) pushNeg("conflated_by_third_party", a, b);
      }
    }
  }

  // --- masking --------------------------------------------------------

  const endpointOf = (r: PublicRecord) =>
    r.registry === "gleif"
      ? "https://api.gleif.org/api/v1/lei-records"
      : "https://query.wikidata.org/sparql";

  /** Strips every identifying value; keeps every published name verbatim. */
  const mask = (r: PublicRecord): Record<string, unknown> => {
    const id = sur(r);
    const rec: Record<string, unknown> = {
      recordRef: `${r.registry}:${id}`,
      registry: r.registry,
      registryRecordId: id,
      subjectKind: r.subjectKind,
      name: r.name,
      retrievedAt: r.retrievedAt,
      license: r.license,
      licenseUrl: r.licenseUrl,
      sourceUrl: endpointOf(r),
    };
    if (r.aliases?.length) rec.aliases = r.aliases;
    if (r.jurisdiction) rec.jurisdiction = r.jurisdiction;
    if (r.status) rec.status = r.status;
    if (r.observedAt) rec.observedAt = r.observedAt;
    // relations[] is dropped: its targetRegistryRecordId is a raw LEI and
    // would reintroduce the identifier the experiment removes.
    return rec;
  };

  /** GLEIF keeps what it issues; nothing else changes. */
  const anchored = (r: PublicRecord): Record<string, unknown> => {
    if (r.registry !== "gleif") return mask(r);
    const rec: Record<string, unknown> = {
      recordRef: r.recordRef,
      registry: r.registry,
      registryRecordId: r.registryRecordId,
      subjectKind: r.subjectKind,
      name: r.name,
      retrievedAt: r.retrievedAt,
      license: r.license,
      licenseUrl: r.licenseUrl,
      sourceUrl: r.sourceUrl,
    };
    if (r.aliases?.length) rec.aliases = r.aliases;
    const lei = leisOf(r);
    if (lei.length === 1) rec.identifiers = [{ scheme: "LEI", value: lei[0]! }];
    if (r.jurisdiction) rec.jurisdiction = r.jurisdiction;
    if (r.status) rec.status = r.status;
    if (r.observedAt) rec.observedAt = r.observedAt;
    return rec;
  };

  const allRecords = [...gleifRecords, ...wikidataRecords];
  const manifests = [wd.manifest, ...gd.map((g) => g.manifest)];

  const buildCorpus = (regime: "full" | "anchored") => ({
    corpus: {
      name: `no-identifier-pilot-${regime}`,
      version: "1.0.0",
      seed: null,
      generatedAt: new Date().toISOString(),
      description:
        `REAL collected public-register records (GLEIF SRC-002 + Wikidata SRC-001, both CC0 1.0), ` +
        `with identifiers masked under the "${regime}" regime for the P6.16 no-identifier experiment. ` +
        `Names and aliases are verbatim publisher strings; no variant is manufactured. ` +
        `NOT synthetic, and never to be mixed with the Operation DarkNet Delhi corpus or the ` +
        `GLEIF x Wikidata identifier evaluation.`,
    },
    investigation: { name: `No-identifier resolution pilot (${regime})`, status: "in_progress" },
    evidenceSources: [...new Set(allRecords.map((r) => r.registry))].map((registry) => ({
      key: registry,
      label: `${registry} public records (real, CC0 1.0, identifiers masked: ${regime})`,
      sourceType: "structured_dataset",
    })),
    evidenceItems: allRecords.map((r) => {
      const content = regime === "full" ? mask(r) : anchored(r);
      return {
        sourceKey: r.registry,
        ref: content.recordRef as string,
        itemType: "public_record",
        content,
      };
    }),
    locations: [],
    communicationEvents: [],
    financialTransactions: [],
  });

  const truth = {
    experiment: "no-identifier-entity-resolution",
    dataClass: "real-collected-public-record",
    builtFrom: [wikidataDir, ...gleifDirs],
    sources: manifests.map((m) => ({
      sourceId: m.sourceId,
      license: m.license,
      licenseUrl: m.licenseUrl,
      retrievedAt: m.retrievedAt,
      retrievalChannel: m.retrievalChannel,
      rawSha256: m.rawSha256,
      rawSha256Caveat: m.rawSha256Caveat ?? null,
      sourcePayloads: m.sourcePayloads ?? [],
    })),
    primaryLabelView: devanagariNote,
    basis:
      "An LEI denotes exactly one legal entity (ISO 17442). GLEIF and Wikidata state their LEIs " +
      "independently of one another, so a shared LEI is a same-subject claim made by two publishers " +
      "rather than an inference of ours, and distinct LEIs are distinct legal entities however " +
      "similar the names. No name similarity is asserted as truth anywhere in this document.",
    maskedFromResolver: {
      regimes: {
        full: "No record of either publisher carries any identifier.",
        anchored:
          "GLEIF retains the LEI it issues (the reference set). Every Wikidata record is stripped of " +
          "every identifier, so the SHARED identifier is unavailable and a Wikidata record can reach " +
          "its GLEIF subject only through its name.",
      },
      fields: [
        "identifiers[] — removed from every masked record",
        "registryRecordId — replaced by an opaque surrogate (NIDP-####); GLEIF's is the LEI, Wikidata's is the QID",
        "recordRef — derived from registryRecordId, therefore surrogated; this is what reaches provenance.location",
        "sourceUrl — per-record URL embeds the LEI/QID, reduced to the endpoint the record came from",
        "relations[] — targetRegistryRecordId is a raw LEI, so the array is dropped entirely",
      ],
      notMasked: [
        "name — verbatim publisher string, never altered",
        "aliases[] — verbatim publisher strings, never altered",
        "jurisdiction, status, observedAt, license, licenseUrl, retrievedAt",
      ],
    },
    counts: {
      records: allRecords.length,
      gleifRecords: gleifRecords.length,
      wikidataRecords: wikidataRecords.length,
      positivePairs: positives.length,
      hardNegativePairs: negatives.length,
      undeterminedRecords: undetermined.length,
    },
    positives,
    hardNegatives: negatives,
    undetermined,
    /** surrogate -> the real record it stands for. NEVER read by the pipeline. */
    surrogateMap: Object.fromEntries(
      allRecords.map((r) => [
        sur(r),
        { registry: r.registry, registryRecordId: r.registryRecordId, name: r.name, leis: leisOf(r) },
      ]),
    ),
  };

  const outDir = path.resolve(ROOT, path.dirname(out));
  fs.mkdirSync(outDir, { recursive: true });
  for (const regime of ["full", "anchored"] as const) {
    fs.writeFileSync(
      path.resolve(ROOT, `${out}-${regime}.corpus.json`),
      JSON.stringify(buildCorpus(regime), null, 2) + "\n",
    );
  }
  fs.writeFileSync(path.resolve(ROOT, `${out}.ground-truth.json`), JSON.stringify(truth, null, 2) + "\n");

  console.log(`Wrote ${out}-full.corpus.json and ${out}-anchored.corpus.json`);
  console.log(`Wrote ${out}.ground-truth.json`);
  console.log(`  records            ${allRecords.length} (${gleifRecords.length} GLEIF + ${wikidataRecords.length} Wikidata)`);
  console.log(`  positive pairs     ${positives.length}`);
  console.log(`  hard negatives     ${negatives.length}`);
  console.log(`  undetermined       ${undetermined.length}`);
  const byBasis = new Map<string, number>();
  for (const neg of negatives) byBasis.set(neg.basis, (byBasis.get(neg.basis) ?? 0) + 1);
  for (const [basis, count] of [...byBasis].sort()) console.log(`    ${basis.padEnd(28)} ${count}`);
}

main();
