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

**Consequence, stated plainly:** at the start of P6.27 the project had **no
untouched instrument**. Every number it could quote came from data that had
either been fitted on or read. P6.27 closed that gap by building test #3 - and
then spent it, deliberately and in one shot, to make the KEEP V2 decision.

**So the gap is open again, and that is not a failure of the process but its
price.** A frozen test is consumed by the decision it informs. The project is
back to having no untouched instrument, which is the honest state after any
model decision, and the next one costs a fourth test.

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
