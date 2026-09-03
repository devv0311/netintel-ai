# Deterministic name normalisation, and the end of silent non-resolution

**Status: IMPLEMENTED AND MEASURED (P6.17), 2026-09-03.**

P6.16 measured the resolver against the real no-identifier corpus and found it
joined **0 of 75** real cross-source pairs, silently. This document records what
was changed in response, what it bought, and what it did not.

Scope discipline, stated first because it is the whole point: **no fuzzy
matching, no edit distance, no similarity threshold, no embeddings, no LLM
adjudication and no ML** was added. Two names either normalise to the same
string or they do not.

---

## 1. The normalisation rules, exactly

`src/lib/resolution/name-normalization.ts`. Pure, idempotent, and applied in
this fixed order - the order is load-bearing, because suffix stripping matches
lower-case, punctuation-free, single-spaced tokens and can only run last.

| # | Rule | What it does |
|---|---|---|
| 1 | **Unicode NFKC** | Composes accents, folds compatibility forms (full-width Latin, ligatures). Does **not** change script. |
| 2 | **Case folding** | `toLowerCase()`. GLEIF upper-cases legal names, Wikidata title-cases them. |
| 3 | **Punctuation** | `. , " ( ) [ ] { } - _ / \ : ; ! ? * \| @ #`, the U+2010-2015 dash family, guillemets, curly double quotes, `·`, `•` all become a space. **Apostrophes (`'`, U+2018, U+2019) are DELETED, not spaced** - they are intra-word, so `Dr. Reddy's` must give `dr reddys`, not `dr reddy s`. `&` expands to ` and `. |
| 4 | **Whitespace** | Any run of whitespace collapses to one space; ends trimmed. |
| 5 | **Legal suffix** | Trailing legal forms stripped repeatedly, longest first: `private limited`, `public limited`, `incorporated`, `corporation`, `limited`, `company`, `gmbh`, `llp`, `llc`, `plc`, `ltd`, `inc`, `corp`, `pvt`, `bv`, `nv`, `sa`, `ag`, `lp`, `co`. **Trailing only**, and **never to empty** - a company called "Limited" keeps its name. |

`normalizeName` returns the key, the pre-suffix form, and `applied[]` - the
steps that actually changed the string - so a decision row can say *why* two
names matched rather than only *that* they did.

**Deliberately absent**, and each for a measured reason:

- **No transliteration or script folding.** Section 5 explains why, and now has
  51 real pairs behind it instead of the 1 P6.16 had.
- **No token reordering.** `Reddy Sanjay` and `Sanjay Reddy` stay distinct.
- **No subset or prefix matching.** `GVK` is a strict token subset of `GVK POWER
  & INFRASTRUCTURE LIMITED` *and* of every other `GVK ...` entity. Subset
  matching is precisely the rule that would produce the false merges the
  hard-negative set exists to catch.

## 2. Where it sits, and why it stays distinguishable

Tier B is now two branches, in order:

- **B1 `exact_name_match`** - unchanged, confidence 0.6.
- **B2 `normalized_name_match`** - new, confidence **0.55**.

An exact match always wins and is always reported as exact; B2 is reached only
when the exact string matched nothing at all. A normalised name reaching two or
more clusters is **`ambiguous_normalized_name_conflict`** (status `ambiguous`,
confidence 0.2, below the merge floor) - a distinct type from
`ambiguous_name_conflict`, so an ambiguity *created by normalisation* is
attributable to normalisation rather than to the publishers' strings.

Three things keep name evidence from being mistaken for identifier evidence, as
required: a distinct `resolutionType`, a strictly lower confidence
(0.55 < 0.6 < 0.95 shared-identifier), and a `reason` naming the exact
transformations applied and the key both names reduced to.

## 3. Result on the real no-identifier corpus

257 real records, 75 positive pairs, 19 hard negatives. Identifiers masked in
the data, per-record leak check CLEAN in both regimes.

| Metric | ANCHORED before | ANCHORED after |
|---|---|---|
| **positivePairJoinRate** | **0.0% (0/75)** | **70.7% (53/75)** |
| normalizedNameMatchRate | - | 70.7% (53/75) |
| exactNameMatchRate | 0.0% | 0.0% (0/75) |
| **hardNegativeFalseMergeRate** | 0.0% (0/19) | **0.0% (0/19)** |
| falseMergeRate | 0.0% (0/257) | 0.5% (1/203) |
| fragmentationRate | 100.0% | 29.3% (22/75) |
| Tier B firings | **0** | **54** |
| provenanceCompleteness | 100.0% | 100.0% (3135/3135) |

By failure category - the comparison that matters:

| Observed difference | Pairs | Before | After | Verdict |
|---|---|---|---|---|
| `case_only` | 24 | 0 | **24** | fixed |
| `suffix` | 29 | 0 | **29** | fixed |
| `abbreviation` | 9 | 0 | 0 | not addressed |
| `divergent` | 12 | 0 | 0 | unreachable by any name method |
| `transliteration` | 1 | 0 | 0 | not addressed, by design |

**53 of 53 of the two targeted classes, and nothing else moved.** That is what
"do not optimise beyond measured failures" looks like when it works.

### 3.1 The FULL regime is still 0/75, and that is structural

Normalisation changed nothing where no record carries an identifier, because
Tier B - either branch - can only match a mention *into a Tier-A cluster*, and
in FULL there are no Tier-A clusters at all. Two records with byte-identical
names still would not merge there.

This is a property of the tier structure, not of the normalisation rules, and it
is **not** fixed by this milestone. Clustering identifier-less mentions with each
other would be a new tier and a new class of risk; it was not approved and was
not built. It is question 1 in section 7.

### 3.2 The one false merge, stated plainly

`falseMergeRate 0.5%` is a single case: the Wikidata record for **Unipro**
attached to GLEIF's `UNIPRO` by normalised name.

That record is one of the two the ground truth marks `undetermined` - Wikidata
item Q188087 asserts **two** different LEIs, so no single subject can honestly be
claimed for it, and any merge is unverifiable. Scoring counts it as a false
merge, which is the conservative and correct accounting.

It is worth being precise about why it happened: the P6.15 identifier-authority
policy exists to catch exactly this record, and it does - it flags it
`ambiguous_identifier_conflict` and withholds it from Tier B. **But the masking
regime removes the identifiers, so there is no contradiction left to detect**,
and the name path merges it. Confirmed empirically: the unmasked GLEIF x
Wikidata cross-source run is byte-identical after this change -
`falseMergeRate 0.0% (0/27)`, and the `ambiguous_identifier_conflict` still
fires. So this is an artefact of the experiment's masking, not a live defect.

It is still a real lesson: **identifier-authority protection does not extend to
records that arrive without identifiers.** A record whose identifiers would have
contradicted each other is indistinguishable, to the name path, from one whose
identifiers agree.

## 4. Silent non-resolution (P6.17.2)

### Before

An uncorroborated mention became its own entity with
`resolutionType: "new_entity"`, `status: "resolved"`, and no warning. On the
no-identifier corpus that produced **257 `new_entity` / `resolved` decisions and
0 warnings** for a run that joined none of its 75 pairs. The output was
indistinguishable from a perfect one.

It was not only the experiment. The same defect was live on **Operation DarkNet
Delhi**, where 9 of 88 person mentions had never resolved to a corroborated
entity and the run reported no warnings at all. A unit test asserted
`warnings).toEqual([])` and passed - the defect was pinned as correct behaviour.

### After

`RESOLUTION_STATUSES` gains `unresolved`, and the two meanings that were sharing
`new_entity` are separated:

| Outcome | Type | Status |
|---|---|---|
| Established from its own identifier | `new_entity` | `resolved` |
| Merged on an exact name | `exact_name_match` | `resolved` |
| Merged on a normalised name | `normalized_name_match` | `resolved` |
| Name reached 2+ clusters | `ambiguous_name_conflict` | `ambiguous` |
| Normalised name reached 2+ clusters | `ambiguous_normalized_name_conflict` | `ambiguous` |
| Record contradicts itself on an identifier | `ambiguous_identifier_conflict` | `ambiguous` |
| **Nothing corroborated it** | **`unlinked_mention`** | **`unresolved`** |

The mention still becomes its own entity - nothing is ever dropped - but it is no
longer reported as a success.

**Evidence exposed, so a failed pair can be explained.** Each `unlinked_mention`
decision's `reason` names both keys that were searched:

> Not corroborated by any evidence available to this resolver. Its own evidence
> item states no mergeable identifier; no identifier-anchored organisation entity
> carries the exact name "Coal India"; and none carries the normalised name
> "coal india". Kept as its own entity so the mention is never dropped, but
> recorded as UNRESOLVED - this is not a confirmed new entity.

**One aggregate warning, not one per mention** - P6.11 removed 24 meaningless
warnings for exactly that reason:

> 9 of 88 person mention(s) did not resolve to any corroborated entity - no
> identifier evidence, no exact name match and no normalised name match. They are
> recorded as unlinked_mention / unresolved, NOT as confirmed new entities.

**Surfaced without a UI redesign.** `ResolutionSummary` gains
`decisionsByStatus` and `unresolvedDecisions`; `ResolvedEntityView` gains
`isUnresolved`; the summary panel reuses the existing ambiguous-note component
verbatim for an unresolved note. No new screen, no new concept.

### Measured effect on DarkNet Delhi

**All 21 metrics identical**, snapshot identical (61 entities, 191
relationships, `er.pairwise.precision` 100%, `er.mustNotMerge` 100%,
`rel.f1` 67.7%, `provenance.completeness` 100%). The nine mentions cluster
exactly as they did before. What changed is that the run now says so:
`unresolvedDecisions: 9`, one warning, nine `unlinked_mention` decisions.

This is the one place a P6.17 change altered DarkNet Delhi behaviour, and it is
reporting only - which is the bug genuinely affecting it, surfaced rather than
introduced.

## 5. Devanagari (P6.17.3)

### Source selected: Wikidata Hindi labels (SRC-001), CC0 1.0

**Why this is not "promoting an alias".** Wikidata's data model gives each item
**one label per language** plus separate aliases (`skos:altLabel`). Per
[Help:Label](https://www.wikidata.org/wiki/Help:Label), "the label is the most
common name that the item would be known by" - so the Hindi `rdfs:label` **is**
Wikidata's primary name for that item in Hindi. Our own adapter folds
`itemLabelHi` into this schema's single `aliases[]` field because
`PublicRecordContent` has one `name`. **That is a modelling artefact of our
adapter, not the publisher's classification**, and presenting the Hindi label as
`name` corrects it rather than promoting anything.

This reasoning is the part to disagree with if you disagree - flagged in
section 7.

- **Licence:** CC0 1.0, verified in the source registry (SRC-001, APPROVED).
- **Provenance:** no new collection was needed. The Hindi labels were already in
  the raw SPARQL payload collected and hashed for P6.16
  (`data/public/raw/SRC-001/2026-09-03T20-51-29-042Z`, `rawSha256`
  `657c11d624a36105...`, `direct-https`). **Nothing was fetched for this pilot.**
- **Nothing manufactured.** Every Devanagari string is Wikidata's own label. The
  English label is **dropped entirely** rather than kept as an alias, so no
  Latin form of the name reaches the resolver - otherwise the test would be
  meaningless.

### Bounded pilot

55 of 78 collected Wikidata items carry a Hindi label; all 55 have a GLEIF
counterpart. Corpus: **234 records, 54 positive pairs, 19 hard negatives.**

| Metric | Value |
|---|---|
| positivePairJoinRate | **1.9% (1/54)** |
| **transliteration pairs** | **51, joined 0, failed 51 (100%)** |
| case_only | 1, joined 1 |
| divergent | 2, joined 0 |
| hardNegativeFalseMergeRate | 0.0% (0/19) |
| falseMergeRate | 0.0% (0/233) |
| provenanceCompleteness | 100.0% (2927/2927) |

**The transliteration hypothesis is now tested, and it fails cleanly at N=51.**
P6.16 had a single incidental Japanese pair and could conclude nothing. Real
examples: `भारत हेवी इलेक्ट्रिकल्स लिमिटेड` / `BHARAT HEAVY ELECTRICALS LIMITED`,
`कोल इण्डिया` / `COAL INDIA LIMITED`, `एअर इंडिया` / `AIR INDIA LIMITED`.

This is the expected result, not a regression: normalisation deliberately does
not fold script. What the pilot establishes is the **size** of the gap - 51 real
pairs that no deterministic rule in section 1 can reach - which is the evidence
a decision about transliteration needs.

## 6. Aliases as match candidates (P6.17.4)

Measured, **not enabled**. `scripts/alias-evidence-study.ts` does not import the
resolver, run the pipeline or write a database; it replays the resolver's own
normalisation over the same corpus and reports what an alias-aware Tier B would
have decided.

| Question | Answer |
|---|---|
| **Recall** | 70.7% (53/75) name-only to **72.0% (54/75)** with aliases. **+1 pair.** |
| Pairs newly broken | 0 |
| **Precision** | 0 joined to the wrong subject; 0 became ambiguous |
| **False-merge risk** | **0 of 19** hard-negative pairs share a normalised key |
| **Ambiguity introduced** | 0 keys reach more than one subject (0 without aliases too) |

107 publisher-stated alias strings bought exactly **one** additional join:

```
POS-022  "Tata Motors Ltd"  ->  "TATA MOTORS PASSENGER VEHICLES LIMITED"
         via GLEIF's own alias "TATA MOTORS LIMITED"
```

And that one pair is the case P6.16 singled out as a **parent/subsidiary trap**:
the GLEIF record is the subsidiary, and treating it as `Tata Motors` may be wrong
in substance even though both publishers state the same LEI. So the sole measured
benefit of alias matching is the join whose correctness is most debatable.

**Provenance requirement, if it is ever enabled.** Alias rows already carry full
provenance. What alias *matching* would additionally require is that the decision
name **which alias string matched and which publisher stated it** - a merge
justified by an alias is only auditable if the alias is attributable. The study's
`via` field is the shape that reason text needs.

**Recommendation: do not enable.** One join for a whole new matching surface is a
poor trade, and this corpus contains only 107 alias strings and no shared trading
name - the risk profile that would actually bite is not represented here. Revisit
with a corpus that contains it.

## 7. What is established, and what needs your decision

**Established, on real data, reproducibly:**

1. Deterministic normalisation closes **both** classes it was aimed at, whole:
   24/24 capitalisation, 29/29 legal suffix. `positivePairJoinRate` 0.0% to
   **70.7%**.
2. It creates **no** false merges on the 19 hard negatives, and none on DarkNet
   Delhi (`er.mustNotMerge` 100%, `er.pairwise.precision` 100%, unchanged).
3. Silent non-resolution is fixed, and was live on DarkNet Delhi too (9 of 88).
4. Transliteration is now measured at **N=51** and fails **100%**.
5. Aliases would buy **+1 pair of 75** at zero measured risk on this corpus.
6. **22 of 75 pairs remain unjoined**: 9 abbreviation, 12 divergent, 1
   transliteration.

**Open, and needing a decision before more is built:**

1. **Tier B still needs an anchor.** The FULL regime is 0/75 and normalisation
   cannot help it. Clustering identifier-less mentions with each other is a new
   tier with a new risk profile. Build it, or accept that NetIntel resolves
   nothing in a corpus where no record carries an identifier?
2. **Devanagari.** 51 pairs, 100% failure, and no deterministic rule reaches
   them. The honest options are a transliteration table (ISO 15919 / ITRANS -
   deterministic and explainable, but a large rule set fitted to one script
   pair), or accepting Devanagari-Latin as out of scope for name matching and
   relying on identifiers. This is the first place where the evidence genuinely
   points at a learned method, and also the first place where a rule-based
   method would be a serious undertaking.
3. **Is the Hindi-label-as-primary-name reasoning acceptable?** Section 5 argues
   it corrects our adapter's modelling rather than promoting an alias. If you
   disagree, the Devanagari pilot should be rebuilt from a register that
   publishes Devanagari legal names natively - and I did not find one with
   verified open licensing during this milestone.
4. **Identifier-authority does not cover identifier-less records** (section 3.2).
   Worth deciding whether a record that *would* have been flagged is allowed to
   merge on its name when its identifiers are simply absent.
5. **Aliases** - recommendation is no; the decision is yours.

## 8. Does this justify moving toward ML?

**Not yet, and the evidence now says so more precisely than before.**

Of the 22 remaining unjoined pairs:

- **12 are `divergent`** - `INNOFIN SOLUTIONS PRIVATE LIMITED` / `LenDenClub`,
  `LIVING MEDIA INDIA LIMITED` / `India Today Group`. These are legal-name versus
  brand-name pairs. The strings share nothing. **No string method, no embedding
  and no amount of training data recovers these from the names alone** - the
  information is not in them. They need an identifier, a stated alias, or an
  external cross-reference.
- **9 are `abbreviation`** - `FLIPKART INDIA PRIVATE LIMITED` / `Flipkart`. These
  are reachable by a rule (token-subset or head-noun matching), and that rule is
  exactly what the hard-negative set was built to catch: `GVK` would match every
  `GVK ...` entity. This wants a careful deterministic rule with a re-measurement,
  not a model.
- **1 is transliteration** in the main corpus, **51** in the Devanagari pilot.
  This is the one class with both a real gap and a plausible learned solution.

So the case for ML is currently **one script-pair problem**, and even there a
deterministic transliteration table should be priced first. Nothing in the
abbreviation or divergent classes is improved by training. Recommendation:
resolve open questions 1-4 before any data-training preparation.

## 9. Reproducing this

```sh
npm test                                                                        # 612 tests
npm run evaluate                                                                # DarkNet Delhi, 21 metrics
node --import ./scripts/eval-resolve.mjs scripts/cross-source-experiment.ts      # GLEIF x Wikidata
node --import ./scripts/eval-resolve.mjs scripts/no-identifier-experiment.ts --regime full
node --import ./scripts/eval-resolve.mjs scripts/no-identifier-experiment.ts --regime anchored
node --import ./scripts/eval-resolve.mjs scripts/no-identifier-experiment.ts \
  --regime anchored --corpus evidence/no-identifier/devanagari-pilot
node --import ./scripts/eval-resolve.mjs scripts/alias-evidence-study.ts
```

Both experiment scripts accept `--db <path>` for checkouts on a filesystem where
SQLite cannot manage its own journal files.

**Corpus isolation is unchanged.** Operation DarkNet Delhi, the GLEIF-only pilot,
the GLEIF x Wikidata identifier evaluation, the no-identifier corpus and the
Devanagari pilot each keep their own evidence files, their own database and their
own reports. Nothing is mixed, and all four were re-run after this work.
