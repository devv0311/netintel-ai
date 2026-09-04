# P6.26 — the cross-border gap: cause, fix, and what the fix cost

The P6.25 model card recorded two generalisation failures and named a
cause for them. This is the record of testing that cause, correcting it
with real data, and measuring the result on an instrument that had seen
none of it.

**The headline: the fix works, and it is not shipped.** The cross-border
gap closed from 5.1% to 46.2% on a genuinely untouched test, and the same
model lost 5.6 points on the majority class and acquired a worse class of
false merge. On the project's stated objective the P6.25 model is still
the better one.

---

## 1. The stated cause was wrong

The model card attributed the gap to a semantic mismatch: GLEIF publishes
the jurisdiction of *incorporation*, Wikidata's P17 is the country an
entity is *associated with*, and `jurisdictionCountryConflict` (weight
−1.12) reads a legitimate offshore-incorporation pair as evidence against
identity. The proposed fix was to distinguish the two properties at
collection time.

GLEIF already publishes both — `entity.jurisdiction` and
`headquartersAddress.country` — in raw payloads already committed to this
repository, so the hypothesis was testable without collecting anything.
Measured on the v2 training and validation partitions:

| | |
| --- | --- |
| Records where HQ country ≠ incorporation country | 26 of 1,920 (1.4%) |
| gleif×wikidata positives with a country conflict | 17 of 642 |
| ...that comparing HQ country instead would resolve | **1** |

One pair. The semantic mismatch is real, and it is not what was causing
the failure.

## 2. The actual cause is distributional

The same partitions, asked the question the model actually faces:

| | v2 train+validation |
| --- | --- |
| P(positive \| both publishers state the SAME country) | 47.0% (652/1,388) |
| P(positive \| they state DIFFERENT countries) | **1.0%** (26/2,665) |
| Likelihood ratio | **48×** against identity |

The model learned that a country conflict is near-decisive evidence
against identity, and on that training set it was *right*. Cross-border
positives were 3.8% of positives; there were 26 of them. A weight of
−1.12 is the correct inference from that corpus and the wrong one about
the world.

## 3. The fix: real cross-border positives, collected on purpose

34 country queries chosen for a structurally high rate of foreign
incorporation — offshore holding regimes, shipping flags, EU holdcos —
and deliberately disjoint from the eight countries the P6.25 final test
was drawn from. Wikidata first; every LEI it returned then resolved
against GLEIF, so each label rests on identifier agreement and never on
the country or the name.

**3,809 new Wikidata records, 3,732 cross-source positive candidates, 340
of them cross-border** — against 26 in the whole of v2's train and
validation. Real cases, not constructed ones: NetEase (Cayman
incorporation, Chinese operations), Tencent (KY/CN), China Mobile
(HK/CN), Elsevier (NL/IT), Shangri-La Asia (BM/CN).

Corpus v3: **10,055 scorable records** (v2: 3,290), **5,139 cross-source
positives** (1,711), 1,774 curated hard negatives (477), 154
jurisdictions (126). Every subject of the P6.25 frozen test is excluded
at the record level, and that test's collection runs are absent from v3's
pin entirely — both routes closed, not one. Leakage **PASS 13/13**.

The distribution moved, and it did not move all the way:

| | v2 | v3 |
| --- | --- | --- |
| Cross-border share of positives | 3.8% | 7.7% |
| P(positive \| cross-border) | 1.0% | 1.8% |
| Likelihood ratio against identity | 48× | **33×** |

It cannot move much further by collection alone. Sampled negatives are
drawn across the corpus, and in a 154-jurisdiction corpus a random pair
is nearly always cross-border, so the negative side grows with the
positive side.

## 4. Model selection reversed again

On v3's validation partition, gradient-boosted trees beat logistic
regression 66.4% to 56.6% recall. That is the second reversal: GBDT won
in P6.24 on 1,044 training pairs, logistic regression won in P6.25 on
3,121, and GBDT wins again here on 9,304. The ordering is a function of
training-set size, not a property of the problem, which is the argument
for re-running the ladder every time the corpus changes rather than
inheriting a previous winner.

`E5-ablation-no-jurisdiction` scores 30.5% against E2's 56.6%: the
jurisdiction features carry a large part of the signal, which is why
getting their distribution right mattered enough to collect for.

## 5. Final frozen test #2

The P6.25 test could not judge this work. Its breakdown is what
identified the cross-border gap, so collecting data against that gap made
it a development instrument, whatever its leakage status.

Test #2 is 40 country queries disjoint from every prior collection,
excluding every subject appearing in v1, v2, v3 or the P6.25 test.
**16,675 pairs, 1,792 positives, 716 curated hard negatives, 1,794
subjects**, leakage **PASS 13/13** — including L13, which reports **0
subjects fitted on by any earlier build**.

Both models scored once:

| | P6.25 model (v2, shipped) | P6.26 model (v3) | Deterministic |
| --- | --- | --- | --- |
| Positive recovery | **1,464/1,792 (81.7%)** | 1,382/1,792 (77.1%) | 346/1,792 (19.3%) |
| Precision | 98.1% | **98.2%** | 97.5% |
| False merges, total | 28 | **25** | 9 |
| ...curated hard negatives | 25/716 (3.49%) | **20/716 (2.79%)** | 9/716 (1.26%) |
| ...**unrelated pairs** | **0** | **5** | 0 |
| **Cross-border positives** | 2/39 (5.1%) | **18/39 (46.2%)** | 19/39 (48.7%) |
| **edgar × wikidata** | 13/26 (50.0%) | **16/26 (61.5%)** | 15/26 (57.7%) |
| Same-country positives | **83.4%** | 77.8% | 18.3% |

**Both documented gaps are fixed, and the fix replicated on data chosen
for none of it.** Cross-border recovery went from 5.1% to 46.2%, within
2.5 points of the deterministic resolver; edgar×wikidata went from below
the resolver to above it. The P6.25 model's independently re-measured
5.1% confirms the model card's 5.7% was not an artefact of one test.

## 6. Why it is not shipped

Two reasons, both measured.

**It recovers 82 fewer real pairs.** Cross-border positives are 39 of
1,792. Same-country positives are 1,740, and v3 gives up 5.6 points
there. The stated objective is to maximise real positive-pair recovery at
low false-merge risk; v3 trades 82 recoveries for 3 fewer false merges.

**Its false merges are qualitatively worse.** All 28 of the P6.25 model's
are corporate-family pairs — entities that genuinely are related. Five of
v3's 25 are pairs with no relationship at all:

| | |
| --- | --- |
| `Sabiedrība ar ierobežotu atbildību "AKZ"` | `Frigate AS` (0.9922) |
| `SIA ''POLYSTYLEX''` | `Sabiedrība ar ierobežotu atbildību "CHEMEX"` (0.9912) |
| `Vértesi Erőmű Zártkörűen Működő Részvénytársaság` | `Ganz-Skoda Electric` (0.9801) |

The mechanism is visible in the names. `Sabiedrība ar ierobežotu
atbildību` is Latvian for "limited liability company" and Latvian GLEIF
records carry the form spelled out inside the legal name. The trees read
thirty characters of shared boilerplate as name agreement. Logistic
regression does not, and neither does the normaliser's suffix handling,
which strips `SIA` but not its expansion.

Merging a parent with its subsidiary is a question this project has not
answered (P6.21.2). Merging a Latvian chemicals company with a Norwegian
one because both are limited companies is not a question; it is a defect.

## 7. What this leaves

- **The shipped model is unchanged.** `cipher-er-pair-classifier` v2.0.0,
  weightsDigest `6948e6bc…`, advisory, deterministic resolution
  authoritative.
- **The cross-border fix is proven and available.** Corpus v3, its model
  and every report are committed and reproducible; the work to ship it is
  to recover the same-country recall it costs, not to re-find the fix.
- **A concrete next step, not a speculation.** Normalise spelled-out
  legal forms (`Sabiedrība ar ierobežotu atbildību` → `SIA`,
  `Zártkörűen Működő Részvénytársaság` → `Zrt.`) so no model can read a
  legal form as a name. That is a normaliser change, it is testable
  against the existing corpora, and it would remove the specific defect
  that disqualified v3 here.
- **Measuring the result of that work needs a third fresh test.** Test #2
  has now been read. It is frozen and spent for selection purposes, and
  saying so is cheaper than pretending otherwise.
