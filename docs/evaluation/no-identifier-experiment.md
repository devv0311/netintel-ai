# The real no-identifier corpus, and what the unmodified resolver does with it

**Status: MEASURED (P6.16.1 design + collection, P6.16.2 baseline), 2026-09-03.**

**No matching logic was changed by this milestone.** `src/lib/resolution` is
byte-identical to what P6.15.1 left. This document is a measurement and a design
record; it recommends nothing be built until section 8 has been read and a
decision taken.

---

## 1. Why this experiment exists

Every cross-source join NetIntel has ever made on real data was made on a shared
LEI. Across P6.6, P6.9 and P6.14, Tier B - exact name match - fired **zero**
times. The four name-variation hypotheses (legal suffix, transliteration,
abbreviation, name order) were never refuted; they were never **reached**,
because Tier A resolved every pair first and Tier A never reads a name.

P6.14 put it plainly: `exactNameMatchRate 0%`, `byteIdenticalNamePairs 0%`. The
system's name-matching capability was therefore entirely unmeasured on real
data, and its one observed failure was an identifier failure, not a name one.

This corpus removes the identifier so the name is the only evidence left.

## 2. Sources, and why these

| | Source | Publisher | Licence | Status | Channel |
|---|---|---|---|---|---|
| SRC-002 | GLEIF LEI (Level 1 + Level 2) | Global Legal Entity Identifier Foundation | CC0 1.0 | APPROVED | `direct-https` |
| SRC-001 | Wikidata | Wikimedia Foundation | CC0 1.0 | APPROVED | `direct-https` |

Both were already registry-approved and already exercised by the pipeline, so
nothing here required a licensing judgement to be made fresh. Both are CC0 1.0,
which is the least restrictive answer available and needs no attribution
carve-out for research use.

**A third source was considered and rejected.** SEC EDGAR (SRC-006) publishes
company names and CIKs, and would have added a genuinely independent third
publisher. It was rejected because the experiment's whole value rests on ground
truth that is *not* inferred from names, and EDGAR does not publish LEIs. The
only available bridge from CIK to LEI runs through Wikidata - whose
identifier error rate P6.14 measured at **15.4%** (4 of 26 Wikidata-supplied
LEIs resolved to entities outside the queried jurisdiction). Adding EDGAR would
have widened the corpus while making its ground truth weaker, which is the wrong
trade for a baseline.

**No broad scraping.** Three bounded requests were made, each through the
existing registry-gated collector, which accepts a source id rather than a URL
and caps `--limit` at the adapter's own `MAX_LIMIT`:

1. Wikidata SPARQL `indian-companies-with-lei`, `--limit 120` -> 120 solution
   rows folded to **78 records** by item id.
2. GLEIF `--leis-from` that Wikidata collection -> **79 records** in 2 batched
   requests. The linkage set is derived from already-collected approved data,
   never hand-typed.
3. GLEIF `filter[entity.jurisdiction]=IN`, one page -> **100 records**, the
   distractor and hard-negative pool.

The `--dry-run` gate was run first and its plan is reproduced in the collection
log. Raw payloads are kept under `data/public/raw/`, individually hashed.

## 3. What was collected

| Source | Records | Retrieved | Channel | rawSha256 (first 16) | Payloads |
|---|---|---|---|---|---|
| SRC-001 Wikidata | 78 | 2026-09-03T20:51:29Z | `direct-https` | `657c11d624a36105` | 1 |
| SRC-002 GLEIF (by LEI) | 79 | 2026-09-03T20:51:37Z | `direct-https` | `7183736bb5d6dc7f` | 2 |
| SRC-002 GLEIF (jurisdiction IN) | 100 | 2026-09-03T20:51:49Z | `direct-https` | `814b22e98a1a5ab0` | 1 |

**257 distinct records** after de-duplicating GLEIF by LEI (179 GLEIF + 78
Wikidata). Every payload was fetched by this process over HTTPS, so each
`rawSha256` is a hash of the publisher's own wire bytes, not of a relayed copy.
Provenance completeness is 100% in both runs (2957/2957 and 3189/3189 rows).

## 4. Ground truth

> An LEI denotes exactly one legal entity (ISO 17442). GLEIF and Wikidata state
> their LEIs independently of one another. So a shared LEI is a same-subject
> claim made by **two publishers**, not an inference of ours; and two distinct
> LEIs are two distinct legal entities however similar their names look.

Nothing about name similarity is asserted as truth anywhere. That is the thing
being measured, so it cannot also be the measuring stick.

- **75 positive pairs** - one subject, observed by both publishers.
- **19 hard negatives** - different legal entities, confusable names.
- **2 undetermined** - a Wikidata item asserting two different LEIs states no
  single legal entity, so no positive pair can honestly be built from it:

  | Record | Name | LEIs asserted |
  |---|---|---|
  | NIDP-0201 | Unipro | `253400DR5QSH8MEGZZ11`, `98450016D1DA0D640356` |
  | NIDP-0241 | Navneet Publications | `3358008DDDK4NDB42Z33`, `335800TC8CLDPMON3N33` |

  Both are kept in the corpus and excluded from pair scoring. They are real,
  they are exactly the parent/subsidiary ambiguity this experiment was asked to
  include, and dropping them would flatter the result.

### Hard negatives are SELECTED, never manufactured

Each is two real records with different LEIs whose published names are
confusable under a stated rule, so a reader can disagree with the rule rather
than with a bare list:

| Rule | Pairs |
|---|---|
| `shared_leading_token` - same distinctive first token after suffix stripping | 17 |
| `token_subset` - one name's tokens are a strict subset of the other's | 1 |
| `conflated_by_third_party` - a real publisher asserts both LEIs on one item | 1 |

The families are naturally occurring: TATA MOTORS PASSENGER VEHICLES / TATA
STARBUCKS / TATA CONSUMER PRODUCTS / TATA CHEMICALS; BHARAT HEAVY ELECTRICALS /
BHARAT DYNAMICS / BHARAT ELECTRONICS; HINDUSTAN AERONAUTICS / HINDUSTAN ZINC;
NAVNEET PRAKASHAN KENDRA / NAVNEET EDUCATION; BHATI SOLAR SOLUTIONS / RAJDEEP
BHATI SOLAR SOLUTIONS. NEG-019 is the hardest in the set, because Wikidata
itself conflates its two sides.

## 5. What was hidden from the resolver, and how

The identifier is absent from the **corpus**, not suppressed behind a flag in
the resolver. There is no code path by which the resolver could read it, so the
masking cannot be defeated by a change of configuration.

| Field | Treatment | Why |
|---|---|---|
| `identifiers[]` | removed from every masked record | the join key itself |
| `registryRecordId` | replaced by opaque `NIDP-####` | GLEIF's record id **is** the LEI; Wikidata's is the QID |
| `recordRef` | surrogated (derived from the above) | this is what lands in `provenance.location` |
| `sourceUrl` | reduced to the endpoint | the per-record URL embeds the LEI/QID |
| `relations[]` | dropped entirely | `targetRegistryRecordId` is a raw LEI |
| `name`, `aliases[]` | **verbatim, never altered** | every measured difference is one two real publishers published |

Two regimes, because they answer different questions:

- **FULL** - no record on either side carries any identifier. Tier A has nothing
  to anchor. Measures the system with identifiers absent entirely.
- **ANCHORED** - GLEIF keeps the LEI it *issues* (it is the authority for the
  scheme, and a registry-anchored reference set is what an investigator
  actually holds); every Wikidata record is stripped of every identifier. The
  **shared** identifier is therefore unavailable, and a Wikidata record can
  reach its GLEIF subject only through its name. This is the regime in which
  Tier B *can* fire at all.

**The masking is verified twice, not asserted once.** At build time by
`tests/unit/no-identifier-corpus.test.ts` (11 assertions), and again at
measurement time by a per-record leak check inside the experiment, which reports
`VOID` instead of a metric if any masked identifier reached an extracted record.
Both regimes report `CLEAN`.

The leak check is scoped per record rather than over the whole corpus. "This LEI
appears somewhere" is the wrong question: in the anchored regime GLEIF
legitimately carries the LEI it issues, and a corpus-wide string search flags it
and calls a correct run void. The claim that actually matters is narrower - *no
record on the masked side carries any identifying value* - and that is what is
checked. (The first version of this check made exactly that mistake and reported
`VOID` on a clean run.)

## 6. Baseline result

Resolver unmodified. Both regimes, 257 records, 75 positive pairs, 19 hard
negatives.

| Metric | FULL | ANCHORED |
|---|---|---|
| **positivePairJoinRate** | **0.0% (0/75)** | **0.0% (0/75)** |
| exactNameMatchRate | 0.0% (0/75) | 0.0% (0/75) |
| byteIdenticalNamePairs | 0.0% (0/75) | 0.0% (0/75) |
| aliasMatchRate | 0.0% (0/107) | 49.5% (53/107) |
| unresolvedRate | 0.0% (0/257) | 0.0% (0/257) |
| falseMergeRate | 0.0% (0/257) | 0.0% (0/257) |
| hardNegativeFalseMergeRate | 0.0% (0/19) | 0.0% (0/19) |
| **fragmentationRate** | **100.0% (75/75)** | **100.0% (75/75)** |
| provenanceCompleteness | 100.0% (2957/2957) | 100.0% (3189/3189) |
| Tier B firings | **0** | **0** |
| resolution types | `new_entity` x257 | `new_entity` x257 |

**Not one of 75 real cross-source pairs was joined, in either regime.**

### 6.1 Tier B did not fire, and could not have

This is structural, not a threshold that happened to be missed. Tier B matches
an identifier-less mention into a **Tier-A cluster** by byte-identical name.

- In **FULL** there are no Tier-A clusters at all, because nothing carries an
  identifier. `nameToClusterEntities` is empty, so every mention takes the
  `candidates.length === 0` branch and becomes its own entity. Two records with
  *byte-identical* names would still not merge - neither is anchored.
- In **ANCHORED** the Tier-A clusters exist (179 singleton GLEIF entities), so
  Tier B is reachable. It still fired zero times, because **0 of 75 pairs have
  byte-identical names**. This is now the fourth independent corpus on which
  that has been measured.

### 6.2 The failure is silent, and that is the more serious finding

`unresolvedRate 0.0%`, `falseMergeRate 0.0%`, **0 warnings**, every one of 257
decisions `status: "resolved"` with `resolutionType: "new_entity"`.

A reader of the output cannot tell this run apart from a perfect one. The
system asserted 257 distinct entities where the ground truth has 182, and said
nothing. Ambiguity is surfaced by this codebase in two places - an ambiguous
name and a conflicting identifier - but a *confident wrong singleton* is not
ambiguity by either definition, so nothing fires. The metric that would have
caught it, `fragmentationRate`, is computed by the evaluation harness against
ground truth and is not available to the running system.

### 6.3 The hard-negative result is worth nothing yet

`hardNegativeFalseMergeRate 0.0% (0/19)` is technically true and analytically
empty: nothing merged, so nothing merged wrongly. TATA CHEMICALS and TATA
CONSUMER PRODUCTS were held apart for exactly the reason Bharat Electronics and
Bharat Electronics were: the resolver never compared them. **This number only
becomes evidence of discrimination once something in the system is capable of
merging on a name.** It is recorded now so that it is a genuine before-measure
when that day comes.

### 6.4 Aliases

`aliasMatchRate` moves from 0.0% (FULL) to 49.5% (ANCHORED), and neither number
is about matching. Aliases are attached inside the Tier-A cluster loop, so with
no clusters nothing attaches at all; with GLEIF anchored, GLEIF's aliases
attach and Wikidata's do not. **Aliases are never read as match candidates by
either tier** - so all 18 Devanagari alias strings in this corpus, the exact
transliteration evidence the experiment set out to test, are carried, stored,
provenanced, and never used to resolve anything.

## 7. Failure categories, with real cases

Every pair failed, so the categories below describe *what kind of difference was
left unhandled*, measured on real publisher strings. Counts are identical in
both regimes.

| Observed difference | Pairs | Joined | Failed |
|---|---|---|---|
| `case_only` | 24 | 0 | 100% |
| `suffix` | 29 | 0 | 100% |
| `abbreviation` | 9 | 0 | 100% |
| `divergent` | 12 | 0 | 100% |
| `transliteration` | 1 | 0 | 100% |
| `identical` | 0 | - | - |
| `punctuation_only` | 0 | - | - |
| `spacing_only` | 0 | - | - |
| `name_order` | 0 | - | - |

**Capitalisation - 24 pairs, the single cheapest class to fix.** The two strings
differ in nothing but case:

```
POS-007  GLEIF 'STATE BANK OF INDIA'              Wikidata 'State Bank of India'
POS-008  GLEIF 'STEEL AUTHORITY OF INDIA LIMITED' Wikidata 'Steel Authority of India Limited'
POS-017  GLEIF 'ITC LIMITED'                      Wikidata 'ITC Limited'
POS-012  GLEIF 'MOSCHIP TECHNOLOGIES LIMITED'     Wikidata 'MosChip Technologies Limited'
```

GLEIF publishes legal names upper-cased; Wikidata publishes them title-cased.
This is a systematic difference between two publishers, not noise, and it
accounts for **32% of the corpus on its own**.

**Legal suffix - 29 pairs, the largest class.** One publisher carries the legal
form, the other does not:

```
POS-005  'COAL INDIA LIMITED'                     'Coal India'
POS-016  'ICICI BANK LIMITED'                     'ICICI Bank'
POS-021  'MAHANAGAR TELEPHONE NIGAM LIMITED'      'Mahanagar Telephone Nigam'
POS-014  'OIL AND NATURAL GAS CORPORATION LIMITED' 'Oil and Natural Gas Corporation'
```

**Abbreviation / trading name - 9 pairs.** The registered name contains the
common name:

```
POS-010  'FLIPKART INDIA PRIVATE LIMITED'          'Flipkart'
POS-002  'RAZORPAY SOFTWARE LIMITED'               'Razorpay'
POS-035  'SUN PHARMACEUTICAL INDUSTRIES LIMITED'   'Sun Pharmaceutical'
POS-047  'GVK POWER & INFRASTRUCTURE LIMITED'      'GVK'
```

Note POS-047: `GVK` is a strict token subset of the GLEIF name and would also
match `GVK BIOSCIENCES` if that record were present. Subset matching is not
safe on its own.

**Divergent - 12 pairs, and NO string method reaches these.** The two names
share no material tokens:

```
POS-004  'INNOFIN SOLUTIONS PRIVATE LIMITED'       'LenDenClub'
POS-006  'TRANSACTREE TECHNOLOGIES PRIVATE LIMITED' 'Lendbox'
POS-019  'LIVING MEDIA INDIA LIMITED'              'India Today Group'
POS-020  'EARLY MAKERS GROUP'                      'Emlyon Business School'
POS-022  'TATA MOTORS PASSENGER VEHICLES LIMITED'  'Tata Motors Ltd'
```

These are legal-name-versus-brand-name pairs. **16% of real cross-source pairs
are unreachable by fuzzy matching, normalisation, transliteration or embeddings
over the primary name**, because the strings genuinely do not correspond. Only
an identifier, a stated alias, or an external cross-reference links them.
POS-022 is additionally a parent/subsidiary trap: the GLEIF record is the
subsidiary and merging it with `Tata Motors Ltd` may be wrong even though the
publishers agree on the LEI.

**Transliteration - 1 pair only.**

```
POS-039  GLEIF (Japanese script)                   Wikidata 'Nippon Paint'
```

This is a **coverage gap in the corpus, not a finding about the resolver**. The
18 Devanagari strings the collection actually contains are Wikidata *aliases*,
not primary names, and GLEIF's Indian records are published in Latin script, so
Devanagari-to-Latin never appears as a primary-name difference. The Devanagari
labels were deliberately **not** promoted into the `name` field to create test
cases - that would be manufacturing a variant, which this corpus does not do.
Testing that hypothesis properly needs a source that publishes Devanagari legal
names as primary, and is section 8's first open question.

## 8. What this does and does not justify

**Established, on real data, reproducibly:**

1. Without a shared identifier the current resolver joins **nothing** - 0 of 75
   pairs, in both regimes.
2. Tier B cannot fire without a Tier-A anchor, and does not fire with one,
   because 0 of 75 pairs have byte-identical names (fourth corpus to show this).
3. The failure is **silent**: 0 warnings, 0 unresolved, everything "resolved".
4. 53% of pairs (case + suffix) differ only by transformations that are
   deterministic, order-independent and reversible.
5. 16% of pairs are unreachable by any name-based method.
6. The hard-negative discrimination question is **still unmeasured**.

**Deliberately NOT concluded here**, per P6.16.3:

- Nothing says fuzzy matching is the answer. Case folding and suffix stripping
  are *not* fuzzy matching - they are deterministic normalisations, and they
  address 53% of the observed failures while remaining explainable in a decision
  row, which matters for an investigative tool.
- The 19 hard negatives exist precisely because normalisation is where false
  merges will come from. `BHARAT ELECTRONICS` and `BHARAT HEAVY ELECTRICALS
  LIMITED` survive suffix stripping as different strings; `TATA MOTORS
  PASSENGER VEHICLES` and `Tata Motors Ltd` do not survive aggressive token
  matching. Any change must be re-measured against **both** sets.
- No embedding, no LLM adjudication and no ML is justified by anything measured
  here. The dominant failure classes are not semantic.

**Requires your decision before any work starts:**

1. **Is normalised name matching allowed to merge at all**, or may it only
   *propose* a merge for review? The system's existing principle is that
   ambiguity is flagged rather than force-merged; a name match is weaker
   evidence than an LEI and arguably belongs in the same category.
2. **Should the silent-failure defect (6.2) be treated as a separate bug**? It
   is independent of name matching, it is arguably the more serious finding, and
   fixing it does not require touching the matching logic.
3. **Do we source a register that publishes Devanagari primary names** to close
   the transliteration gap, or accept that hypothesis as untested?
4. **Aliases as match candidates** - the corpus carries 107 publisher-stated
   aliases that no tier reads. Admitting them is a smaller, better-evidenced
   change than fuzzy matching, and is not currently on any plan.

## 9. Reproducing this

```sh
npm run collect:public -- --source wikidata --query indian-companies-with-lei --limit 120 --dry-run
npm run collect:public -- --source wikidata --query indian-companies-with-lei --limit 120
npm run collect:public -- --source gleif --leis-from data/public/raw/SRC-001/<ts>/public-records.json --limit 200
npm run collect:public -- --source gleif --limit 100

node --import ./scripts/eval-resolve.mjs scripts/build-no-identifier-corpus.ts \
  --wikidata data/public/raw/SRC-001/<ts> \
  --gleif data/public/raw/SRC-002/<ts1>,data/public/raw/SRC-002/<ts2> \
  --out evidence/no-identifier/no-identifier-pilot

node --import ./scripts/eval-resolve.mjs scripts/no-identifier-experiment.ts --regime full
node --import ./scripts/eval-resolve.mjs scripts/no-identifier-experiment.ts --regime anchored
```

Results are written to `reports/no-identifier/{full,anchored}-results.json`,
each carrying its own leak-check verdict, every pair with its outcome, and every
individual failure.

**Corpus isolation.** This corpus has its own evidence files
(`evidence/no-identifier/`), its own databases
(`data/netintel-no-identifier-*.db`), its own reports directory and its own
ground truth. It is never mixed with Operation DarkNet Delhi, with the GLEIF-only
pilot, or with the GLEIF x Wikidata identifier evaluation. Those were re-run
unchanged after this work: DarkNet Delhi all 21 metrics identical (61 entities,
191 relationships, `rel.f1` 67.7%, provenance 100%), cross-source identical
(`falseMergeRate` 0.0% (0/27), `crossSourceJoinRate` 96.0%, `fragmentationRate`
3.8%).
