# Project status

**This is the canonical current-state document.** A session that reads this file
and `implementation-ledger.md` knows where the project stands without being told.

Per-task truth (what completed, at which commit, with which evidence) lives in
[`implementation-ledger.md`](./implementation-ledger.md). This page does not
repeat it — it answers *what is built, what is closed, what is in progress, what
is blocked, and what happens next*.

> **Last reconciled:** P6.30, 2026-09-09. Every figure below was measured from
> this repository at that point, not copied from a document. Reproduce with the
> commands in [§5](#5-validation).

---

## 1. Built and working

The full demonstration pipeline runs end to end, locally, deterministically and
idempotently, against the **Operation DarkNet Delhi** synthetic corpus — no
Docker, no network call required at any stage:

| Stage | Milestone | Documentation |
|---|---|---|
| Evidence ingestion | P5.2 | [`../data/ingestion.md`](../data/ingestion.md) |
| Structured extraction | P5.3 | [`../data/extraction.md`](../data/extraction.md) |
| Deterministic entity resolution | P5.4 | [`../data/resolution.md`](../data/resolution.md) |
| Graph synthesis | P5.5 | [`../data/graph.md`](../data/graph.md) |
| Topology analytics | P5.6 | [`../data/analytics.md`](../data/analytics.md) |
| Spatial / temporal corroboration | P5.7 | [`../data/corroboration.md`](../data/corroboration.md) |
| Investigation Copilot | P5.8 / M8 | [`../data/copilot.md`](../data/copilot.md) |
| Dossier / report | P5.9 / M9 | [`../data/dossier.md`](../data/dossier.md) |

Each stage document owns its own measured counts; they are not restated here.

Also implemented: the evaluation harness (`npm run evaluate` →
[`../../reports/evaluation/`](../../reports/evaluation/)), the public-register
collector (`npm run collect:public`), and the command-centre UI shell, shared
Inspector and redesigned graph surface (P5.10.2–P5.10.4).

## 2. Closed

**P6 ML is closed.** Model selection ended at P6.28; nothing in it is to be
reopened, re-trained or re-scored.

- **Shipped:** the E2 advisory pair classifier,
  `models/cipher-er-pair-classifier.v2lr.json`, model version **2.2.0**,
  31 trainable features, trained on `cipher-er-pairs` v2.0.0.
- **Advisory only.** It merges nothing. `src/lib/resolution/` is byte-identical
  to `af22018` and no resolver code path calls the model.
- Measured once on frozen test #4 — and on nothing since. Numbers, limits and
  the head-to-head against v2.0.0:
  [`../evaluation/ml-final-test-4.md`](../evaluation/ml-final-test-4.md) and
  [`../evaluation/ml-model-card.md`](../evaluation/ml-model-card.md). Do not
  quote ML figures from anywhere else.
- Every frozen test (#1–#4) is **spent**. A future model decision costs a new
  one — [`../evaluation/ml-evaluation-protocol.md`](../evaluation/ml-evaluation-protocol.md) §2.

**P6.29 is closed.** The three long-standing Playwright failures were resolved at
their real cause — stale `tests/e2e/` constants left behind by P6.2 — plus one
genuine UI defect they had masked:

- **17 person entities is correct.** 10 come from fields that name a person
  directly; the other **7** are composed entirely of the `.person` field paths
  P6.2 introduced (`phone:*#subscriberName.person`, `account:*#holderName.person`)
  — the M1/M2/M3 money mules and X1, each named only inside a record about
  something else, with no shared identifier to anchor them. The resolver's split
  of those mules is a **known limitation, deliberately left unfixed so it stays
  measurable** ([`../evaluation/resolver-failure-analysis.md`](../evaluation/resolver-failure-analysis.md)).
  It is not a regression and must not be "fixed" to satisfy a test.
- Downstream counts follow from the same 7: 61 entities + 14 locations = **75**
  ranked graph nodes.
- `unlinked_mention` was rendering as a raw enum because P6.17.2 split
  `new_entity`'s meaning without updating `RESOLUTION_TYPE_LABELS`. All four
  unlabelled resolution types now have prose labels, and the success accent is
  conditioned on `status === "resolved"`.

## 3. In progress

**M10 — UI / Visual Investigation Experience.** P5.10.2 (command-centre shell),
P5.10.3 (shared Inspector + persistent focus) and P5.10.4 (graph surface
redesign) have landed. **Remaining: the Map surface, the Timeline surface, and
the rich Evidence surface.** This is the next executable milestone; it needs no
owner decision.

M11 (Integration Hardening), M12 (Evaluation) and M13 (Stabilization / Demo
Rehearsal) are planned and not started.

## 4. Blocked on owner decisions

**P6.21.2 — parent/subsidiary policy.** Answered as a memo, deliberately not
implemented: [`../evaluation/parent-subsidiary-policy.md`](../evaluation/parent-subsidiary-policy.md) §8
is the canonical list of what needs approval (the §4 definitions, the A–E policy
choice, the Add-on P collection, the 124 dangling targets, whether a
non-identifier source may block resolution, `successor-entity`, and the P6.20 §5
correction). Until it is decided, 154 publisher-stated consolidation edges are
collected and provenanced but dropped at the graph boundary with a warning.

This is also **why the ML score stays advisory**: its dominant error class is
corporate-family pairs, so promoting it to a merge would settle P6.21.2 by
accident, in code.

> Earlier ledger rows **P6.15**, **P6.18.5** and **P6.19.5** read
> "Proposed — awaiting owner decision". Those are *historical* gate records, kept
> as written. They were subsequently answered — the identifier-authority policy
> was approved and implemented at P6.15.1, and the ML gate was reopened and
> carried through P6.24–P6.28. **P6.21.2 is the only open owner decision.**

## 5. Validation

Verified on this repository at the P6.30 reconciliation:

| Check | Command | Result |
|---|---|---|
| Unit | `npm test` | **696 / 696** in 29 files |
| End-to-end | `npm run test:e2e` | **21 / 21** in 10 files |
| Types | `npm run typecheck` | clean |
| Lint | `npm run lint` | clean |

E2E requires Playwright's Chromium (`npx playwright install chromium`). A missing
browser is an **environment blocker**, not a product failure — report it as such.

## 6. What else is in this directory

- [`implementation-ledger.md`](./implementation-ledger.md) — the append-only,
  per-task record: status, owner, commit hash, visual proof, tests, demo readiness.
- [`visual-evidence-convention.md`](./visual-evidence-convention.md) — the naming
  and capture rules every major feature's visual proof follows.
- [`evidence/`](./evidence/) — **historical** point-in-time captures. Each is
  correct *for the commit it was taken at* and is never retouched when later
  counts change. Read a capture's README for what it proved and when.

## 7. Rules that govern this record

- Status entries reflect **actual repository state**, never intended state.
- No screenshot, recording or "visual proof" may be fabricated, staged, or
  relabelled as evidence of something it did not capture.
- No feature is "demo ready" without a commit, a passing test and real visual proof.
- A commit hash is recorded only once it exists. `Pending` is the honest
  placeholder; a hash is never invented.
