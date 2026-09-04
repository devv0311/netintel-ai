# CIPHER — Research Gate (Phase 1E)

**Date:** 2026-09-03
**Prepared by:** Phase 1 research session
**Reviewed by:** _pending — requires project owner sign-off_

```text
RESEARCH COMPLETE: PARTIAL
LARGE-SCALE COLLECTION APPROVED: NO
PILOT COLLECTION APPROVED: NO (pending sign-off + 2 blocking decisions)
```

---

## Why `PARTIAL` and not `YES`

Source research, licensing assessment and tooling audit are complete for 19 sources. Two
components of Phase 1 could not be completed:

1. **Project inspection was not possible.** The session that produced this had no access to the
   CIPHER repository, the blueprint prerequisites file, existing schemas, collectors, the
   synthetic-data generator, or the model training code. Section 0 and Section 3 of the brief
   were therefore not executed, and **no assessment of the existing project state exists**.
2. **Phase 7 (model-training compatibility) cannot begin.** Whether a source is "directly
   usable", "usable after transformation", "pretraining only", "evaluation only" or "unsuitable"
   is a statement about what the existing model consumes. That is unknown.

Everything in this gate is therefore a *source-side* judgment. It is sound on its own terms and
should not be mistaken for a compatibility assessment.

---

## Recommended sources

**Tier A — approved for pilot collection once this gate is signed:**

| ID | Source | License | Status |
|---|---|---|---|
| SRC-001 | Wikidata | CC0 1.0 | APPROVED |
| SRC-002 | GLEIF LEI (L1 + L2) | CC0 1.0 | APPROVED |
| SRC-005 | Naamapadam (AI4Bharat) | CC0 1.0 | APPROVED |
| SRC-003 | DocRED / Re-DocRED | MIT (text CC BY-SA) | APPROVED_WITH_RESTRICTIONS |
| SRC-006 | SEC EDGAR | US public domain | APPROVED_WITH_RESTRICTIONS — 10 req/s + UA with contact email |
| SRC-004 | FEVER | CC BY-SA 3.0 | APPROVED_WITH_RESTRICTIONS — license-isolated partition |
| SRC-019 | Operation DarkNet Delhi | Project-owned | APPROVED — **evaluation only, never train** |

**Tier B — approved in principle, gated on a prerequisite:**

| ID | Source | Gate |
|---|---|---|
| SRC-008 | OpenNyAI InJudgements | Court-judgment privacy policy must exist in writing |
| SRC-007 | Indian High Court Judgments | Same policy; use only after SRC-008 pilot succeeds |
| SRC-011 | GDELT 2.0 | URL dereferencing must be disabled in collector code first |

---

## Sources requiring manual review

| ID | Source | Question that must be answered | Who answers |
|---|---|---|---|
| SRC-012 | OpenSanctions DATA | Is CIPHER ever commercial or third-party licensed? CC BY-NC 4.0 forbids commercial use; paid licenses exist for that case. | Project owner |
| SRC-010 | MAVEN-ERE | GPL-3.0 on a dataset. Does training create obligations on model weights? | Written clarification from THU-KEG, or eval-only |
| SRC-009 | KILT | Eight constituent datasets, ≥4 license regimes under one MIT badge | Per-dataset clearance |
| SRC-013 | Open Contracting | License varies per publisher; not clearable as one row | Split per publisher |
| SRC-014 | Zenodo / Kaggle | No platform-level license; frequent illegitimate re-uploads | Per-dataset, with primary license URL |
| SRC-003 | DocRED | MIT repo over Wikipedia (CC BY-SA) text — does redistribution carry ShareAlike? | Legal review before publishing derived data |
| SRC-007 / SRC-008 | Indian judgments | DPDP Act 2023 position on reprocessing judgments into an investigative graph | Project owner + institution |
| — | LDC corpora (TACRED, ACE 2005, OntoNotes, TimeBank) | Does SICSR hold an LDC membership? | Institution — ten minutes to check |
| — | `openaleph/LICENSE.txt` | AGPL vs permissive materially changes reuse | Read the file before vendoring |

---

## Rejected sources

| ID | Source | Reason |
|---|---|---|
| SRC-015 | NCRB via data.gov.in | Aggregate counts, task fit 2/27. No entities, relationships, text or documents. License is clean; the data is the wrong shape. **Retained only as a labelled aggregate layer on the demo map — never as ML input.** |
| SRC-016 | FBI NIBRS / CDE | De-identified by design (3/27) and US-only taxonomies. Two independent disqualifiers. |
| SRC-017 | CoNLL-2003 | Underlying Reuters RCV1 text requires a signed agreement; circulating copies are unlicensed redistributions. |
| SRC-018 | General web scraping / news crawling | Prohibited by project rule 1.1. Recorded explicitly so the refusal is written down rather than silently omitted. |
| — | Scrapy (tooling) | Crawling framework with no approved use case; its presence in the repo invites the pattern the rules forbid. |

---

## Outstanding legal questions

1. **Commercial posture of CIPHER.** Single most consequential open question. Decides
   OpenSanctions (the highest-task-fit entity dataset available) and shapes the MAVEN-ERE
   assessment.
2. **GPL-3.0 applied to a training dataset** (MAVEN-ERE) — unsettled generally, must not be
   resolved by assumption in a system with a government-deployment story.
3. **ShareAlike propagation** from FEVER and possibly DocRED into any published derived dataset.
   Architecturally contained by license-partitioning; still needs a decision on what gets
   published.
4. **DPDP Act 2023** and the publicly-available-data exemption, applied to reprocessing named
   court judgments into a persistent investigative graph. A graph linking a named person across
   multiple cases is a materially different artifact from a published judgment, and should not be
   assumed to inherit its public status.
5. **LDC membership status at SICSR.**
6. **Transitive dependency licenses** for any adopted package — no GPL/AGPL dependency enters
   the runtime without review.

---

## Outstanding technical questions

1. **What does the existing model consume?** Input schema, training format, tokenizer/
   representation assumptions, labels, objective, evaluation. Blocks all of Phase 7. Requires
   repository access.
2. **Does an entity schema already exist**, and does it map cleanly onto FollowTheMoney? Decides
   whether FtM is adopted, profiled, or rejected.
3. **What does the DarkNet Delhi generator emit**, and can real-data records be expressed in the
   same schema without collapsing the training/evaluation boundary?
4. **Is there any labelling capacity?** Determines whether the strategy is supervised,
   weakly-supervised, or self-supervised-plus-evaluation-only.
5. **Storage and compute budget.** The Tier A pilot is under ~1 GB; the full Indian High Court
   corpus is orders of magnitude larger. Nothing beyond the pilot should be sized without this.
6. **Does the deployment target permit outbound network access at collection time**, or must all
   sources be mirrored offline? Affects collector design.

---

## Conditions for opening the next gate

Pilot collection (Phase 3B) may begin when **all** of the following hold:

- [ ] This gate document is reviewed and signed by the project owner.
- [ ] Question 1 above (commercial posture) is answered in writing.
- [ ] The collector enforces source-registry status gating **in code** — unapproved `source_id`
      refused at runtime, arbitrary URLs unreachable by construction.
- [ ] SEC EDGAR rate limiting is fail-closed at 10 req/s with a real contact User-Agent.
- [ ] GDELT URL dereferencing is disabled and covered by a test.
- [ ] `--dry-run` output is produced and reviewed for every pilot source (Phase 3A).
- [ ] The court-judgment privacy policy exists in writing **before** SRC-007 / SRC-008 are
      touched beyond the 50-document quarantine test.
- [ ] Raw-data immutability is enforced (write-once, hash-verified).

Large-scale collection requires a **separate, later gate** and is not in scope for the next
phase under any circumstances.

---

## Explicit statement of what was not done

No data was downloaded. No collector was written or run. No repository was modified, committed
or pushed. No dataset was sampled beyond reading publicly documented licensing and schema pages.
The only network activity was fetching license, terms-of-use and repository documentation pages
for the assessments recorded here.

---

## Gate decision — 2026-09-03 (appended, does not rewrite the above)

The gate above recorded `PILOT COLLECTION APPROVED: NO`. The project owner has since
authorised a pilot **narrowly**, and this section records exactly what was and was not
authorised so the original restriction is not quietly treated as lifted.

**Authorised:** a tiny, bounded pilot collection from SRC-001 (Wikidata) and SRC-002
(GLEIF) only — the two Tier-A CC0 sources — routed through the existing
`public_record` boundary, for the purpose of measuring the current resolver against
real records.

**Not authorised, and unchanged:** large-scale collection (still requires a separate,
later gate), every source outside those two, and any ML training.

Status of the gate's own conditions, for this pilot:

| Condition | Status |
|---|---|
| Gate reviewed and signed by the project owner | Met, scoped to SRC-001/SRC-002 as above |
| Q1 commercial posture answered in writing | **Still open** — but it gates OpenSanctions (CC BY-NC), not CC0 sources. Not blocking here. |
| Collector enforces registry status gating in code | Met (P6.5 `registry.ts`; unapproved `source_id` refused before a socket opens) |
| `--dry-run` produced and reviewed for every pilot source | Met for GLEIF; N/A for Wikidata (never reached) |
| Raw-data immutability, write-once and hash-verified | Met — `data/public/raw/`, per-payload sha256 in `manifest.json` |
| SEC EDGAR rate limiting / GDELT dereferencing / court-judgment privacy policy | N/A — none of those sources were touched |

**Outcome:** GLEIF collected (24 records). Wikidata **not** collected — access blocked
on every official endpoint, which is a stop condition, not an obstacle to route around.
See `docs/data-research/network-access-diagnosis.md`.

Q1 remains open and still blocks SRC-012.

