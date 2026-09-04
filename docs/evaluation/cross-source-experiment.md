# Cross-source entity resolution — GLEIF × Wikidata (real data)

**Date:** 2026-09-03
**Command:** `node --import ./scripts/eval-resolve.mjs scripts/cross-source-experiment.ts`
**Results:** `reports/cross-source/gleif-wikidata-results.json`
**Corpus:** `evidence/public-pilot/gleif-wikidata-cross.corpus.json` — 51 real records
**Resolver:** §1–§6 record the P6.14 run, against a resolver that merged on any shared
identifier. **§7 is the P6.15 re-run** under the identifier-authority policy and is the
current state. No fuzzy matching, no embeddings, no adjudication and no ML in either.

The measurement the GLEIF-only pilot could not make. There every subject appeared once,
so nothing could be joined and every merge figure was arithmetic. Here each subject
appears twice — once as GLEIF states it, once as Wikidata states it — and the LEI both
publishers independently assert is the ground truth the resolver has to rediscover.

---

## 1. Data

| | GLEIF (SRC-002) | Wikidata (SRC-001) |
|---|---|---|
| Records | 26 | 25 |
| Licence | CC0 1.0 | CC0 1.0 |
| Channel | `direct-https` | `direct-https` |
| Raw payload | stored, hash verified | stored, hash verified |
| Requests | 1 | 1 |

26 cross-source subjects, **25 pairs** (one GLEIF record has no Wikidata counterpart —
see §4.1).

**How the two samples were made to overlap.** The first GLEIF pilot drew 24 arbitrary
Indian LEIs; Wikidata's LEI-bearing Indian companies are large listed firms. Overlap was
**zero** — 24 of India's 395,227 LEIs will not meet another publisher's sample by chance.
The linkage set is therefore taken from the Wikidata collection itself: `--leis-from`
reads the LEIs out of the already-collected, registry-approved Wikidata records and asks
GLEIF for exactly those. One request, 26 identifiers, no crawl, no widening — and the
only construction that produces cross-source pairs at all.

## 2. Results

```
  crossSourceJoinRate        100.0%  (25/25)
  identifierMatchRate        100.0%  (25/25)
  exactNameMatchRate           0.0%  (0/25)
  byteIdenticalNamePairs       0.0%  (0/25)
  aliasMatchRate             100.0%  (28/28)
  unresolvedRate               0.0%  (0/51)
  falseMergeRate               4.0%  (1/25)
  fragmentationRate            0.0%  (0/26)
  provenanceCompleteness     100.0%  (670/670)

  resolution types:  shared_identifier_merge  51   (nothing else fired)

  variation         pairs  joined  failed
  case_only            11      11       0
  suffix               10      10       0
  transliteration       2       2       0
  abbreviation          1       1       0
  divergent             1       1       0
```

### 2.1 Tier A carried everything. Tier B contributed nothing — again, and now on real data.

`shared_identifier_merge` accounts for **51 of 51** resolution decisions.
`exact_name_match` fired **zero** times.

The reason is now measured rather than hypothesised: **not one of the 25 pairs had
byte-identical names across the two publishers.** Zero. Tier B requires a byte-exact
match and real publishers never produced one — not because the names were unrecognisable,
but because eleven pairs differ *only in capitalisation*:

```
  BHARAT ELECTRONICS              <>  Bharat Electronics
  ACC LIMITED                     <>  ACC Limited
  HINDUSTAN AERONAUTICS LIMITED   <>  Hindustan Aeronautics Limited
```

This is the P6.6 fixture's central claim — "Tier B needs a byte-exact name match, and
name variation is precisely what makes the strings differ" — **confirmed against real
records** rather than against a fixture built to demonstrate it.

### 2.2 The four name-variation hypotheses did not fail. They were never tested.

P6.6 predicted failures from suffixes, transliteration, abbreviation and name ordering.
On this corpus **every** such pair joined: suffix 10/10, transliteration 2/2,
abbreviation 1/1.

That is not a refutation, and reporting it as one would be wrong. Those pairs joined
**because a shared LEI was present**, and Tier A never looks at the name. What the run
establishes is narrower and more useful:

> When an authoritative shared identifier exists, name variation is irrelevant — the
> resolver does not need to solve it. The suffix/transliteration/abbreviation problem
> only becomes real for records with **no** shared identifier, and this corpus has none
> of those, because the linkage set was built from LEIs.

So the four hypotheses remain **untested**, not disproven. The corpus that would test
them is one where subjects must be matched *without* an identifier — a different
experiment, and the honest next one.

Worth noting how wide the variation was, since Tier A absorbed all of it:

```
  Публичное акционерное общество "Юнипро"  <>  Unipro          (Cyrillic)
  日本ペイントホールディングス株式会社        <>  Nippon Paint     (Japanese)
  TATA MOTORS PASSENGER VEHICLES LIMITED   <>  Tata Motors Ltd  (different legal name)
  ELSEVIER B.V.                            <>  Elsevier
```

## 3. The real failure: one false merge, and it is not a name problem

**`falseMergeRate 4.0% (1/25)`.** One entity contains two distinct legal entities:

```
entity_fea633b49ede17c28390
  LEI:253400DR5QSH8MEGZZ11   Публичное акционерное общество "Юнипро"   (RU)
  LEI:98450016D1DA0D640356   UNIPRO
  wikidata:Q188087           Unipro
```

**Mechanism.** Wikidata item Q188087 states **two** different `P1278` (LEI) values. The
resolver's Tier A merges on shared identifier, so it joined GLEIF-A to Q188087 on the
first LEI and GLEIF-B to Q188087 on the second, and transitively collapsed two unrelated
legal entities — a Russian PJSC and another company — into one.

Three things follow, and the third is the one that matters:

1. **This is not a name-matching failure.** The two GLEIF names are wildly different.
   No fuzzy matcher, embedding or LLM adjudicator would have prevented it; the merge came
   from an identifier, which those techniques do not touch.
2. **Loosening matching would make it worse, not better.** The resolver's problem here is
   that it trusts an identifier absolutely, not that it matches names too strictly.
3. **Cross-source linkage inherits the linking source's error rate.** GLEIF is the
   authority for LEIs; Wikidata's `P1278` is crowd-edited. On this sample that is
   measurable:

   | | |
   |---|---|
   | Wikidata items asserting >1 LEI | **1 / 25** |
   | Wikidata-supplied LEIs resolving to a **non-Indian** entity, from a query filtered `P17 = India` | **4 / 26 (15.4%)** — RU, JP, NL, US-DE |

   The query asked for Indian companies. Four of the LEIs it returned belong to
   Elsevier B.V. (Netherlands), Nippon Paint (Japan), Cubic Corporation (US-DE) and a
   Russian PJSC. Whether each is a wrong `P1278` or a wrong `P17`, the effect on a
   pipeline that treats identifiers as authoritative is the same.

## 4. Other real findings

### 4.1 One Wikidata item, two LEIs → 26 subjects but 25 pairs

The second LEI on Q188087 has a GLEIF record and no Wikidata counterpart of its own, so
it is a subject without a pair. The adapter keeps **both** LEIs and chooses between them
nowhere: deciding what a multi-valued identifier means is entity resolution's problem,
not the adapter's.

### 4.2 SPARQL cross-product produced duplicate records — FIXED

The adapter emitted one `public_record` per SPARQL solution. A single item with two LEIs
and a Hindi label multiplied into four rows sharing one `recordRef`, and ingestion
**rejected the whole corpus** — correctly, since `recordRef` is
`registry:registryRecordId` and an item has one id. 30 rows now fold to 25 records by
item id, merging identifiers and aliases, discarding nothing, with a warning naming any
item that states more than one LEI.

### 4.3 The collector hashed raw bytes it never saved — FIXED

`manifest.json` recorded `rawSha256` for payloads kept nowhere. A hash nobody can verify,
over bytes nobody can re-derive records from, is not provenance. Direct collections now
write every raw payload to `<retrievedAt>/raw/` before anything derived, and
`sourcePayloads[].storedAt` points at each file. Both runs above were verified by
recomputing sha256 from the stored bytes and comparing to the manifest — **both match**.

### 4.4 Relationship preservation: not exercised

Zero Level 2 relationship records were collected for these entities, so
`relationshipPreservation` is `stated 0 / facts 0 / edges 0`. The GLEIF-only pilot's
finding stands unchanged: `is_fund_managed_by` is preserved as a fact with full
provenance and has no graph edge, pending the modelling decision in
`real-data-pilot.md` §3.2.

## 5. Separation of result classes

Three corpora, three databases, three report directories, never mixed:

| Class | Corpus | Database | Report |
|---|---|---|---|
| Real cross-source | `evidence/public-pilot/gleif-wikidata-cross.*` | `cipher-cross-source.db` | `reports/cross-source/` |
| Real GLEIF-only | `evidence/public-pilot/gleif-in-pilot.*` | `cipher-real-pilot.db` | `reports/real-pilot/` |
| Synthetic morphology | `evidence/public-pilot/name-morphology.*` | `cipher-generalisation.db` | `reports/generalisation/` |
| Synthetic DarkNet Delhi | `evidence/synthetic/…` | `cipher-eval.db` | `reports/evaluation/` |

DarkNet Delhi re-measured after every change in this session: **all 21 metrics
identical.**

## 6. Recommended next step

**Do not change matching logic on the strength of this run.** The only failure observed
was an identifier failure, and every proposed name-matching improvement — suffix
normalisation included — would have changed nothing here, because Tier B never ran.

Two candidates, in order:

1. **Decide how much an identifier from a non-authoritative source is worth.** The false
   merge came from treating a crowd-edited `P1278` as equal in weight to GLEIF's own LEI.
   Options range from source-ranked identifier trust, to refusing a merge when one record
   contributes two conflicting values of the same identifier scheme, to flagging rather
   than merging. This is a **policy** question about authority, not a matching-algorithm
   question, and it is the failure the data actually produced.
2. **Then build the corpus that tests names.** Subjects that must be matched with **no**
   shared identifier. Until such a corpus exists, the suffix / transliteration /
   abbreviation / name-order hypotheses stay exactly what they were after P6.6:
   characterisations of a synthetic fixture, unvalidated against real records.

---

## 7. Update — P6.15 identifier-authority policy applied (2026-09-03)

The §3 false merge is fixed. Same 51 records, same corpus, no recollection; the resolver's
Tier-A identifier handling changed. Full policy and rationale in
`docs/evaluation/identifier-authority-policy.md` §9.

```
                          before (P6.14)      after (P6.15)
  falseMergeRate            4.0% (1/25)   →   0.0% (0/27)
  crossSourceJoinRate     100.0% (25/25)  →  96.0% (24/25)
  identifierMatchRate     100.0% (25/25)  →  96.0% (24/25)
  aliasMatchRate          100.0% (28/28)  →  96.4% (27/28)
  unresolvedRate            0.0% (0/51)   →   2.0% (1/51)
  fragmentationRate         0.0% (0/26)   →   3.8% (1/26)
  provenanceCompleteness  100.0%          → 100.0% (669/669)
  exactNameMatchRate        0.0% (0/25)   →   0.0% (0/25)   unchanged
  resolution types      shared_identifier_merge 51
                                          →  shared_identifier_merge 48,
                                             new_entity 2,
                                             ambiguous_identifier_conflict 1
```

**Every metric that moved is the same record.** Q188087 asserts two LEIs, so it is no
longer merged on either, and the join it lost was wrong. Read `falseMergeRate` first: the
four "worse" numbers are the price of that one line, and they are the correct price.

Two things worth stating plainly rather than leaving to be inferred:

- **`fragmentationRate 3.8%` is a ground-truth artefact, not a resolver defect.** The
  ground truth keys each subject by the first LEI on its record, so Q188087 was assigned
  `LEI:253400…` — the very claim the resolver now refuses to trust. The "fragmented
  subject" is the ground truth inheriting Wikidata's contradiction. It was deliberately
  not corrected: editing ground truth so a resolver scores better is circular, and the
  artefact is more useful visible.
- **The transliteration row now reads 1/2 joined.** The pair that no longer joins is
  `Публичное акционерное общество "Юнипро"` ↔ `Unipro` — the same Q188087 record. This is
  not evidence about transliteration handling. §2.2 still stands in full: the four
  name-variation hypotheses remain **untested**, because Tier B still fired zero times
  (`exactNameMatchRate 0%`, `byteIdenticalNamePairs 0%`).

Isolation held. Operation DarkNet Delhi re-measured against the P6.14 baseline: **all 21
metric values identical**, snapshot counts identical (61 entities, 191 relationships),
`rel.precision 100.0%` / `rel.recall 51.2%` / `rel.f1 67.7%` unchanged,
`provenance.completeness 100%`. The GLEIF-only pilot is unchanged too — no GLEIF record
states two LEIs. The policy governs `has_identifier` only, so nothing outside the
`public_record` path can be affected by construction.

