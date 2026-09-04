# P6.18 — Can the remaining real failures be solved deterministically, and is ML justified yet?

**Date:** 2026-09-04
**Corpora:** the P6.16 real no-identifier corpus (257 records) and the P6.17.3
Devanagari pilot (51 real Devanagari/Latin primary-name pairs)
**Resolver:** **NOT MODIFIED.** `src/lib/resolution/` is byte-identical to P6.17.
Everything below is measurement. Nothing is enabled.
**Ground truth:** read only, unmodified, in both corpora.

---

## 0. The question, and the shape of the answer

P6.17.1 took the real positive-pair join rate from 0% to 70.7% (53/75) with
deterministic normalisation alone. Twenty-two real pairs remained. The question
put to this phase was whether those 22 can be closed with deterministic evidence
before machine learning is justified.

The answer is that **13 of the 22 can**, at **zero measured cost** — no hard
negative merges, no false merges, no pair broken — taking the real join rate to
**66/75 (88.0%)**. Of the 9 that remain, **8 are not name problems at all** and
no model that reads names could solve them, and **1** is a second-script case.

The most useful finding is not a matching rule. It is that the single largest
recoverable group was closed by **asking an already-approved publisher for a
field it already publishes** — Wikidata's `P1448` "official name" — rather than
by inferring anything. The evidence was missing, not the algorithm.

---

## 1. The 22 remaining failures, individually

The corpus assigns each pair a `variation` label. Those labels are correct as
far as they go, but two of the three buckets turn out to be mixtures, and the
mixture is the whole point: three of the nine "abbreviation" failures are not
abbreviations, and five of the twelve "divergent" failures are reachable.

| # | Pair | GLEIF legal name | Wikidata label | Corpus label | What it actually is | Closed? |
|---|------|------------------|----------------|--------------|---------------------|---------|
| 1 | POS-064 | `ELSEVIER B.V.` | `Elsevier` | abbreviation | **Defect in the shipped rules.** `bv` IS in `LEGAL_SUFFIXES`, but punctuation folding splits `B.V.` into `b v` first, so the suffix can never match. | **Yes — R1** |
| 2 | POS-065 | `THE SUPREME INDUSTRIES LIMITED` | `Supreme Industries` | abbreviation | Leading definite article. | **Yes — R2** |
| 3 | POS-004 | `INNOFIN SOLUTIONS PRIVATE LIMITED` | `LenDenClub` | divergent | Brand vs legal name — **and Wikidata publishes the legal name** as `P1448`. | **Yes — R5** |
| 4 | POS-006 | `TRANSACTREE TECHNOLOGIES PRIVATE LIMITED` | `Lendbox` | divergent | Same; `P1448` = `Transactree Technologies Private Limited`. | **Yes — R5** |
| 5 | POS-029 | `SAKAL MEDIA PRIVATE LIMITED` | `Sakal Media Group` | divergent | "Group" vs the operating company; `P1448` = `Sakal Media Private Limited`. | **Yes — R5** |
| 6 | POS-009 | `HAIER APPLIANCES (INDIA) PRIVATE LIMITED` | `Haier India` | abbreviation | `P1448` = `Haier Appliances (India) Pvt Ltd`. | **Yes — R5** |
| 7 | POS-074 | `HACHETTE BOOK PUBLISHING INDIA PRIVATE LIMITED` | `Hachette India` | abbreviation | `P1448` = `Hachette Book Publishing India Private Limited`. | **Yes — R5** |
| 8 | POS-002 | `RAZORPAY SOFTWARE LIMITED` | `Razorpay` | abbreviation | Token-prefix containment (1 token). | **Yes — R3a** |
| 9 | POS-003 | `ARIHANT PUBLICATIONS (INDIA) LIMITED` | `Arihant Publications` | abbreviation | Token-prefix containment (2 tokens). | **Yes — R3a** |
| 10 | POS-010 | `FLIPKART INDIA PRIVATE LIMITED` | `Flipkart` | abbreviation | Token-prefix containment (1 token). | **Yes — R3a** |
| 11 | POS-035 | `SUN PHARMACEUTICAL INDUSTRIES LIMITED` | `Sun Pharmaceutical` | abbreviation | Token-prefix containment (2 tokens). | **Yes — R3a** |
| 12 | POS-047 | `GVK POWER & INFRASTRUCTURE LIMITED` | `GVK` | abbreviation | Token-prefix containment (1 token). **The case P6.17.1 explicitly refused.** See §4.2. | **Yes — R3a, with caveat** |
| 13 | POS-022 | `TATA MOTORS PASSENGER VEHICLES LIMITED` | `Tata Motors Ltd` | divergent | Token-prefix containment — but see §4.3: **this is the parent/subsidiary trap, and the join is substantively debatable even though it scores correct.** | **Yes — R3a, disputed** |
| 14 | POS-001 | `IIT-IAN'S PACE EDUCATION PRIVATE LIMITED` | `PACE IIT & Medical` | divergent | Shared tokens, reordered and reduced. No published bridge. | No |
| 15 | POS-019 | `LIVING MEDIA INDIA LIMITED` | `India Today Group` | divergent | Brand vs legal name. No `P1448`. | No |
| 16 | POS-020 | `EARLY MAKERS GROUP` | `Emlyon Business School` | divergent | `P1448` exists but equals the **Wikidata** label, not GLEIF's. Publishing the field does not guarantee it bridges. | No |
| 17 | POS-023 | `ULTRAVIOLET TECH PRIVATE LIMITED` | `Paytm` | divergent | **Suspected publisher-data issue** — see §4.4. Not corrected here. | No |
| 18 | POS-030 | `ORAVEL STAYS LIMITED` | `OYO Rooms` | divergent | Brand vs legal name. No `P1448`. | No |
| 19 | POS-032 | `GATEWAY TECHNOLABS PRIVATE LIMITED` | `Gateway Group of Companies` | divergent | Group vs operating company. | No |
| 20 | POS-033 | `NEW DELHI TELEVISION LIMITED` | `NDTV` | divergent | **Acronym of the expansion.** Not a containment case: `ndtv` is not a token prefix of `new delhi television`. | No |
| 21 | POS-046 | `GMR AIRPORTS LIMITED` | `GMR Group` | divergent | Group vs operating company. | No |
| 22 | POS-039 | `日本ペイントホールディングス株式会社` | `Nippon Paint` | transliteration | Japanese; the only non-Devanagari script case. | No |

**Reclassification, in one line each.** The corpus's nine "abbreviations" are
really *one shipped-rule defect* (POS-064), *one leading article* (POS-065),
*two publisher-name-availability cases* (POS-009, POS-074) and *five genuine
containment cases*. The corpus's twelve "divergent" names are really *three
cases where the publisher states the legal name and it matches* (POS-004,
POS-006, POS-029), *one where it states it and it does not* (POS-020), *three
group/subsidiary relationships* (POS-022, POS-032, POS-046), *four true brand
names with no published bridge* (POS-001, POS-019, POS-030 and the disputed
POS-023) and *one acronym-of-expansion* (POS-033).

---

## 2. Method, and why the harness is trustworthy

`scripts/deterministic-evidence-study.ts` and `scripts/transliteration-study.ts`
follow the P6.17.4 pattern exactly: **they import no resolver, run no pipeline
and write no database.** They replay the resolver's own
`normalizeName` over the same real corpora and report what each candidate rule
*would* have decided.

Three properties make the numbers worth reading:

1. **Cost is measured, not assumed.** Every rule is scored over all 257 records
   — 32,896 candidate pairs — not merely over the 22 it is meant to fix. A
   proposed merge is *correct* when the two records share an LEI in the ground
   truth and a *false merge* when they do not.
2. **Merges are unioned.** Clustering is union-find in the resolver, and
   transitivity is where one bad edge does its damage, so the study unions too.
3. **The harness validates itself before any delta is read.** The baseline rule
   — today's Tier B2 — must reproduce the independently measured 53/75 or the
   run declares itself invalid. It reproduces it exactly.

```
HARNESS VALIDATION: baseline reproduces 53/75 (measured P6.17.1 value 53/75) -> VALID
```

---

## 3. Additional evidence: what exists, what does not

Before designing any rule, the corpus was audited for evidence *other than the
name*. The result reframes the problem.

| Field | GLEIF (179 records) | Wikidata (78 records) |
|---|---|---|
| `name` | 179 | 78 |
| `aliases` | 48 | 54 |
| `identifiers` | 179 | 0 *(masked by the anchored regime)* |
| `jurisdiction` | 179 | **0** |
| `status` | 179 | **0** |
| `observedAt` | 179 | **0** |

**Corroborating attributes are structurally unavailable across the pair.** Every
non-name field that might confirm a candidate match is published by one side
only. Jurisdiction, status and observation date cannot corroborate anything,
because there is nothing on the Wikidata side to corroborate against.

This matters for a reason that is easy to miss: **corroboration does not
generate candidates, it only validates them.** Even if both sides carried
jurisdiction, it would not join `ORAVEL STAYS LIMITED` to `OYO Rooms` — it would
only help confirm a join something else proposed. For the divergent class the
missing thing is a *linking claim*, not a confirming attribute.

So the question became: does an approved source already publish a linking claim?

### 3.1 The availability probe

Wikidata's SPARQL adapter requests `?item ?itemLabel ?itemLabelHi ?lei` and
nothing else. Wikidata publishes considerably more, including **`P1448` official
name** — a publisher's own statement of the legal name behind a brand, which is
exactly the bridge the divergent class needs.

A bounded availability probe was run over **exactly the 78 items already in the
corpus** — their QIDs recovered from the *stored* raw SPARQL payload
(`SRC-001/2026-09-03T20-51-29-042Z`), so **no item was discovered and the
collection was not broadened**. Result:

| Property | Items carrying it | Coverage |
|---|---|---|
| `P1448` official name | 8 | **10.3%** |
| `P1813` short name | 3 | 3.8% |

Provenance is recorded honestly in
`evidence/no-identifier/wikidata-official-name-probe.json`, including the caveat
that matters:

> Retrieved through the session's cloud container because this session's local
> runtime has **no egress** (DNS resolves, TCP times out). The content is the
> publisher's; the bytes are **not** hashed as publisher wire bytes and this
> probe is therefore **not admissible as collected evidence**. It is an
> availability measurement only.

Promoting this to corpus evidence requires re-collection through
`scripts/collect-public.ts` on the `direct-https` path — a query change, not a
code change, and the P6.7 `retrievalChannel` machinery already exists to label
it. **That is the single most valuable next action in this whole analysis.**

---

## 4. The bounded abbreviation experiment

`node --import ./scripts/eval-resolve.mjs scripts/deterministic-evidence-study.ts`

| Rule | Joined | Δ | Newly joined | Hard-neg merges | False merges |
|---|---|---|---|---|---|
| baseline (shipped) | 53/75 (70.7%) | — | — | 0/19 | 0 |
| **R1** dotted legal form | 54/75 (72.0%) | +1 | POS-064 | 0/19 | 0 |
| **R2** leading article | 54/75 (72.0%) | +1 | POS-065 | 0/19 | 0 |
| **R1+R2** | 55/75 (73.3%) | +2 | POS-064, POS-065 | 0/19 | 0 |
| R4 trailing geographic token | 55/75 (73.3%) | +2 | POS-003, POS-010 | 0/19 | 0 |
| R3a prefix containment, any length | 61/75 (81.3%) | +8 | 8 pairs | 0/19 | 0 |
| R3a prefix containment, ≥2 tokens | 57/75 (76.0%) | +4 | 4 pairs | 0/19 | 0 |
| **R3b unordered subset, any length** | 64/75 (85.3%) | +11 | 11 pairs | **1/19** | **1** |
| **R3b unordered subset, ≥2 tokens** | 60/75 (80.0%) | +7 | 7 pairs | **1/19** | **1** |
| **R5** publisher official name | 58/75 (77.3%) | +5 | POS-004/006/009/029/074 | 0/19 | 0 |
| **COMBINED** R1+R2+R5 (no containment) | 60/75 (80.0%) | +7 | 7 pairs | 0/19 | 0 |
| **COMBINED_all** R1+R2+R5+guarded R3a | **66/75 (88.0%)** | **+13** | 13 pairs | **0/19** | **0** |

### 4.1 Ordered containment is materially safer than unordered

The hard-negative set earns its keep here. **Unordered token subset breaks
NEG-013** — `BHATI SOLAR SOLUTIONS PRIVATE LIMITED` is a subset of `RAJDEEP
BHATI SOLAR SOLUTIONS PRIVATE LIMITED`, two distinct LEIs — at *both* length
thresholds. **Ordered prefix containment does not**, because the hard negatives
diverge at their second token (`BHARAT HEAVY ELECTRICALS` vs `BHARAT DYNAMICS`)
and neither is a complete prefix of the other. A minimum-token floor does **not**
fix unordered subset; ordering does. That distinction is invisible without the
19 real hard negatives.

### 4.2 Why "zero measured cost" is not "zero risk" — the honest caveat

Prefix containment produced **8 relations in the entire 257-record corpus, and
all 8 are true positives.** That is a fact about *this corpus*, not a
demonstration that the rule is safe. Two measurements say why:

- **12 of 175 distinct leading tokens (6.9%) already span more than one
  subject** — `tata` reaches 4 subjects, `bharat` 3, `hindustan`, `navneet`,
  `sun`, `shree`, `raj` and others 2. The trap is present at 257 records and
  gets denser as the corpus grows.
- It simply does not intersect the four single-token cases: no sibling `GVK …`,
  `Razorpay …`, `Flipkart …` or `Elsevier …` entity exists here. **`GVK` is a
  prefix of every `GVK …` entity that exists in the world**, which is precisely
  why P6.17.1 refused subset matching.

The rule is therefore only admissible **with the uniqueness guard**: a shorter
name that prefixes more than one *subject* must be flagged
`ambiguous_normalized_name_conflict` rather than merged, reusing the machinery
Tier B2 already has. With the guard in place the measured result is unchanged
(61/75, 0 false merges) —

> **and that is itself a caveat: the guard suppressed 0 relations, so it is
> correct by construction but entirely unexercised by this corpus.** No
> measurement here demonstrates that the ambiguous branch works on real data.

### 4.3 POS-022 is a disputed win, and should be counted as one

`Tata Motors Ltd` → `TATA MOTORS PASSENGER VEHICLES LIMITED` scores as correct
because both publishers state the same LEI. But TMPV is a *subsidiary* of Tata
Motors, and P6.17.4 flagged this exact pair as "the join whose correctness is
most debatable". Prefix containment reaches it for the wrong reason. **One of
the 13 gained joins is substantively disputed**, and an owner may reasonably
decide 65/75 is the honest number.

### 4.4 POS-023 is a suspected publisher-data issue, not corrected

Wikidata's `Paytm` item states an LEI that GLEIF assigns to `ULTRAVIOLET TECH
PRIVATE LIMITED`. This resembles the 15.4% Wikidata identifier error rate P6.14
measured. **Ground truth was not edited** — editing truth to flatter a resolver
is circular, and the same discipline was applied in P6.15.1. It is recorded for
owner verification.

---

## 5. The bounded transliteration experiment

`node --import ./scripts/eval-resolve.mjs scripts/transliteration-study.ts`

Run over the **51 real Devanagari/Latin primary-name pairs** from P6.17.3. A
deterministic Devanagari→Latin table was implemented (independent vowels,
matras, consonants, nukta forms, virama, anusvara; word-final schwa deletion),
plus a decoder for English letter-names written in Devanagari
(`एसबीआई` → `sbi`). **Nothing was manufactured**: every Devanagari string is
Wikidata's own `rdfs:label@hi` and every Latin string is GLEIF's own legal name.

| Strategy | Joined | Hard-neg merges | False merges |
|---|---|---|---|
| S0 shipped normalisation | 0/51 (0.0%) | 0/19 | 0 |
| S1 + deterministic transliteration | 1/51 (2.0%) | 0/19 | 0 |
| S2 + English-letter-name decoding | **2/51 (3.9%)** | 0/19 | 0 |
| S3 + Hindi medial schwa deletion | 2/51 (3.9%) | 0/19 | 0 |

**This is the sharpest result in the phase.** The transliterator works — it
produces recognisably correct Latin — and it still joins almost nothing, because
**transliteration converts a script problem into a spelling problem, and exact
matching cannot close a spelling gap by construction.**

The residual splits cleanly, and the split is the finding:

- **13 of 49 unjoined pairs are within edit distance 3** of the Latin key:
  `ashok leland`/`ashok leyland` (d=1), `mahindra end mahindra`/`mahindra and
  mahindra` (d=1), `bank of barauda`/`bank of baroda` (d=2), `tata
  starbaks`/`tata starbucks` (d=2), `aiksis bank`/`axis bank` (d=3). These are
  *the same name*, spelled differently.
- **36 of 49 are beyond edit distance 3** and are not transliterations at all:
  `भारतीय इस्पात प्राधिकरण` is *translated* — "Steel Authority of India" — and no
  amount of script folding reaches a translation.

Edit distance is reported here **only to characterise the residual**. Nothing in
the study merges on it, and no fuzzy rule is proposed.

One negative result worth recording: **medial schwa deletion was implemented,
measured and gained nothing** (and a first, buggier version made the output
strictly worse). Hand-tuning the table past the obvious rules stopped paying.
That the returns went flat is evidence that the residual is *lexical*, not
rule-shaped.

---

## 6. Divergent names, analysed separately

No name-only match was forced. Of the twelve:

- **Three are solved by a publisher's own claim** (POS-004, POS-006, POS-029) —
  not by inference, and at zero cost.
- **One publishes the claim and still does not bridge** (POS-020): `emlyon
  business school` is not `EARLY MAKERS GROUP`. Availability ≠ sufficiency.
- **Three are group/operating-company relationships** (POS-022, POS-032,
  POS-046). These are the ones to be most careful about: the ground truth says
  one subject because both publishers state one LEI, but "GMR Group" and "GMR
  Airports Limited" are not obviously the same legal person. **Joining them on
  name similarity would be right for the wrong reason.**
- **Four are true brand-vs-legal-name pairs with no published bridge**
  (POS-001, POS-019, POS-030, and the disputed POS-023). `ORAVEL STAYS LIMITED`
  and `OYO Rooms` share **not one character**. No model that reads these two
  strings can relate them, because the relationship is not in the strings. It is
  a fact about the world, and it has to come from a source.
- **One is an acronym of its own expansion** (POS-033, `NDTV` / `NEW DELHI
  TELEVISION LIMITED`). Deterministically tempting and deliberately not
  attempted: `NDTV` takes two letters from "TeleVision", so any rule general
  enough to derive it would also derive a great many wrong initialisms. It wants
  a published `P1813` short name — which Wikidata does not carry for this item —
  not a generator.

---

## 7. Before / after, hard negatives, and regression

| Metric (anchored regime, 75 real pairs) | P6.17 shipped | Best measured deterministic | Change |
|---|---|---|---|
| `positivePairJoinRate` | 53/75 — **70.7%** | 66/75 — **88.0%** | **+13 pairs** |
| `hardNegativeFalseMergeRate` | 0/19 — 0.0% | 0/19 — **0.0%** | unchanged |
| corpus-wide false-merge components | 0 | **0** | unchanged |
| false name edges proposed | 0 | **0** of 70 | unchanged |
| pairs broken by a new rule | — | **0** | — |
| components (ground truth 182) | 203 | 190 | −13 |
| Devanagari pairs joined | 0/51 | 2/51 | +2 |

**Nothing was enabled, so nothing regressed.** `src/lib/resolution/` is
byte-identical to P6.17 (verified by directory diff), and therefore:

- **`npx vitest run` — 612/612 passing**, unchanged.
- **DarkNet Delhi — all 21 metric values identical.**
- **GLEIF × Wikidata cross-source — identical.**
- **No-identifier FULL and ANCHORED — identical.**
- `tsc --noEmit` clean, `eslint` clean.

### 7.1 Two environment findings worth recording

1. **The evaluation report is not byte-reproducible.** Two consecutive
   `npm run evaluate` runs on *identical code* differ in
   `corroboration.spatial.recall` and `corroboration.temporal.recall`: the same
   location is recovered, but the reported `findingId` and sometimes
   `findingType` swap between two overlapping findings (`spatial_co_location` /
   `repeated_spatiotemporal_overlap`). **All 21 metric values are stable**, so
   this is not a correctness defect — but "the report is identical" is currently
   too strong a regression check, and only "the metric values are identical"
   holds. Pre-existing; not introduced here.
2. **The repository cannot run its own test suite in place.** SQLite fails with
   `disk I/O error` on the synced folder, so 52 of 612 tests fail for purely
   environmental reasons. Work was done on a scratch copy on the same machine,
   outside the mount, where all 612 pass. Worth a line in the README.

---

## 8. Provenance and licensing

| Source | Registry id | Licence | Channel | Status |
|---|---|---|---|---|
| GLEIF LEI records | SRC-002 | CC0 1.0 | `direct-https`, raw payloads hashed | APPROVED, unchanged |
| Wikidata SPARQL | SRC-001 | CC0 1.0 | `direct-https`, raw payloads hashed | APPROVED, unchanged |
| Wikidata `P1448`/`P1813` probe | SRC-001 | CC0 1.0 | **`agent-relay` — NOT admissible as collected evidence** | availability measurement only |

No new source was introduced, no registry entry changed, no collection
broadened: the probe covered exactly the 78 items already in the corpus, whose
QIDs came from a payload already on disk. Real, synthetic and DarkNet Delhi
corpora remain in separate evidence directories, databases and report
directories, and nothing in this phase touched the synthetic or DarkNet corpora
at all.

---

## 9. ML GO / NO-GO

### **NO-GO.** Machine learning is not justified by the current evidence.

The recommendation is not "ML never". It is that **every measurement taken here
points at missing data rather than a missing model**, and that a decision to
train would currently be made on 22 examples with no labels for the thing a
model would have to learn.

**Four reasons, in the order they matter.**

1. **The largest recoverable group was closed by a publisher's own claim, not by
   inference.** `P1448` closed 5 of 22 at zero cost, and it is available for only
   10.3% of items *as currently queried*. Raising that coverage is a query
   change. Training a model to guess what a source already states, for the 90% of
   items where nobody has asked, is the wrong order of work.
2. **Deterministic rules reach 88.0% with zero false merges.** One of the 13 wins
   is a defect fix that had been mislabelled as a semantic failure for two
   phases. A model would have had to learn what a one-line correction to a suffix
   list achieves.
3. **8 of the 9 remaining failures are not name problems.** `ORAVEL STAYS
   LIMITED` and `OYO Rooms` share no character; three more are
   group/subsidiary relationships where a name-based join would be *wrong* even
   when it scores right. **No model reading these strings can succeed, because
   the information is not in the strings.** Training on them would teach a model
   to guess confidently.
4. **There are no labels for the one class where a model would plausibly help.**
   The transliteration residual is 13 real pairs. That is an evaluation set, not
   a training set — and using all 13 to train leaves nothing to measure with.

### The one place a GO could become defensible

**Transliteration spelling-variant matching**, and only that. It is the single
class with both a demonstrated gap (49/51 unjoined after honest deterministic
effort) and a plausible learned solution, and the deterministic ceiling was
probed and found flat. Before it could be approved, three things are missing:

- **Labelled data at usable scale.** 13 near-miss pairs is two orders of
  magnitude short. A transliteration pair list would have to be *collected*, from
  a licence-compatible source, and it must not be built by generating variants —
  P6.16's whole discipline is that variants are never manufactured.
- **A held-out set that is not the evaluation set.** These 51 pairs are the only
  real measurement instrument the project has for script variation. Training on
  them destroys it.
- **A decision about auditability.** Every merge this system makes currently
  names the transformations that justified it. A learned matcher returns a score.
  Deciding what an investigative decision row says when the evidence is "the
  model was confident" is a **product** decision that should precede any
  training, not follow it.

### What is still missing (the NO-GO list)

1. **`P1448` / `P1813` at full coverage, re-collected on `direct-https`.** The
   highest-value item by a distance. Query change only.
2. **GLEIF fields the adapter already receives but drops** — legal and
   headquarters address, registration authority and entity category. These
   corroborate a candidate; they do not generate one, and that limit should be
   stated when they are added.
3. **A corpus containing the containment trap.** No `GVK …` sibling exists here,
   so the uniqueness guard is unexercised. Until a corpus contains one, prefix
   containment's safety is argued rather than measured.
4. **A parent/subsidiary policy decision.** POS-022, POS-032 and POS-046 are not
   a matching problem. Someone has to decide whether "GMR Group" and "GMR
   Airports Limited" are one entity for this system's purposes — the answer
   changes what "correct" means, and no model can be trained before it is fixed.
5. **A licence-compatible transliteration pair list**, if and only if the
   transliteration GO is ever taken.

---

## 10. Next required approval

**Nothing in this phase changed behaviour, and nothing should be enabled without
a decision.** Following the P6.15 → P6.15.1 precedent, the following are
*proposed*, in descending order of value and ascending order of risk:

| # | Proposal | Gain | Measured cost | Risk |
|---|---|---|---|---|
| 1 | Re-collect Wikidata `P1448`/`P1813` on `direct-https` and carry official name as publisher-stated evidence | +5 pairs | 0 | Low — a publisher's own claim, its own decision type and confidence, attributable in the decision row |
| 2 | **R1** — strip a trailing dotted legal form (`B.V.` → `bv`, already in the suffix list) | +1 | 0 | **Very low — this is a defect fix, adding no new knowledge** |
| 3 | **R2** — strip a leading definite article | +1 | 0 | Very low |
| 4 | **R3a** — token-prefix containment **with the uniqueness guard**, at its own confidence below `normalized_name_match` | +6 | 0 measured | **Medium — the guard is unexercised, and 6.9% of leading tokens already span multiple subjects** |
| 5 | Parent/subsidiary policy | — | — | Decision, not code |

**Recommended:** approve 1, 2 and 3 — all zero-cost, and #2 is a defect. Treat
#4 as a separate decision requiring a corpus that contains the trap. Take #5
before either.

**Not proposed, explicitly:** unordered subset matching (breaks NEG-013), the
trailing-geography rule (zero measured cost but it would strip the country from
`BANK OF INDIA`, and 174 of 179 GLEIF records are Indian, so the token is nearly
non-discriminative here), alias-as-merge-evidence (P6.17.4 recommendation
stands), edit-distance matching, and any ML.

**No ML training has begun, and none should begin on this evidence.**
