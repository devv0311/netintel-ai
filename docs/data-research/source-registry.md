# CIPHER — Real-World Data Source Registry

**Phase:** 1 (research only)
**Date:** 2026-09-03
**Status:** Research complete for the sources listed. **Large-scale collection NOT approved.**
**Machine-readable companion:** [`source-registry.csv`](./source-registry.csv) (19 sources × 46 fields — the 35 specified in the brief, plus 9 per-task fit scores, `task_total` and `tier`)
**Regenerate with:** `python3 scripts/build_source_registry.py`

---

## 0. Scope note and a caveat about this document

This registry was produced **without access to the existing CIPHER repository**. The
blueprint prerequisites file, existing schemas, collectors, synthetic-data generator and model
training code were not readable from the session that produced it. Consequences:

- No claim is made here about what already exists in the project.
- Phase 7 (model-training compatibility) **cannot be completed** until the existing training
  code is inspected. Nothing below should be read as asserting compatibility.
- The `SRC-019` row describing Operation DarkNet Delhi is reconstructed from the brief's
  description of it, not from the generator.

Every license, rate limit and access condition recorded here was verified against a primary
publisher URL during research. Where verification was not possible, the row is marked
`MANUAL_REVIEW` rather than assumed.

---

## 1. What this registry optimises for

Sources are scored against the nine ML tasks CIPHER actually performs, not against how
investigative they sound:

| Code | Task |
|---|---|
| ER | Entity resolution |
| NER | Entity extraction |
| RE | Relationship extraction |
| EE | Event extraction |
| TMP | Temporal reasoning |
| GEO | Spatial reasoning |
| CON | Contradiction detection |
| GRA | Graph construction |
| RPT | Grounded investigative reporting |

Scoring per task: **3** = direct supervision or gold structure · **2** = usable after
transformation or weak supervision · **1** = indirect (pretraining or context only) ·
**0** = no meaningful contribution.

### Read the total with care

`task_total` measures **breadth**, not importance. Two Tier-A sources score low on it:

- **FEVER (8/27)** is the only public source giving labelled contradiction supervision with
  sentence-level evidence. Breadth 8, irreplaceability high.
- **Naamapadam (5/27)** is the only realistic route to Hindi/Indic NER supervision. Breadth 5,
  irreplaceability high.

Conversely **OpenSanctions (20/27)** scores high and is still Tier C, because its NonCommercial
license is a hard blocker no amount of task fit compensates for. **Do not rank by total alone.**
The tier assignment is the operative judgment; the total is one input to it.

---

## 2. The headline finding

Three of the sources named as priorities in the project brief cannot contribute to any of the
nine tasks, and the finding is structural rather than legal:

| Source | License status | Task total | Why it fails |
|---|---|---|---|
| NCRB via data.gov.in | Clean (GODL-India) | **2/27** | Aggregate counts by state/district/year. No entity mentions, no relationships, no free text, no documents. |
| FBI NIBRS / CDE | Clean (US public domain) | **3/27** | De-identified by design — removing names is the point of NIBRS. Also US-only taxonomies. |
| GDELT (as an entity source) | Clean and permissive | **12/27**, ER = 0 | Actors are coarse CAMEO codes; it distributes metadata and URLs, never article text. |

All three are legitimate, well-licensed public datasets. They are simply the wrong *shape*. A
crime-statistics table and an entity-resolution training set are different kinds of object, and
the brief treats them as interchangeable.

The sources that do have the right shape — entity, relationship, document, provenance — are a
shorter list: **Wikidata, SEC EDGAR, GLEIF, DocRED, FEVER, Naamapadam**, plus Indian court
judgments subject to a privacy policy that does not yet exist.

---

## 3. Registry tables

<!-- The tables below are generated. Edit scripts/build_source_registry.py, not this section. -->

### 3.1 Task-fit matrix

| ID | Source | ER | NER | RE | EE | TMP | GEO | CON | GRA | RPT | **Total** | Tier |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| SRC-019 | Operation DarkNet Delhi (synthetic) | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 | **27** | A |
| SRC-006 | SEC EDGAR | 2 | 3 | 3 | 2 | 3 | 2 | 2 | 3 | 3 | **23** | A |
| SRC-001 | Wikidata | 3 | 2 | 3 | 2 | 3 | 3 | 1 | 3 | 1 | **21** | A |
| SRC-007 | Indian High Court Judgments | 2 | 3 | 2 | 2 | 3 | 2 | 2 | 2 | 3 | **21** | B |
| SRC-012 | OpenSanctions (DATA) | 3 | 2 | 3 | 2 | 2 | 2 | 2 | 3 | 1 | **20** | C |
| SRC-008 | OpenNyAI InJudgements | 1 | 3 | 2 | 2 | 3 | 2 | 1 | 2 | 3 | **19** | B |
| SRC-002 | GLEIF LEI (L1 + L2) | 3 | 1 | 3 | 0 | 2 | 2 | 1 | 3 | 1 | **16** | A |
| SRC-010 | MAVEN-ERE | 1 | 2 | 2 | 3 | 3 | 0 | 2 | 2 | 1 | **16** | B |
| SRC-003 | DocRED / Re-DocRED | 1 | 3 | 3 | 1 | 1 | 1 | 1 | 2 | 2 | **15** | A |
| SRC-013 | Open Contracting (OCDS) | 2 | 1 | 2 | 2 | 2 | 1 | 1 | 2 | 1 | **14** | C |
| SRC-011 | GDELT 2.0 | 0 | 1 | 1 | 2 | 3 | 3 | 1 | 1 | 0 | **12** | B |
| SRC-009 | KILT benchmark | 1 | 2 | 2 | 0 | 0 | 0 | 2 | 0 | 3 | **10** | B |
| SRC-004 | FEVER | 0 | 1 | 1 | 0 | 0 | 0 | 3 | 0 | 3 | **8** | A |
| SRC-005 | Naamapadam (AI4Bharat) | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 1 | 0 | **5** | A |
| SRC-017 | CoNLL-2003 | 0 | 3 | 0 | 0 | 0 | 1 | 0 | 0 | 0 | **4** | D |
| SRC-016 | FBI NIBRS / CDE | 0 | 0 | 0 | 1 | 1 | 1 | 0 | 0 | 0 | **3** | D |
| SRC-015 | NCRB via data.gov.in | 0 | 0 | 0 | 0 | 1 | 1 | 0 | 0 | 0 | **2** | D |
| SRC-014 | Zenodo / Kaggle (generic) | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** | C |
| SRC-018 | General web scraping | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **0** | D |

### 3.2 Licensing and status

| ID | Source | License | Training use | Redistribution | PII risk | Status |
|---|---|---|---|---|---|---|
| SRC-001 | Wikidata | CC0 1.0 | YES | YES | LOW-MEDIUM | `APPROVED` |
| SRC-002 | GLEIF LEI | CC0 1.0 | YES | YES | LOW | `APPROVED` |
| SRC-003 | DocRED / Re-DocRED | MIT (text is Wikipedia CC BY-SA) | YES | YES | LOW | `APPROVED_WITH_RESTRICTIONS` |
| SRC-004 | FEVER | CC BY-SA 3.0 | YES | YES (ShareAlike) | LOW | `APPROVED_WITH_RESTRICTIONS` |
| SRC-005 | Naamapadam | CC0 1.0 | YES | YES | LOW-MEDIUM | `APPROVED` |
| SRC-006 | SEC EDGAR | US Gov / public domain | YES | YES | MEDIUM | `APPROVED_WITH_RESTRICTIONS` |
| SRC-007 | Indian High Court Judgments | CC BY 4.0 | YES | YES | **HIGH** | `APPROVED_WITH_RESTRICTIONS` |
| SRC-008 | OpenNyAI InJudgements | Apache-2.0 | YES | YES | **HIGH** | `APPROVED_WITH_RESTRICTIONS` |
| SRC-009 | KILT | MIT code; constituents vary | MANUAL_REVIEW | MANUAL_REVIEW | LOW | `MANUAL_REVIEW` |
| SRC-010 | MAVEN-ERE | **GPL-3.0** | MANUAL_REVIEW | MANUAL_REVIEW | LOW | `MANUAL_REVIEW` |
| SRC-011 | GDELT 2.0 | Unrestricted use + citation | YES | YES | MEDIUM | `APPROVED_WITH_RESTRICTIONS` |
| SRC-012 | OpenSanctions DATA | **CC BY-NC 4.0** | NON-COMMERCIAL ONLY | NON-COMMERCIAL ONLY | **HIGH** | `MANUAL_REVIEW` |
| SRC-013 | Open Contracting | Varies by publisher | MANUAL_REVIEW | MANUAL_REVIEW | MEDIUM | `MANUAL_REVIEW` |
| SRC-014 | Zenodo / Kaggle | Per-dataset, no platform license | MANUAL_REVIEW | MANUAL_REVIEW | UNKNOWN | `MANUAL_REVIEW` |
| SRC-015 | NCRB via data.gov.in | GODL-India | YES | YES | NONE | `REJECTED` (training) — demo layer only |
| SRC-016 | FBI NIBRS / CDE | US Gov / public domain | YES | YES | LOW | `REJECTED` |
| SRC-017 | CoNLL-2003 | Reuters agreement required | MANUAL_REVIEW | **NO** | LOW | `REJECTED` |
| SRC-018 | General web scraping | NONE | **NO** | **NO** | HIGH | `REJECTED` |
| SRC-019 | DarkNet Delhi (synthetic) | Project-owned | **EVALUATION ONLY** | discretion | NONE | `APPROVED` |

### 3.3 Scores (0–10)

| ID | Source | Quality | Legal | Privacy | Overall | Rate limit |
|---|---|---|---|---|---|---|
| SRC-001 | Wikidata | 8 | 10 | 8 | **9** | WDQS 60s timeout, 429 backoff, UA policy |
| SRC-002 | GLEIF LEI | 9 | 10 | 10 | **9** | API fair-use; prefer bulk |
| SRC-003 | DocRED | 9 | 8 | 9 | **9** | n/a |
| SRC-006 | SEC EDGAR | 9 | 9 | 6 | **9** | **10 req/s, enforced; UA + email required** |
| SRC-019 | DarkNet Delhi | 10 | 10 | 10 | **9** | n/a |
| SRC-004 | FEVER | 9 | 6 | 9 | **8** | n/a |
| SRC-005 | Naamapadam | 7 | 10 | 8 | **8** | n/a |
| SRC-009 | KILT | 8 | 5 | 9 | **7** | n/a |
| SRC-007 | Indian HC Judgments | 8 | 8 | 3 | **6** | S3 standard |
| SRC-008 | OpenNyAI InJudgements | 7 | 9 | 3 | **6** | n/a |
| SRC-010 | MAVEN-ERE | 9 | 4 | 9 | **6** | n/a |
| SRC-011 | GDELT 2.0 | 5 | 8 | 5 | **5** | API fair-use |
| SRC-012 | OpenSanctions DATA | 9 | 3 | 3 | **5** | API tier-dependent |
| SRC-013 | Open Contracting | 6 | 4 | 6 | **5** | varies |
| SRC-017 | CoNLL-2003 | 9 | 2 | 8 | **4** | n/a |
| SRC-015 | NCRB / data.gov.in | 7 | 9 | 10 | **3** | API key quota |
| SRC-016 | FBI NIBRS | 7 | 9 | 9 | **3** | API key quota |
| SRC-014 | Zenodo / Kaggle | 3 | 2 | 3 | **3** | varies |
| SRC-018 | Web scraping | 2 | 0 | 0 | **0** | n/a |

Per rule 5A of the brief, **legal and privacy scores override the aggregate**. SRC-007 and
SRC-008 carry high task value and a privacy score of 3; they are gated behind a written PII
policy regardless of how useful they are.

---

## 4. Licensing findings that change decisions

### 4.1 OpenSanctions: code MIT, data CC BY-NC — confirmed

The brief flagged this and was right. Verified from the repository README:

> "The code within this repository is licensed under the MIT License. For content and data, we
> adhere to CC 4.0 Attribution-NonCommercial."

The **NonCommercial** term is not a formality. If CIPHER is ever licensed to an agency,
sold, bundled, or commercialised in any form, training on OpenSanctions data breaches it —
which is exactly why OpenSanctions sells separate Screening and Reseller/OEM licenses.

**Decision:** adopt the FollowTheMoney schema and the OpenSanctions *code* (MIT). Do not ingest
the *data* until the project's commercial posture is settled in writing. See
[`github-repository-audit.md`](./github-repository-audit.md).

### 4.2 MAVEN-ERE is GPL-3.0 — the best event/temporal data has the worst license

MAVEN-ERE has 1.22M temporal relations and 58k causal relations; nothing else public comes
close for TMP and EE. It is released under **GPL-3.0**, a software license applied to a
dataset. Whether training on GPL-licensed data creates obligations on model weights is legally
unsettled. For a system with a government-deployment story, "probably fine" is not an adequate
answer. **Use for evaluation only, or obtain written clarification from THU-KEG.**

### 4.3 FEVER's ShareAlike is viral

FEVER is CC BY-SA 3.0. Any derived dataset published downstream inherits ShareAlike. Keep
FEVER-derived records in a **separately licensed partition** so the obligation cannot
contaminate the rest of the corpus. This is a data-architecture requirement, not just a note.

### 4.4 KILT's MIT badge covers the tooling, not the eight datasets inside it

KILT aggregates FEVER, Natural Questions, HotpotQA, TriviaQA, ELI5, AIDA, T-REx and Wizard of
Wikipedia. Adopting it wholesale imports at least four distinct license regimes under one MIT
badge. Take the **provenance schema** (page ID + paragraph + character offsets + alignment
score); clear constituent datasets individually.

### 4.5 CoNLL-2003 is a licensing trap, recorded deliberately

The annotations are free; the underlying Reuters RCV1 text requires a signed agreement. Copies
on GitHub and Kaggle are redistributed without it. Using one would put unlicensed third-party
text into the corpus while looking completely routine. Same category: **TACRED, ACE 2005,
OntoNotes, TimeBank** — all LDC-gated. *Open question: does SICSR hold an LDC membership? If
so these move from REJECTED to MANUAL_REVIEW.*

### 4.6 GDELT's permissiveness stops one step downstream

GDELT's own terms are the most permissive of any source here — "unlimited and unrestricted use
for any academic, commercial, or governmental use of any kind without fee", redistribution
allowed with citation. But GDELT distributes **metadata plus a URL**, not article text. The
moment a collector follows those URLs, GDELT's license stops applying and news-publisher
copyright begins.

**Hard rule for the collector:** ingest GDELT columns only. Never fetch, store, or train on the
linked articles. This must be enforced in code, not by convention.

### 4.7 GODL-India explicitly excludes personal data

The Government Open Data License – India grants a worldwide royalty-free license for
"all lawful commercial and non-commercial purposes" with a prescribed attribution format, and
explicitly **excludes** personal information capable of identifying individuals, sensitive data,
official emblems, and anything exempt under Section 8 of the RTI Act 2005. This is consistent
with data.gov.in publishing aggregates only — and confirms that no record-level NCRB data will
ever appear there.

---

## 5. Privacy findings

### 5.1 Indian court judgments are the sharpest privacy question in this registry

SRC-007 and SRC-008 are the strongest India-relevant document sources available, and neither
appears in the original brief. They are also the highest-risk. These are real criminal and
civil matters naming real accused persons, victims, witnesses and addresses.

Public availability is not the test. The brief's own rule 1.3 says so. Before either source is
used beyond a sample, the following must exist **in writing**:

1. A pseudonymisation policy for natural persons, with a documented rationale for any exception.
2. Categorical exclusion of matters involving minors and sexual offences.
3. A position on India's **DPDP Act 2023** publicly-available-data exemption as it applies to
   reprocessing judgments into an investigative graph — noting that a graph linking a named
   person across cases is a materially different artifact from a published judgment.
4. A rule that no real person receives a centrality, "kingpin" or risk score outside the
   synthetic corpus.

Until that document exists, both sources are `REQUIRES_REVIEW` in practice regardless of their
`APPROVED_WITH_RESTRICTIONS` license status.

### 5.2 SEC EDGAR carries more PII than it appears to

Forms 3/4/5 and 13D/G name individual officers and beneficial owners, with addresses and
sometimes signatures. Privacy score 6, not 9. Route through the same PII screening as any other
source; do not exempt it because the publisher is a regulator.

---

## 6. Enforcement requirements this registry places on the collector

These are derived from the rows above and are non-optional:

1. Collectors **bind to registry `source_id`s**, never to arbitrary URLs. A collector that
   accepts a URL parameter violates rule 1.1 by construction.
2. Any source whose `status` is not `APPROVED` or `APPROVED_WITH_RESTRICTIONS` is **refused at
   runtime**, with the refusal logged.
3. SEC EDGAR: hard-capped at 10 req/s with a configured `User-Agent` carrying a real contact
   email. Not a config default — a fail-closed check.
4. Wikidata: dumps for anything large; WDQS only for bounded queries, with a descriptive
   User-Agent and 429 backoff.
5. GDELT: URL columns are stored as provenance metadata and are **never dereferenced**.
6. FEVER-derived and any future ShareAlike-derived records live in a partition tagged with their
   license so downstream exports can exclude them.
7. Every artifact records `source_id`, retrieval timestamp, exact endpoint, content hash,
   license and license URL at write time — not reconstructed later.

---

## 7. Sources named in the brief and deliberately not pursued

| Named | Outcome | Reason |
|---|---|---|
| NCRB / data.gov.in | Demo layer only | Aggregate counts; 2/27 task fit |
| FBI NIBRS / CDE | Rejected | De-identified and US-only; 3/27 |
| Zenodo, Kaggle, university repositories | Not registrable | Platforms, not sources — each dataset needs its own row and primary license URL |
| Frictionless Data | Reviewed as tooling | See GitHub audit; it is a spec, not a data source |
| Scrapy | Reviewed as tooling, not adopted | See GitHub audit §9 |

---

## 8. Outstanding questions

Carried forward to [`research-gate.md`](./research-gate.md):

1. Is CIPHER ever going to be commercial or licensed to a third party? This single answer
   decides OpenSanctions (SRC-012) and influences MAVEN-ERE (SRC-010).
2. Does SICSR hold an LDC membership? Decides TACRED / ACE 2005 / OntoNotes / TimeBank.
3. Who signs off the court-judgment privacy policy (§5.1)?
4. Does the existing model consume documents, entity pairs, or graph triples? Until the training
   code is read, no source can be declared "directly usable".

---

**Sources consulted (primary URLs):**
[Wikidata Data access](https://www.wikidata.org/wiki/Wikidata:Data_access) ·
[GLEIF LEI Data Terms of Use](https://www.gleif.org/en/meta/lei-data-terms-of-use) ·
[SEC EDGAR webmaster FAQ](https://www.sec.gov/os/webmaster-faq) ·
[OpenSanctions licensing](https://www.opensanctions.org/licensing/) ·
[OpenSanctions repository](https://github.com/opensanctions/opensanctions) ·
[GDELT about/terms](https://www.gdeltproject.org/about.html) ·
[GODL-India](https://smartcities.data.gov.in/government-open-data-license-india) ·
[DocRED](https://github.com/thunlp/DocRED) ·
[FEVER license](https://fever.ai/download/fever/license.html) ·
[KILT](https://github.com/facebookresearch/KILT) ·
[MAVEN-ERE](https://github.com/THU-KEG/MAVEN-ERE) ·
[Naamapadam](https://huggingface.co/datasets/ai4bharat/naamapadam) ·
[Indian High Court Judgments](https://registry.opendata.aws/indian-high-court-judgments/) ·
[OpenNyAI InJudgements](https://huggingface.co/datasets/opennyaiorg/InJudgements_dataset) ·
[FBI UCR](https://www.fbi.gov/how-we-can-help-you/more-fbi-services-and-information/ucr) ·
[Open Contracting data registry](https://data.open-contracting.org/)
