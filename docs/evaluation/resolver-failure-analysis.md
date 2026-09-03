# Resolver Failure Analysis

**Date:** 2026-09-03 · **Resolver frozen at** `src/lib/resolution/resolve.ts` as of commit `aa74aa2`
**Inputs:** `reports/evaluation/` (Operation DarkNet Delhi) and `reports/generalisation/` (name-morphology fixture)

---

## 1. The two rules being analysed

- **Tier A — shared identifier.** Two mentions merge when their own evidence item states the same
  identifier (phone, account, vehicle, and now `has_identifier` for a registry LEI/QID). Confidence 0.95.
- **Tier B — exact name match.** A mention with **no identifier evidence of its own** merges into a
  Tier-A cluster when its **byte-exact** name matches exactly one such cluster. Confidence 0.60.
  Matching two or more clusters leaves it unmerged and flagged `ambiguous`.

There is no third rule. Anything Tier A and Tier B both miss becomes its own entity.

---

## 2. Failure 1 — a subject named in two identifier records, with no anchor

**Where it shows:** DarkNet Delhi, `er.cluster.exactMatch` 66.7%; M1, M2, M3 and X1 each split across
two entities.

**Mechanism.** Each money mule is named twice: once as a phone record's `subscriberName`, once as a
bank-account record's `holderName`. Neither item shares an identifier with the other, so Tier A has
nothing to join on. Tier B does not apply, because **both mentions carry identifier evidence of
their own** — the phone and the account respectively. Two entities, same name, same person.

Vikram Singh does not split, and the contrast is the diagnosis: he has a `suspect_record` listing his
phones and accounts, so every other record naming him shares an identifier with it. **A person is
resolved correctly if and only if some record anchors their identifiers together.** Remove the anchor
and the identity fragments, however many times the name appears.

**Visible consequence.** The Copilot returns `ambiguous` rather than an answer for X1
(`tests/unit/copilot.test.ts` Q7). Refusing is right; needing to refuse is not.

---

## 3. Failure 2 — Tier B does not fire on real-world name variation

**Where it shows:** generalisation experiment, `exactNameMatchRate` **0/24**.

Not "low". **Zero.** Tier B did not fire once across 24 public-register mentions.

The reason is structural, not a tuning problem: Tier B requires a byte-exact name match, and the
whole point of real-world name variation is that the strings differ. A variant that is byte-identical
to the anchor does not need Tier B — Tier A already has it via the identifier.

| Variation class | Joined the subject's cluster | Failed | Why |
|---|---|---|---|
| identical + identifier | 7/7 | 0 | Tier A |
| suffix (`Pvt Ltd` / `Pvt. Ltd.` / `LTD`) | 2/6 | 4 | the 2 that joined carried the identifier |
| transliteration (Devanagari ↔ Latin) | 1/4 | 3 | the 1 that joined carried the identifier |
| abbreviation (`BCPL`, `NTMC`, `N. M. Rajagopalan`) | 0/3 | 3 | no mechanism at all |
| name order (`Rajagopalan, Narayana Murthy`) | 0/2 | 2 | no mechanism at all |

**Every success in that table is Tier A. Tier B contributed nothing.**

Aggregate effect: `unlinkedVariantRate` **82.4%** (14 of 17 non-anchor variants), and only
**2 of 8 subjects** were recovered whole — and both of those had a single record each.

**Prediction check.** Before the run, the design document recorded: *"Tier A will hold up well.
Tier B will fail badly on real data."* Tier A held (7/7 anchors, 0 false merges). Tier B did worse
than "badly": it never applied.

---

## 4. What did NOT fail

- **False merges: 0.** Including the designed trap — two different companies with the identical
  registered name `Kumar Enterprises Private Limited`. Both carried their own LEI, so Tier A
  separated them.
  **Do not over-read this.** Tier B never fired, so its false-merge risk was never exercised. The
  correct reading is *"the current resolver cannot make this mistake because it barely merges at
  all"* — which is a different statement from *"the merge logic is safe"*. Any future relaxation of
  Tier B must re-run this trap.
- **`er.mustNotMerge` 1/1** on DarkNet Delhi: the S5/W6 same-name-different-person trap holds.
- **Provenance completeness 100%** on both corpora — 3,060/3,060 and 228/228 rows, all six fields.
  The public-record path carries licence, source URL and retrieval time as first-class attribute
  rows, so provenance did not degrade when the data stopped being synthetic.
- **Ingestion of real-shaped public records: clean.** 24 records through the same validated path as
  the synthetic corpus, no schema exceptions, no id collisions.

---

## 5. Failure 3 — public-record aliases are extracted but never persisted

`aliasMatchRate` **0/1**. The publisher's `aliases[]` become `alias_of` relationship mentions at
extraction, but resolution derives alias rows only from *distinct names within a cluster*, so a
declared alias on a record that never joins a cluster is dropped.

Small, self-contained, and worth fixing early: a publisher-declared alias is the strongest
non-identifier merge evidence available, and it is currently thrown away.

---

## 6. Reading the numbers honestly

The generalisation rates are **properties of the fixture**, by construction. Egress to
`query.wikidata.org` and `api.gleif.org` was blocked by policy (HTTP 403 at the proxy), so the
fixture reproduces the *morphology* of public-register names over deliberately fake identifiers
(`TESTLEI…`, `Q9000…`). How often each variation occurs in the real registers is an empirical
question this run cannot answer.

What it does establish is mechanical and does not depend on frequency: **on any name variation at
all, Tier B contributes nothing, and every correct merge comes from Tier A.** That conclusion
transfers to real data because it follows from the rules, not from the sample.

---

## 7. Recommendations, in order

1. **Do not relax Tier B into fuzzy matching.** It would trade a fragmentation problem for a
   false-merge problem, and in an investigative system a false merge asserts that two people are one.
   The `Kumar Enterprises` trap exists to catch exactly that.
2. **Add deterministic normalisation as Tier B′, before any similarity scoring.** Case folding,
   whitespace collapse, punctuation stripping and a documented corporate-suffix table
   (`Private Limited` ≡ `Pvt Ltd` ≡ `Pvt. Ltd.` ≡ `Ltd`) would recover the entire suffix class —
   4 of the 14 unlinked variants — with no probabilistic step and no new dependency. Store the
   original and the normalised value side by side, per the project's own normalisation rule.
3. **Persist publisher-declared aliases** (§5) and admit them as Tier-A-strength evidence. A
   registry stating "also known as" is an observed fact, not an inference.
4. **Make the anchor problem explicit rather than silent.** When a name resolves to more than one
   entity and no identifier joins them, that is an investigative lead ("possible same person"), not
   a null result. The classification vocabulary already has a place for it.
5. **Leave transliteration, abbreviation and name order alone for now.** Together they are 8 of the
   14 unlinked variants, and none has a defensible deterministic rule. They are the honest case for
   a future adjudication step — which the stack contract already specifies and which has never been
   built — not for fuzzy string matching bolted onto Tier B.
6. **Re-run this experiment against real collected records** once egress is available. The mechanism
   is established; the frequencies are not.
