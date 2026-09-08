/**
 * P6.27 — mine spelled-out legal-form boilerplate from the TRAINING corpora.
 *
 *   npm run ml:legal-forms
 *
 * WHY THIS IS MINED AND NOT WRITTEN.
 *
 * P6.26 found v3 merging `Sabiedriba ar ierobezotu atbildibu "AKZ"` with
 * `Frigate AS` at 0.9922. The mechanism was visible: `sabiedriba ar
 * ierobezotu atbildibu` is Latvian for "limited liability company", Latvian
 * GLEIF records spell the form out INSIDE the legal name, and thirty
 * characters of shared boilerplate read as name agreement to every
 * character- and token-similarity feature the model has.
 *
 * The obvious repair is a list of foreign legal forms. It is also the wrong
 * one. A hand-written list is a set of guesses about which languages matter,
 * tested against the examples that prompted it — which is how you get a rule
 * that fixes Latvian, is silent on Lithuanian, and cannot say why. Worse, the
 * examples that prompted it came from a frozen test, so a list derived from
 * them would carry that test's fingerprints into the feature set.
 *
 * So the vocabulary is DERIVED, by a rule stated in advance, from the
 * training corpora alone:
 *
 *   A token n-gram (n = 1..6) anchored at the START or END of a name is
 *   legal-form boilerplate for a jurisdiction when it opens or closes the
 *   names of at least MIN_DISTINCT distinct entities in that jurisdiction
 *   AND at least MIN_SHARE of that jurisdiction's names.
 *
 * That is a statement about DISTRIBUTION, not about language. It finds
 * Latvian without being told Latvian exists, and it would find any other
 * jurisdiction that spells its forms out — which is the property a
 * hand-written list cannot have.
 *
 * MINED PER JURISDICTION, APPLIED GLOBALLY. A phrase that is boilerplate in
 * Latvia is not an identity token in Norway either, and a cross-border pair
 * is precisely where one side carries the form and the other does not.
 * Conditioning application on jurisdiction would also fail exactly when
 * jurisdiction is missing, which is common.
 *
 * INPUTS ARE TRAINING DATA ONLY. Frozen tests #1, #2 and #3 are not read
 * here, and the script refuses to read them. Mining a feature vocabulary
 * from a test set is the same error as fitting on it.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { STRUCTURAL_TOKENS } from "@/lib/ml/structural-tokens";

const ROOT = process.cwd();

const arg = (name: string, fallback: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? (process.argv[i + 1] as string) : fallback;
};

/**
 * Training datasets only. Named explicitly rather than globbed, for the same
 * reason the corpus builders pin their collection runs: a glob silently
 * absorbs whatever lands in the directory next, and what lands next here is
 * a frozen test.
 */
const TRAIN_DATASETS = arg(
  "datasets",
  "evidence/ml/pair-dataset-v2.json,evidence/ml/pair-dataset-v3.json",
)
  .split(",")
  .map((v) => v.trim())
  .filter((v) => v.length > 0);

const FORBIDDEN = ["final-test"];

/** A form must open or close this many distinct entities in a jurisdiction. */
const MIN_DISTINCT = Number(arg("min-distinct", "5"));
/** ...and cover at least this share of that jurisdiction's names. */
const MIN_SHARE = Number(arg("min-share", "0.10"));
/** Longest n-gram considered. Latvian's form is four tokens. */
const MAX_NGRAM = Number(arg("max-ngram", "6"));
/** A jurisdiction with fewer names than this cannot support a share estimate. */
const MIN_JURISDICTION_NAMES = Number(arg("min-jurisdiction-names", "20"));
/** Share at which a single-jurisdiction form counts as that jurisdiction's standard. */
const DOMINANT_SHARE = Number(arg("dominant-share", "0.25"));
/** Max share of a form's occurrences that may sit anywhere but its anchored edge. */
const MAX_OFF_POSITION = Number(arg("max-off-position", "0.20"));

const OUT = arg("out", "src/lib/ml/legal-form-vocabulary.ts");
/** A JSON copy under evidence/, so the artifact is reviewable as data too. */
const EVIDENCE_OUT = arg("evidence-out", "evidence/ml/legal-form-vocabulary.json");

interface FeatureRecordLike {
  name: string;
  officialName?: string | null;
  aliases?: string[];
  jurisdiction?: string | null;
  registry?: string;
}

/**
 * The same folding the feature layer will apply before matching, kept in one
 * place so the miner and the consumer cannot disagree about what a token is.
 * Deliberately NOT `normalizeName` from the resolver: that strips trailing
 * English legal suffixes, which is the very signal being measured here.
 */
export const foldForMining = (value: string): string =>
  value
    .normalize("NFKD")
    // Strip combining marks so "sporiteľňa" and "sporitelna" are one token.
    // Latvian, Czech and Turkish records differ from their Wikidata twins by
    // diacritics far more often than by words.
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    // Dots removed, not spaced, so "S.A." is one token. Kept identical to
    // `foldName` in src/lib/ml/legal-forms.ts; see the note there for the
    // measurement that justified it.
    .replace(/[.]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const main = (): void => {
  for (const dataset of TRAIN_DATASETS) {
    for (const banned of FORBIDDEN) {
      if (dataset.includes(banned)) {
        console.error(
          `REFUSED  ${dataset} looks like a frozen test. A feature vocabulary mined from a test set is fitting on it.`,
        );
        process.exitCode = 1;
        return;
      }
    }
  }

  // name -> set of jurisdictions is not what we want; we want, per
  // jurisdiction, the set of DISTINCT entities whose name starts or ends
  // with a given n-gram. Distinct entity, not distinct name: two publishers
  // spelling one company two ways must not count as two pieces of evidence.
  const perJurisdiction = new Map<
    string,
    { names: Set<string>; leading: Map<string, Set<string>>; trailing: Map<string, Set<string>> }
  >();

  let recordsRead = 0;
  const provenance: { dataset: string; records: number; sha256: string }[] = [];
  const subjectOfRef = new Map<string, string>();

  for (const dataset of TRAIN_DATASETS) {
    const abs = path.resolve(ROOT, dataset);
    if (!fs.existsSync(abs)) {
      console.error(`missing dataset: ${dataset}`);
      process.exitCode = 1;
      return;
    }
    const bytes = fs.readFileSync(abs);
    const parsed = JSON.parse(bytes.toString("utf8")) as {
      featureRecords: Record<string, FeatureRecordLike>;
      pairs?: { aRef: string; bRef: string; subjectA: string; subjectB: string }[];
    };
    const records = Object.entries(parsed.featureRecords ?? {});
    /**
     * ref -> SUBJECT, and this mapping is load-bearing.
     *
     * A record's ref is registry-local: GLEIF keys on the LEI, Wikidata on a
     * surrogate `EXP-nnnn`. Treating the ref as the entity would make every
     * genuine cross-source positive look like two different companies, and
     * the collision veto below would then reject "a s", "ag" and "b v" —
     * every real legal form — because stripping them correctly collides the
     * two publishers' records of ONE entity. The subject (LEI or CIK) is the
     * identity the whole project resolves on; it is the identity here too.
     */
    for (const pair of parsed.pairs ?? []) {
      if (pair.aRef && pair.subjectA) subjectOfRef.set(pair.aRef, pair.subjectA);
      if (pair.bRef && pair.subjectB) subjectOfRef.set(pair.bRef, pair.subjectB);
    }
    provenance.push({
      dataset,
      records: records.length,
      sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    });

    for (const [ref, record] of records) {
      recordsRead += 1;
      const jurisdiction = (record.jurisdiction ?? "").trim().toUpperCase() || "??";
      // The entity key, so GLEIF and Wikidata spellings of one company are
      // one vote rather than two. Falls back to the ref only for a record no
      // pair ever cited, which cannot collide with anything by definition.
      const entityKey = subjectOfRef.get(ref) ?? `ref:${ref}`;
      let bucket = perJurisdiction.get(jurisdiction);
      if (!bucket) {
        bucket = { names: new Set(), leading: new Map(), trailing: new Map() };
        perJurisdiction.set(jurisdiction, bucket);
      }

      const surfaces = [record.name, record.officialName ?? "", ...(record.aliases ?? [])].filter(
        (v) => typeof v === "string" && v.trim().length > 0,
      );

      for (const surface of surfaces) {
        const folded = foldForMining(surface);
        if (folded.length === 0) continue;
        bucket.names.add(`${entityKey}::${folded}`);
        const tokens = folded.split(" ");
        // A name that is ONLY a legal form carries no identity; counting it
        // would let the form vote for itself.
        if (tokens.length < 2) continue;
        const span = Math.min(MAX_NGRAM, tokens.length - 1);
        for (let n = 1; n <= span; n += 1) {
          const lead = tokens.slice(0, n).join(" ");
          const trail = tokens.slice(tokens.length - n).join(" ");
          if (!bucket.leading.has(lead)) bucket.leading.set(lead, new Set());
          (bucket.leading.get(lead) as Set<string>).add(entityKey);
          if (!bucket.trailing.has(trail)) bucket.trailing.set(trail, new Set());
          (bucket.trailing.get(trail) as Set<string>).add(entityKey);
        }
      }
    }
  }

  // Distinct entities per jurisdiction, for the share denominator.
  const entitiesPerJurisdiction = new Map<string, number>();
  for (const [jurisdiction, bucket] of perJurisdiction) {
    const entities = new Set<string>();
    for (const key of bucket.names) entities.add(key.split("::")[0] as string);
    entitiesPerJurisdiction.set(jurisdiction, entities.size);
  }

  interface Mined {
    form: string;
    position: "leading" | "trailing";
    tokens: number;
    jurisdictions: { jurisdiction: string; entities: number; share: number }[];
  }
  const mined = new Map<string, Mined>();

  for (const [jurisdiction, bucket] of perJurisdiction) {
    const denominator = entitiesPerJurisdiction.get(jurisdiction) ?? 0;
    if (denominator < MIN_JURISDICTION_NAMES) continue;
    for (const position of ["leading", "trailing"] as const) {
      for (const [form, entities] of bucket[position]) {
        const count = entities.size;
        const share = count / denominator;
        if (count < MIN_DISTINCT || share < MIN_SHARE) continue;
        const key = `${position}:${form}`;
        let entry = mined.get(key);
        if (!entry) {
          entry = { form, position, tokens: form.split(" ").length, jurisdictions: [] };
          mined.set(key, entry);
        }
        entry.jurisdictions.push({ jurisdiction, entities: count, share: Number(share.toFixed(4)) });
      }
    }
  }

  /**
   * Drop an n-gram whose evidence is entirely inherited from a longer one it
   * is a suffix/prefix of. "atbildibu" qualifies only because "sabiedriba ar
   * ierobezotu atbildibu" does; keeping both would let a fragment strip text
   * on its own, in jurisdictions where that fragment means something.
   *
   * A shorter form SURVIVES when it is attested by entities the longer form
   * does not cover — which is how "ltd" survives alongside "private ltd".
   */
  const byPosition = { leading: [] as Mined[], trailing: [] as Mined[] };
  for (const entry of mined.values()) byPosition[entry.position].push(entry);

  const kept: Mined[] = [];
  for (const position of ["leading", "trailing"] as const) {
    const entries = byPosition[position].sort((a, b) => b.tokens - a.tokens);
    for (const entry of entries) {
      const longerCovering = entries.filter(
        (other) =>
          other !== entry &&
          other.tokens > entry.tokens &&
          (position === "trailing"
            ? other.form.endsWith(` ${entry.form}`)
            : other.form.startsWith(`${entry.form} `)),
      );
      if (longerCovering.length === 0) {
        kept.push(entry);
        continue;
      }
      // Keep it only if its own entity support materially exceeds the
      // longer forms' combined support in at least one jurisdiction.
      const survives = entry.jurisdictions.some((j) => {
        const longerInSame = longerCovering
          .flatMap((o) => o.jurisdictions)
          .filter((o) => o.jurisdiction === j.jurisdiction)
          .reduce((max, o) => Math.max(max, o.entities), 0);
        return j.entities >= longerInSame + MIN_DISTINCT;
      });
      if (survives) kept.push(entry);
    }
  }

  /**
   * VETO 1 — structural tokens.
   *
   * "holding ag", "holdings limited", "group limited" all clear the
   * frequency bar, and stripping any of them would be a direct regression.
   * `holding`, `group` and their siblings are the existing feature set's
   * evidence that two names describe different POSITIONS in a corporate
   * group — "Novartis AG" against "Novartis Pharma AG". Removing them would
   * delete the one signal that currently separates a parent from its
   * subsidiary, in the name of fixing false merges.
   */
  const structuralVetoed: string[] = [];
  const afterStructural = kept.filter((entry) => {
    const hit = entry.form.split(" ").find((token) => STRUCTURAL_TOKENS.has(token));
    if (hit) {
      structuralVetoed.push(`${entry.form}  (structural token "${hit}")`);
      return false;
    }
    return true;
  });

  /**
   * VETO 2 — the collision test, which is the one that matters.
   *
   * Frequency alone cannot tell a legal form from a common brand. In a
   * jurisdiction with few LEI-bearing entities, "fund generali invest cee
   * plc" and "poistovna a s vienna insurance group" clear the bar as easily
   * as "s r o" does, and stripping them would merge every Generali fund into
   * one entity — building the exact defect this phase exists to remove.
   *
   * The discriminator is not linguistic, it is behavioural: a true legal
   * form is semantically empty, so removing it makes records of the SAME
   * entity collide and leaves DISTINCT entities apart. A brand is not, so
   * removing it collides distinct entities immediately.
   *
   * So each candidate is applied on its own to the training names, and the
   * number of distinct-entity collisions it CREATES is counted. Any
   * candidate that creates one is rejected. This is measured against the
   * same identity definition everything else uses - same LEI, same entity -
   * and it is the property we actually want, tested directly rather than
   * approximated by a word list.
   */
  const applyOne = (folded: string, entry: Mined): string | null => {
    const tokens = folded.split(" ");
    const formTokens = entry.form.split(" ");
    if (tokens.length <= formTokens.length) return null;
    const slice =
      entry.position === "leading"
        ? tokens.slice(0, formTokens.length)
        : tokens.slice(tokens.length - formTokens.length);
    if (slice.join(" ") !== entry.form) return null;
    const rest =
      entry.position === "leading"
        ? tokens.slice(formTokens.length)
        : tokens.slice(0, tokens.length - formTokens.length);
    return rest.length === 0 ? null : rest.join(" ");
  };

  // entity -> folded surfaces, and folded surface -> entities, from training.
  const surfacesByEntity = new Map<string, Set<string>>();
  for (const bucket of perJurisdiction.values()) {
    for (const key of bucket.names) {
      const [entity, folded] = key.split("::") as [string, string];
      if (!surfacesByEntity.has(entity)) surfacesByEntity.set(entity, new Set());
      (surfacesByEntity.get(entity) as Set<string>).add(folded);
    }
  }
  const entitiesByExactName = new Map<string, Set<string>>();
  for (const [entity, surfaces] of surfacesByEntity) {
    for (const surface of surfaces) {
      if (!entitiesByExactName.has(surface)) entitiesByExactName.set(surface, new Set());
      (entitiesByExactName.get(surface) as Set<string>).add(entity);
    }
  }
  const alreadyColliding = (name: string): boolean =>
    (entitiesByExactName.get(name)?.size ?? 0) > 1;

  /**
   * VETO 3 — family-scoped phrases.
   *
   * The collision test is a safety property, not a definition: it proves a
   * candidate merges nothing wrongly in TRAINING, which "fund generali
   * invest cee plc" satisfies, because stripping a shared brand tail from
   * eleven sibling funds leaves eleven distinct prefixes. It is still not a
   * legal form, and applying it out of sample would strip a brand.
   *
   * What separates the two is scope, and it follows from what a legal form
   * IS. A legal form is a jurisdiction's standard, so inside that
   * jurisdiction it dominates - Turkish `anonim sirketi` reaches 84%,
   * Hebrew `בע מ` 80%, Russian `публичное акционерное общество` 51%. A brand
   * belongs to one corporate family, so it is confined to one jurisdiction
   * AND stays a minority there.
   *
   * So: attested in at least two jurisdictions, OR dominant in one. Neither
   * arm is about any particular example, and a form that is genuinely
   * standard in a single jurisdiction still qualifies through the second.
   */
  const familyVetoed: string[] = [];
  const afterFamily = afterStructural.filter((entry) => {
    const jurisdictions = entry.jurisdictions.length;
    const topShare = entry.jurisdictions.reduce((max, j) => Math.max(max, j.share), 0);
    if (jurisdictions >= 2 || topShare >= DOMINANT_SHARE) return true;
    familyVetoed.push(
      `${entry.form}  (1 jurisdiction, top share ${(topShare * 100).toFixed(0)}% < ${(DOMINANT_SHARE * 100).toFixed(0)}%)`,
    );
    return false;
  });

  /**
   * VETO 4 — positional binding.
   *
   * `china` cleared every test above. It is not structural, it is attested
   * across CN, KY and HK, and stripping it collides nothing in training - and
   * it is plainly not a legal form. Stripping it turns "China Mobile" into
   * "Mobile", which is an identity claim, not a normalisation.
   *
   * What actually separates it from `gmbh` is grammar. A legal form is BOUND
   * to the edge of a name: `gmbh` and `anonim sirketi` and `בע מ` appear at
   * the end and essentially nowhere else. An identity token roams - `china`
   * leads "China Mobile", trails "Bank of China" and sits inside "Air China
   * Limited".
   *
   * So a candidate is rejected when more than MAX_OFF_POSITION of its
   * occurrences in training names sit anywhere but its own anchored edge.
   * Like the others, this is a property of what a legal form is, measured
   * directly, rather than a list of words to distrust.
   */
  const positionVetoed: string[] = [];
  const allFolded: string[] = [];
  for (const bucket of perJurisdiction.values()) {
    for (const key of bucket.names) allFolded.push(key.split("::")[1] as string);
  }
  const afterPosition = afterFamily.filter((entry) => {
    const formTokens = entry.form.split(" ");
    const width = formTokens.length;
    let atEdge = 0;
    let elsewhere = 0;
    for (const folded of allFolded) {
      const tokens = folded.split(" ");
      if (tokens.length < width) continue;
      for (let i = 0; i + width <= tokens.length; i += 1) {
        if (tokens.slice(i, i + width).join(" ") !== entry.form) continue;
        const isEdge = entry.position === "leading" ? i === 0 : i + width === tokens.length;
        if (isEdge) atEdge += 1;
        else elsewhere += 1;
      }
    }
    const total = atEdge + elsewhere;
    if (total === 0) return true;
    const offShare = elsewhere / total;
    if (offShare > MAX_OFF_POSITION) {
      positionVetoed.push(
        `${entry.form}  (${(offShare * 100).toFixed(0)}% of ${String(total)} occurrences are off its ${entry.position} edge)`,
      );
      return false;
    }
    return true;
  });

  const collisionVetoed: string[] = [];
  const survivors: (Mined & { collisionsCreated: number; entitiesMerged: number })[] = [];

  for (const entry of afterPosition) {
    const coreToEntities = new Map<string, Set<string>>();
    for (const [entity, surfaces] of surfacesByEntity) {
      for (const surface of surfaces) {
        const core = applyOne(surface, entry);
        if (core === null) continue;
        if (!coreToEntities.has(core)) coreToEntities.set(core, new Set());
        (coreToEntities.get(core) as Set<string>).add(entity);
      }
    }
    // A stripped core that lands on a name some OTHER entity already carries
    // verbatim is a collision too, and the commonest shape of one.
    let collisions = 0;
    const examples: string[] = [];
    for (const [core, entities] of coreToEntities) {
      const others = entitiesByExactName.get(core);
      const union = new Set(entities);
      if (others) for (const other of others) union.add(other);
      if (union.size > 1 && !alreadyColliding(core)) {
        collisions += 1;
        if (examples.length < 2) examples.push(`${core} <- ${[...union].slice(0, 2).join(" / ")}`);
      }
    }
    if (collisions > 0) {
      collisionVetoed.push(
        `${entry.form}  (${String(collisions)} distinct-entity collisions, e.g. ${examples[0] ?? ""})`,
      );
      continue;
    }
    survivors.push({ ...entry, collisionsCreated: 0, entitiesMerged: 0 });
  }

  kept.length = 0;
  kept.push(...survivors);
  kept.sort((a, b) => b.tokens - a.tokens || a.form.localeCompare(b.form));

  /**
   * TOKEN DOCUMENT FREQUENCY — the general lever, and the more important
   * half of this artifact.
   *
   * The mined vocabulary above is precise and narrow: five forms, because
   * every candidate that could not prove itself was rejected. It cannot
   * cover Latvian, because the training corpora hold too few Latvian
   * records to support any estimate about Latvian - and the only evidence
   * that Latvian mattered came from a SPENT frozen test, so importing it
   * here would be fitting to that test.
   *
   * A vocabulary was always going to have that shape. What actually
   * generalises is not a list of forms but the property the forms share:
   * boilerplate is COMMON and identity is RARE. `sabiedriba`, `ierobezotu`
   * and `atbildibu` occur across every Latvian record; `akz` and `frigate`
   * occur once each. A similarity that weights tokens by inverse document
   * frequency reads the difference without being told a word of Latvian,
   * and it keeps working in languages this corpus has never seen.
   *
   * So the document frequencies travel with the vocabulary. Counted over
   * DISTINCT ENTITIES rather than records, so a company both publishers
   * describe is one document; counted on training data only.
   */
  const documentFrequency = new Map<string, number>();
  const entityTokens = new Map<string, Set<string>>();
  for (const [entity, surfaces] of surfacesByEntity) {
    const tokens = new Set<string>();
    for (const surface of surfaces) for (const token of surface.split(" ")) tokens.add(token);
    entityTokens.set(entity, tokens);
  }
  for (const tokens of entityTokens.values()) {
    for (const token of tokens) documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
  }
  const documentCount = entityTokens.size;
  // A token seen once carries no reliable estimate and would bloat the
  // artifact; unseen and singleton tokens both fall back to the rarest
  // representable weight at read time.
  const MIN_DF = 2;
  const frequencies: Record<string, number> = {};
  for (const [token, df] of [...documentFrequency.entries()].sort((a, b) => b[1] - a[1])) {
    if (df >= MIN_DF) frequencies[token] = df;
  }

  const artifact = {
    vocabularyId: "cipher-legal-form-vocabulary",
    vocabularyVersion: "1.0.0",
    phase: "P6.27",
    dataClass: "REAL",
    note:
      "Legal-form boilerplate MINED from training corpora by a distributional rule, never hand-written and never derived from a frozen test. See scripts/ml/mine-legal-forms.ts.",
    rule: {
      statement:
        "A token n-gram anchored at the start or end of a name is legal-form boilerplate for a jurisdiction when it opens or closes the names of at least MIN_DISTINCT distinct entities in that jurisdiction AND at least MIN_SHARE of that jurisdiction's entities.",
      minDistinct: MIN_DISTINCT,
      minShare: MIN_SHARE,
      maxNgram: MAX_NGRAM,
      maxOffPosition: MAX_OFF_POSITION,
      minJurisdictionNames: MIN_JURISDICTION_NAMES,
      dominantShare: DOMINANT_SHARE,
      appliedGlobally:
        "Mined per jurisdiction, applied regardless of jurisdiction: a phrase that is boilerplate in Latvia is not an identity token in Norway, and a cross-border pair is exactly where one side carries the form and the other does not.",
      vetoes: {
        structural:
          "A candidate containing a STRUCTURAL_TOKEN (holding, group, finance, ...) is rejected. Those tokens are the feature set's evidence that two names describe different positions in a corporate group; stripping them would delete the signal that separates a parent from its subsidiary.",
        familyScoped:
          "A candidate attested in only ONE jurisdiction and reaching less than DOMINANT_SHARE of it is rejected as a corporate-family brand rather than a legal form. A legal form is a jurisdiction's standard and dominates inside it; a brand is confined to one family and stays a minority.",
        positional:
          "A candidate is rejected when more than maxOffPosition of its occurrences sit anywhere but its own anchored edge. A legal form is grammatically bound to the edge of a name; an identity token like \"china\" roams - it leads China Mobile, trails Bank of China and sits inside Air China Limited.",
        collision:
          "A candidate is rejected if applying it makes any two DISTINCT entities collide on an identical core name in the training data. Frequency cannot tell a legal form from a common brand; this can, because a legal form is semantically empty and a brand is not.",
      },
    },
    vetoed: {
      structural: structuralVetoed.sort(),
      familyScoped: familyVetoed.sort(),
      positional: positionVetoed.sort(),
      collision: collisionVetoed.sort(),
    },
    minedFrom: provenance,
    recordsRead,
    jurisdictionsConsidered: [...entitiesPerJurisdiction.entries()]
      .filter(([, n]) => n >= MIN_JURISDICTION_NAMES)
      .map(([j, n]) => ({ jurisdiction: j, entities: n }))
      .sort((a, b) => b.entities - a.entities),
    tokenDocumentFrequency: {
      note:
        "Document frequency over DISTINCT ENTITIES in the training corpora. Used for inverse-document-frequency weighting of name similarity, so that boilerplate is discounted in any language, including languages this corpus does not contain.",
      documentCount,
      minDocumentFrequency: MIN_DF,
      distinctTokens: Object.keys(frequencies).length,
      frequencies,
    },
    formCount: kept.length,
    forms: kept.map((entry) => ({
      form: entry.form,
      position: entry.position,
      tokens: entry.tokens,
      jurisdictions: entry.jurisdictions.sort((a, b) => b.share - a.share),
    })),
  };

  const evidencePath = path.resolve(ROOT, EVIDENCE_OUT);
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  fs.writeFileSync(evidencePath, JSON.stringify(artifact, null, 2) + "\n");

  /**
   * Emitted as TypeScript rather than imported as JSON.
   *
   * A `.json` import needs an import attribute under Node's ESM loader and
   * is handled differently again by the Next.js bundler; a generated module
   * is read identically by both, and is type-checked into the bargain. The
   * JSON above remains the reviewable artifact.
   */
  const outPath = path.resolve(ROOT, OUT);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(
    outPath,
    [
      "/**",
      " * GENERATED by scripts/ml/mine-legal-forms.ts - do not edit by hand.",
      " *",
      " * Legal-form boilerplate mined from the training corpora by a distributional",
      " * rule, plus token document frequencies for IDF weighting.",
      " *",
      " * Regenerate with `npm run ml:legal-forms`.",
      ` * The reviewable JSON copy is \`${EVIDENCE_OUT}\`.`,
      " */",
      `export const LEGAL_FORM_VOCABULARY = ${JSON.stringify(artifact, null, 2)} as const;`,
      "",
      "export default LEGAL_FORM_VOCABULARY;",
      "",
    ].join("\n"),
  );

  console.log(`Mined ${kept.length} legal-form patterns from ${recordsRead} training records.`);
  console.log(`  datasets: ${TRAIN_DATASETS.join(", ")}`);
  console.log(`  rule: >= ${MIN_DISTINCT} distinct entities AND >= ${(MIN_SHARE * 100).toFixed(0)}% of a jurisdiction`);
  console.log(`  written: ${path.relative(ROOT, outPath)}`);
  console.log(`  evidence: ${path.relative(ROOT, evidencePath)}`);
  console.log(
    `  token DF: ${String(Object.keys(frequencies).length)} tokens over ${String(documentCount)} distinct entities`,
  );
  console.log();
  console.log("Longest 25 forms (the ones a trailing-suffix list would miss):");
  for (const entry of kept.filter((e) => e.tokens >= 2).slice(0, 25)) {
    const top = entry.jurisdictions[0];
    console.log(
      `  ${entry.position.padEnd(8)} ${String(entry.tokens)}t  ${entry.form.padEnd(42)} ${top ? `${top.jurisdiction} ${(top.share * 100).toFixed(0)}% (${String(top.entities)})` : ""}`,
    );
  }
};

main();
