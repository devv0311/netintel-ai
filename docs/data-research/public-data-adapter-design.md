# Public-Data Adapter — Design (NOT IMPLEMENTED)

**Date:** 2026-09-03 · **Status:** design only. **No collection has been performed. No collector exists. The research gate remains closed.**
**Depends on:** the Option B decision in `docs/architecture/public-data-schema-options.md`
**Sources:** GLEIF (`SRC-002`) and Wikidata (`SRC-001`) — both CC0 — per `docs/data-research/source-registry.md`

---

## 1. Why these two, and why not the others

| Source | Licence | PII | Document extraction needed? | Verdict |
|---|---|---|---|---|
| **GLEIF LEI L1+L2** | CC0 | Legal entities, not natural persons | No — structured | **First** |
| **Wikidata** | CC0 | Public figures, notability-gated | No — structured | **Second** |
| SEC EDGAR | US public domain | Named officers, addresses | **Yes** — long-form filings | Deferred |
| Indian court judgments | CC BY 4.0 | **High** — accused, victims, witnesses | **Yes** | Blocked on a written privacy policy |
| OpenSanctions | CC BY-**NC** | High, adverse designations | No | Blocked on the commercial-posture decision |

The two chosen sources share the properties that make a first experiment safe: no licence
obligation to propagate, no free-text extraction (which does not exist in the pipeline), and —
critically — **their own identifiers are entity-resolution ground truth**. An LEI is a validated
global key; a Wikidata QID with external identifiers gives match/non-match pairs at zero
labelling cost. That is what makes a generalisation test possible at all.

SEC and court judgments are deferred for one reason above all: both are *document* sources, and
the pipeline has no free-text extraction path. Ingesting them would require building that first.

---

## 2. Pipeline

```
  public source (GLEIF bulk file · Wikidata SPARQL)
        │  registry-gated: source_id must be APPROVED in source-registry.csv
        ▼
  RAW ARTIFACT              data/public/raw/<source_id>/<retrievedAt>/<file>
        │                   immutable · sha256 · manifest.json records endpoint,
        │                   retrievedAt, licence, licenceUrl, row count
        ▼
  NORMALIZED RECORD         one JSON object per subject, publisher fields only
        │                   no inference, no enrichment, original values preserved
        ▼
  public_record             the CorpusManifest evidence item shape
        │                   (docs/architecture/public-data-schema-options.md § Option B)
        ▼
  runIngestion({kind:"uploaded"})     ← unchanged code path
        ▼
  extractPublicRecord()     new EXTRACTORS entry: entity_mention per subject/identifier,
        │                   relationship_mention per relations[] edge,
        │                   attribute_mention per remaining scalar
        ▼
  runResolution()           ← UNCHANGED. This is the whole point of the experiment.
        ▼
  runGraphSynthesis()       relations[] → edges
        ▼
  evaluator                 scored against publisher identifiers as ground truth
```

**The load-bearing constraint: `runResolution()` is not modified.** If the resolver is adjusted to
cope with real data, the experiment measures the adjustment instead of the resolver. Any change
it needs is a *finding*, recorded and made afterwards.

---

## 3. Transformations, stated exactly

### 3.1 GLEIF → `public_record`

Input: Golden Copy Level 1 (`lei-records`) and Level 2 (`relationship-records`).

| GLEIF field | Target | Transformation |
|---|---|---|
| `LEI` | `registryRecordId`, `identifiers[{scheme:"LEI"}]` | verbatim, uppercased |
| `Entity.LegalName` | `name` | Unicode NFC only. **No suffix stripping** — whether "Private Limited" defeats exact-name matching is the question being asked |
| `Entity.OtherEntityNames[]` | `aliases[]` | verbatim; name type kept as an attribute |
| `Entity.LegalAddress` | `location` | label from address lines; no geocoding (adds a source we have not licensed) |
| `Entity.LegalJurisdiction` | attribute | ISO code verbatim |
| `Registration.LastUpdateDate` | `observedAt` | verbatim ISO-8601 |
| L2 `StartNode`/`EndNode`/`RelationshipType` | `relations[]` | `IS_DIRECTLY_CONSOLIDATED_BY` → predicate `parent_of` (direction reversed and recorded); `IS_ULTIMATELY_CONSOLIDATED_BY` → `ultimate_parent_of` |
| — | `license` / `licenseUrl` | `"CC0-1.0"` / GLEIF terms URL, written at ingest, never inferred later |

`recordRef` = `gleif:<LEI>`. Content-addressed ids are then assigned by the existing
`src/lib/corpus/load.ts` path — the adapter does not mint entity ids.

### 3.2 Wikidata → `public_record`

Input: one bounded SPARQL query per subject class (exact queries and caps in the experiment
design). Never a crawl; never an unbounded query.

| Wikidata | Target | Transformation |
|---|---|---|
| item QID | `registryRecordId`, `identifiers[{scheme:"WIKIDATA"}]` | verbatim |
| `rdfs:label` (`en`, `hi`) | `name` (en) + `aliases[]` (hi) | **Both scripts retained.** Devanagari vs Latin for the same subject is precisely the transliteration case being tested |
| `skos:altLabel` | `aliases[]` | all requested languages, deduplicated by exact string only |
| `P31` instance-of | `subjectKind` | `Q5` → `person`; organisation classes → `organisation`; place classes → `place`. Anything else is **dropped**, not guessed |
| external ids (`P1278` LEI, `P946` ISIN, `P1320` OpenCorporates) | `identifiers[]` | verbatim, with the property id as `scheme` |
| `P625` coordinates | `location` | verbatim |
| `P749` / `P355` parent/subsidiary | `relations[]` | predicate from the property |
| `schema:dateModified` | `observedAt` | verbatim |
| — | `license` / `licenseUrl` | `"CC0-1.0"` / Wikidata licence URL |

`recordRef` = `wikidata:<QID>`.

### 3.3 What the adapter must never do

- Never merge across the two sources. GLEIF↔Wikidata linking is what the **resolver** is being
  tested on. Pre-linking them destroys the experiment.
- Never normalise a name beyond Unicode NFC. Case-folding, suffix stripping and transliteration
  are all candidate *fixes*; applying them in the adapter hides the problem.
- Never geocode, enrich, translate or infer a missing field.
- Never store a Wikidata field about a living person beyond name, aliases, identifiers, type and
  the declared relations. Date of birth, nationality, positions held and every other biographical
  property are excluded at the adapter, not filtered later.

---

## 4. Collector requirements (design, unbuilt)

1. Binds to a `source_id` from `docs/data-research/source-registry.csv`; refuses any id whose
   `status` is not `APPROVED` or `APPROVED_WITH_RESTRICTIONS`. **No free-URL parameter exists** —
   this is what makes rule 1.1 enforceable in code rather than by convention.
2. `--dry-run` prints source, endpoint, expected artifact, licence, estimated size, request
   count, rate limit and destination, and exits without a network call.
3. `--sample N` caps rows for a pilot.
4. Writes raw artifacts immutably with sha256 + manifest; never overwrites.
5. Wikidata: descriptive User-Agent with contact, bounded `LIMIT`, backoff on 429, dumps for
   anything large. GLEIF: bulk file, no per-record API loop.
6. Resumable and idempotent; re-running with the same inputs yields the same content hashes.

---

## 5. Ground truth for the public corpus

This is the part that makes the experiment scorable, and it is free:

| Metric | Reference |
|---|---|
| Entity-resolution precision/recall | The publisher's own identifier. Two records sharing an LEI (or a QID) are the same entity; two with different ones are not. |
| Cross-source linkage | Wikidata `P1278` carries the LEI. Where present, it is a gold GLEIF↔Wikidata link the resolver should find without being told. |
| Relationship recall | GLEIF L2 parent/child edges are the reference. |
| Alias handling | `aliases[]` is the reference set. |

**Nothing else is scorable.** No communities, no contradictions, no Copilot answers, no temporal
or spatial correlations. Expect a small, sharp metric set — and say so, rather than presenting a
partial evaluation as a full one.

---

## 6. Evaluator changes required

- Partition by investigation/corpus. Mixing the public corpus into the DarkNet Delhi numbers
  would make both uninterpretable.
- A second ground-truth adapter reading publisher identifiers instead of the DarkNet Delhi file.
  The metric functions themselves (`pairwiseCounts`, `ratioMetric`, alignment) are corpus-agnostic
  and need no change — that was deliberate.

---

## 7. Explicitly out of scope

No collection. No network call. No `data/public/` directory. No collector module. No schema
change. This document exists so that when the gate opens the work is specified rather than
improvised, and so that the decision to open it is made against a written design.
