# P6.27 — The evaluation protocol, and what every dataset is allowed to be used for

**Phase:** P6.27
**Data class:** REAL. GLEIF (SRC-002, CC0 1.0), Wikidata (SRC-001, CC0 1.0), SEC EDGAR (SRC-006, public domain).
**Resolution semantics changed:** **NONE.** `src/lib/resolution/` is byte-identical to `af22018`.
**ML status:** advisory only. No resolver code path calls the model.

This document exists because the project reached a state where the honest
answer to *"has this model been measured on unseen data?"* had become **no**,
and nothing in the repository said so.

---

## 1. Why a third test

The P6.25 and P6.26 frozen tests were both built correctly and both passed
their leakage suites. Neither is a fresh instrument any more, and the reason
is the same in both cases: **they were read.**

A frozen test stops being frozen the moment a development decision is taken
because of what it said. Leakage suites cannot see this. L1–L13 ask whether a
subject crossed a partition boundary; they cannot ask whether a human read a
breakdown and then went and collected data against it. That second failure is
the one that actually happened here, twice, and both times it was recorded
honestly in the ledger — P6.26.4 says it in as many words: *"test #2 has now
been read and is spent for selection."*

So the classification below is not a formality. It is the reason a third test
had to be collected rather than reusing one that still reports PASS 13/13.

---

## 2. Every dataset, classified

| Dataset | Partitions | Class | Why |
|---|---|---|---|
| `evidence/ml/pair-dataset.json` (v1) | train / validation / test | **TRAIN** | P6.24 fitted the v1 model on it. Its test partition is historical, not fresh. |
| `evidence/ml/pair-dataset-v2.json` (v2) | train / validation / test | **TRAIN + SELECTION-EXPOSED** | The shipped model is fitted on it. Its held-out partition additionally **informed feature design** — its false merges were read in P6.25 and two features were added in response. Model selection used the validation partition, as intended. |
| `evidence/ml/pair-dataset-v3.json` (v3) | train / validation / test | **TRAIN + CORPUS-DESIGN-EXPOSED** | Collected in P6.26 *specifically to close the cross-border gap that the P6.25 frozen test had revealed*. The corpus itself is a response to a measured failure, which is legitimate for training data and disqualifying for test data. |
| `evidence/ml/pair-dataset-final-test.json` (frozen test #1) | test only | **SELECTION-EXPOSED — SPENT** | Frozen and scored once in P6.25, correctly. Then in P6.26 its breakdown was read, the 5.7% cross-border recall was diagnosed from it, and v3's entire collection strategy was designed against it. It is now a development instrument. |
| `evidence/ml/pair-dataset-final-test-2.json` (frozen test #2) | test only | **SELECTION-EXPOSED — SPENT** | Frozen and scored once in P6.26, correctly, on both models. Then it was used to **choose v2 over v3** and to characterise v3's false merges. Choosing between two models on a test set is selection. |
| `evidence/ml/pair-dataset-v4.json` (v4) | train / mining | **TRAIN** | The training half of the P6.27 sweep. Used ONLY to mine the legal-form vocabulary and token document frequencies; no model is fitted on it. Subject-disjoint from test #3 by construction. |
| `evidence/ml/pair-dataset-final-test-3.json` (frozen test #3) | test only | **SELECTION-EXPOSED - SPENT** | Was the untouched instrument. Scored once, on 2026-09-08, on three models, and used to decide KEEP V2 (see `ml-final-test-3.md`). Reading it spent it. It must never again be quoted as unseen. |
| `evidence/ml/pair-dataset-final-test-4.json` (frozen test #4) | test only | **SELECTION-EXPOSED — SPENT** | Declared in `evidence/final-test-4/collection-declaration.json`, collected after the candidate was frozen, scored once on 2026-09-09 on two models and used to decide SHIP E2 (see `ml-final-test-4.md`). Reading it spent it. |

**Consequence, stated plainly:** at the start of P6.27 the project had **no
untouched instrument**. Every number it could quote came from data that had
either been fitted on or read. P6.27 closed that gap by building test #3 - and
then spent it, deliberately and in one shot, to make the KEEP V2 decision.

**So the gap is open again, and that is not a failure of the process but its
price.** A frozen test is consumed by the decision it informs. The project is
back to having no untouched instrument, which is the honest state after any
model decision, and the next one costs a fourth test.

> **Appended at P6.30.** That fourth test was built and spent: P6.28 declared it
> before collection, collected it before scoring, and read it once to decide
> SHIP E2 — the model that now ships (`ml-final-test-4.md`). The table above
> classifies it. **The state today is the one this section describes: there is no
> untouched instrument, and a fifth model decision costs a fifth test.** P6 ML is
> closed, so none is planned. This document's title says P6.27 because that is
> when the protocol was written; the protocol itself is not phase-scoped and
> governs every dataset in the project.

---

## 3. How test #3 is built

Four rules, all of which are checkable from the repository rather than taken
on trust.

**3.1 The country list is declared before collection.**
`evidence/final-test-3/country-declaration.json` is committed in its own
commit, *ahead* of the commit that adds the collected runs. The ordering is
provable from `git log`. The list is 108 countries: every country any prior
CIPHER collection has queried, plus every additional country measured to hold
at least one LEI-bearing business entity. It is chosen by **availability and
breadth only** — explicitly not by expected cross-border density, not by
expected legal-form density, and not by anything either model was observed to
do.

This rule is the one that matters most. P6.26 chose v3's countries for high
foreign incorporation *because the model was failing on cross-border pairs*.
Doing the same thing to a test set would make the test an argument rather than
a measurement.

**3.2 There is no within-country selection.**
Every country is collected at `--limit 2000`, which is the Wikidata adapter's
`MAX_LIMIT`. The collection therefore takes **everything the publisher returns**
for the constant query. The only declared choice in the entire design is the
country list in 3.1.

**3.3 Freshness is enforced on the subject, not the country.**
Countries already swept are deliberately swept again, because the earlier runs
were LIMIT-bound and left a large unseen tail — GB returned 185 distinct items
against 851 available; DE holds 2,718. Every subject appearing in **any
partition of any of the five prior datasets** is excluded at corpus-build time.
The subject (LEI or CIK) is the unit the split policy and L1–L13 operate on, so
this is the same notion of freshness the leakage suite enforces.

**3.4 Labelling rules are unchanged, character for character.**
Test #3 is built by the same parameterised builder as tests #1 and #2
(`scripts/build-final-test-corpus.ts`), with the same labelling rules from
P6.19 and P6.25.1. A test that also moved the definition of a positive would
measure nothing. Identity remains **same LEI**, per the identifier-authority
policy and the P6.21.2 memo.

---

## 4. What test #3 may and may not be used for

**May:** be scored once, on a candidate set and a threshold that were frozen
before any of its contents were inspected.

**May not:** inform a feature, a threshold, a model choice, a corpus design, or
a collection strategy. The moment it does, it joins the SPENT rows in §2 and
this document must say so.

**Reporting rule:** the aggregate is never reported alone. False merges are the
expensive error in investigative entity resolution — a wrong merge puts two
real companies into one node and every downstream inference inherits it — so
the breakdown by error class is part of the result, not an appendix to it.

---

## 5. Identity definition in force

Unchanged, and taken from `docs/evaluation/parent-subsidiary-policy.md`
(P6.21.2) rather than reinvented here:

- **Same legal entity** = two records carrying the same LEI, from any
  publisher, subject to the identifier-authority policy.
- **Parent company**, **subsidiary**, **controlled entity** — deliberately
  **not defined and not used**.
- A publisher-stated consolidation relation is evidence that two records are
  **two entities**, never evidence to merge them.

So a parent/subsidiary pair is a **negative** under the labels, and a model
that merges one has made a false merge. That is the definition every number in
this phase is measured against, and it is not changed by this phase.

The P6.21.2 memo's open items — whether to *enable* Policy B/C/D, add-on P, the
124 dangling targets — remain open project-owner decisions. None of them blocks
evaluation, because none of them changes what "same legal entity" means.

---

## 6. How test #4 is built

P6.28 needs a fourth instrument for one reason: **P6.27's comparison confounded
two changes.** The shipped model is logistic regression on 26 features; the
rejected candidate was gradient-boosted trees on 31. Test #3 could not say
which of the two changes produced the ten unrelated merges, and the E2
candidate — logistic regression on the same 31 features — is the experiment
that separates them. Scoring E2 on test #3 now would be selection on a spent
test set, which §4 forbids and which the P6.27 freeze forbade in advance.

The four rules of §3 carry over. Two of them are unchanged, one is reused
verbatim, and one gains a mechanical extension that is declared here rather
than discovered later.

**6.1 The country list is not re-declared — it is reused, byte for byte.**
`evidence/final-test-4/collection-declaration.json` inherits the P6.27 list of
108 countries by reference and by sha256, and adds, removes and reorders
nothing. This is stronger than re-declaring: it leaves **no country choice to
make in this phase at all**, and therefore none that could have been made
against a result. The source allowlist is likewise unchanged, so there is no
post-hoc source selection either.

**6.2 There is still no within-country selection, and the sweep can now
actually reach a country's tail.**

Test #3 collected each country at one page of `--limit 2000` and described that
as taking everything the publisher returns. Two measurements made while
planning test #4 show it was not:

- The property path `wdt:P31/wdt:P279*` returns one row per **derivation**, not
  per item, and the four OPTIONAL enrichments cross-multiply on top. 2,000 rows
  yield **521 distinct items for CZ** and **280 for US**. The row limit binds
  far below the item count — which is the same effect P6.25 recorded when GB
  returned 185 distinct items against 851 available.
- SPARQL `LIMIT` without `ORDER BY` returns an **arbitrary** subset, and
  guarantees nothing about which. Re-running the query is not a way to reach
  the rest.

So test #4 pages each country in **ascending QID order** — publisher-assigned
creation order, content-blind, stable across runs, and unrelated to name,
jurisdiction mix, or anything either model was observed to do. The cap is
**four pages of 2,000 rows, identical for all 108 countries**, stopping early
when a page comes back short. Every row a page returns is kept. The only thing
the experimenter decides is the cap, and the cap is uniform, so the jurisdiction
mix of the result is decided by what the publisher holds.

The ordering is added **only when an offset is supplied**, so the unpaged query
stays byte-identical and tests #1–#3 remain reproducible from their pins.

**6.3 Freshness is enforced on the subject, against all seven prior datasets.**
Unchanged in rule, wider in scope only because there are two more datasets to
exclude than there were in P6.27. 13,877 subjects are excluded at the **record**
level before a single pair is formed — v1, v2, v3, v4, tests #1, #2 and #3, in
every partition — plus the P6.16 pilot's reserved LEIs.

An availability census run before collection established that the test is
buildable at all: **41,103 LEI-bearing business entities across the 108
declared countries** carry a stated country, against 13,877 subjects already
consumed. That census counted items and read no entity name.

**6.4 Labelling rules are unchanged, character for character.** Test #4 is
built by the same parameterised builder as tests #1, #2 and #3, with the same
P6.19 and P6.25.1 rules. Identity remains **same LEI**.

**6.5 What is different from test #3, and it is not a rule.** Test #3's pool was
halved by `sha256(seed|subject)` because that one sweep had to yield both a
frozen test and a training corpus. Test #4 yields only a test — v4 already
exists and is the training half — so **no bucket split is applied** and the
whole fresh pool is the test.

**6.6 If the fresh pool is too small, the answer is BLOCKED.** The declaration
fixes a floor of 1,200 subjects and 800 positives before collection. Below it,
the freshness rule is not weakened, the country list is not extended to chase
yield, and no prior test is re-used.

**6.7 What test #4 said, and what it could not say.** It was scored once, on the
shipped model and on E2, and it shipped E2: 4,395 true positives against 4,378
and **one** wholly-unrelated merge against **nine**. It is also easier than test
#3 (91.6% of its positives are in the three easy variation classes, against
67.6%), narrower (25 countries, no non-Latin script), and it holds only 30
cross-border positives and zero Latvian pairs. `ml-final-test-4.md` §4 states
what that bounds. The project again has no untouched instrument.
