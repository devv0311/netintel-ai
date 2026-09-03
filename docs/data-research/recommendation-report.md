# NetIntel AI — Source Recommendation Report (Phase 1D)

**Date:** 2026-09-03 · **Phase:** 1 (research only) · **Collection status: NOT approved**

Companion to [`source-registry.md`](./source-registry.md) and
[`github-repository-audit.md`](./github-repository-audit.md).

---

## 1. The recommendation in one paragraph

Collect from **five sources** to start: Wikidata, GLEIF, SEC EDGAR, DocRED and Naamapadam. Add
FEVER in a license-isolated partition. Defer everything else. Reject the three crime-statistics
sources the brief named as priorities, because they contain no entities, no relationships and no
documents — they are counts, and counts cannot train extraction models. Keep Operation DarkNet
Delhi as the evaluation harness and do not train on it. The shift being proposed here is *not*
from synthetic to real data; it is from **unlabelled real data to labelled real data**, which is
a different and much more tractable move.

---

## 2. Ranking

Ranked by decision value: what a source contributes to the nine ML tasks, discounted by legal
and privacy risk, discounted again by collection cost.

| # | Source | Data type | Relevance | Access | License | Training use | Quality | Risk | Recommendation |
|---|---|---|---|---|---|---|---|---|---|
| 1 | **Wikidata** | Entities, statements, qualifiers, coords | ER, RE, GRA, TMP, GEO | Dumps + SPARQL | CC0 | Yes | High | Low | **Tier A — collect first** |
| 2 | **SEC EDGAR** | Real documents + ownership + dated events | RPT, RE, GRA, NER, TMP | API + bulk index | US public domain | Yes | High | Low-Med (PII in forms) | **Tier A — collect, rate-limited** |
| 3 | **GLEIF LEI L1+L2** | Entity keys + ownership edges | ER, RE, GRA | Bulk + API | CC0 | Yes | High | Low | **Tier A — collect** |
| 4 | **DocRED / Re-DocRED** | Labelled doc-level relations + evidence | RE, NER | Download | MIT (text CC BY-SA) | Yes | High | Low-Med | **Tier A — collect** |
| 5 | **Naamapadam** | Indic NER labels, 11 languages | NER (Hindi/Indic) | Download | CC0 | Yes | Med (projected labels) | Low | **Tier A — collect** |
| 6 | **FEVER** | Claims + verdicts + evidence sentences | CON, RPT | Download | CC BY-SA 3.0 | Yes, ShareAlike | High | Med (viral license) | **Tier A — isolated partition** |
| 7 | **OpenNyAI InJudgements** | 13k Indian judgments, Apache-2.0 | RPT, NER, TMP | Download | Apache-2.0 | Yes | Med-High | **High (PII)** | **Tier B — gated on privacy policy** |
| 8 | **Indian HC Judgments** | 25 High Courts, PDFs + metadata | RPT, NER, TMP | Public S3 | CC BY 4.0 | Yes | High | **High (PII)** | **Tier B — gated on privacy policy** |
| 9 | **MAVEN-ERE** | 1.22M temporal + 58k causal relations | EE, TMP | Download | **GPL-3.0** | Unclear | High | **High (license)** | **Tier C — eval only or clarify** |
| 10 | **KILT** | Provenance-linked task suite | RPT, CON | Download | MIT + 8 regimes | Per-dataset | High | Med-High | **Tier C — take the schema only** |
| 11 | **OpenSanctions DATA** | PEPs, sanctions, FtM entities | ER, RE, GRA | Bulk + API | **CC BY-NC 4.0** | Non-commercial only | High | **High (NC)** | **Tier C — blocked on a business decision** |
| 12 | **GDELT 2.0** | Coded events + geo + URLs | TMP, GEO | File feed + API | Unrestricted + cite | Yes | Low-Med | Med (downstream copyright) | **Tier B — metadata only, never follow URLs** |
| 13 | **Open Contracting** | Procurement graph | RE, EE | Per-publisher | Varies | Per-publisher | Med | Med | **Tier C — split per publisher, defer** |
| 14 | **Zenodo / Kaggle** | Heterogeneous | — | Per-dataset | None at platform level | Per-dataset | Variable | High | **Tier C — never blanket-approve** |
| 15 | **CoNLL-2003** | English NER gold | NER | Restricted | Reuters agreement | No | High | **High** | **Tier D — reject** |
| 16 | **NCRB / data.gov.in** | Aggregate crime counts | none | API + CSV | GODL-India | Permitted but useless | Med | Low | **Tier D — demo layer only** |
| 17 | **FBI NIBRS / CDE** | De-identified US incidents | none | API + bulk | US public domain | Permitted but useless | Med | Low | **Tier D — reject** |
| 18 | **Web scraping** | — | — | — | None | No | — | **High** | **Tier D — prohibited** |

---

## 3. Tiers

### Tier A — start immediately after the gate is signed

| Source | Pilot size | What it buys |
|---|---|---|
| Wikidata | ~50k entities via bounded SPARQL, then a dump slice | Free ER supervision (external IDs, sitelinks), typed relations, temporal qualifiers, coordinates |
| SEC EDGAR | ~500 filings (Form 4 + Ex-21 + a 13D/G sample) | Real documents with a real entity graph and dated transactions behind them |
| GLEIF | Full Level 1 + Level 2 (small, CC0) | Gold entity keys + validated ownership edges |
| DocRED / Re-DocRED | Full (small) | Labelled document-level relation extraction with evidence spans |
| Naamapadam | Hindi + 2 others | The only credible Indic NER supervision |
| FEVER | Full, **isolated partition** | Contradiction labels with sentence-level evidence |

Combined, these cover all nine tasks with at least one source scoring ≥2, at a total footprint
in the low tens of GB. That is the entire case for starting here: **complete task coverage at
small size with clean licenses.**

### Tier B — useful later, gated

- **OpenNyAI InJudgements** and **Indian High Court Judgments** — highest India relevance in the
  registry. Blocked until the court-judgment privacy policy exists in writing (§5.1 of the
  registry). Start with OpenNyAI: 293MB and Apache-2.0 versus terabytes and CC BY 4.0.
- **GDELT** — for temporal and spatial signal only, with URL dereferencing disabled in code.

### Tier C — manual legal review before any use

- **OpenSanctions data** — needs one business decision (commercial or not), not a legal opinion.
- **MAVEN-ERE** — needs written clarification from THU-KEG, or eval-only use.
- **KILT** — take the provenance schema; clear constituent datasets one at a time.
- **Open Contracting** — needs one registry row per publisher.
- **Kaggle / Zenodo datasets** — each needs its own row and primary license URL. No exceptions.

### Tier D — reject

- **NCRB via data.gov.in** — retain *only* as a labelled aggregate layer on the demo map.
- **FBI NIBRS / CDE** — reject outright.
- **CoNLL-2003 and LDC-gated corpora** (TACRED, ACE 2005, OntoNotes, TimeBank) — reject unless
  SICSR holds an LDC membership, which is worth ten minutes to check.
- **Any crawling of arbitrary sites** — prohibited by the project's own rules.

---

## 4. Three findings that should change the plan

### 4.1 The brief's priority sources cannot do the job it assigns them

NCRB, NIBRS and GDELT-as-entities were named as investigation targets. Combined task fit:
**2/27, 3/27 and ER=0**. The failure is not licensing — GODL-India and US public domain are
both clean. It is that a table of crime counts by district and year contains no entity mention
to extract, no relationship to predict, no document to ground a report in, and nothing that can
contradict anything else.

The pattern to avoid: **selecting sources by domain resonance rather than by structure.** A
crime dataset sounds like the right input for a crime-analytics system. It is not, if the models
consume documents and entity pairs.

### 4.2 The real bottleneck is labels, not real-world-ness

Moving from synthetic to real OSINT trades *labelled* data for *unlabelled* data. Real news text
does not come with relation annotations; court judgments do not come with resolved entities.
Unless there is a labelling budget nobody has mentioned, "more real data" makes the supervised
tasks harder, not easier.

This is why the Tier A list is weighted toward sources carrying **free or built-in supervision**:

| Source | Supervision it provides at zero labelling cost |
|---|---|
| Wikidata | External IDs and sitelinks ⇒ millions of ER match/non-match pairs |
| GLEIF | LEI is a validated global entity key ⇒ gold ER labels for companies |
| DocRED | Human-annotated relations + evidence sentences |
| FEVER | SUPPORTS / REFUTES / NEI + evidence pointers |
| Naamapadam | Token-level NER tags (projected; gold test sets for 8 languages) |
| SEC EDGAR | Structured XBRL/exhibit fields ⇒ weak supervision aligned to the free text |

Five of the six are Tier A *because of this property*, not because they are real-world.

### 4.3 Retiring the synthetic corpus would remove the only complete evaluation harness

Operation DarkNet Delhi scores **27/27** — the only source with gold labels for all nine tasks
simultaneously. No public source has ground truth for entity resolution, timeline, graph
structure, contradiction and expected Copilot answers in one coherent case.

Recommendation: **do not reduce the synthetic corpus. Change its role.** It becomes the
evaluation harness and the deterministic demo, permanently on the evaluation side of the
boundary. Real data becomes the training and generalisation input. Both get separate provenance
namespaces so evaluation can never be contaminated by training data.

One consequence worth stating plainly: if this work is for a hackathon or jury demonstration,
real OSINT will most likely make the *demo* worse, not better — messier entities, sparser
graphs, no narrative arc — while the governance work it requires consumes the schedule. The
strategy above is designed so that does not happen: the demo path stays synthetic and
deterministic; the real data improves generalisation behind it.

---

## 5. Recommended pilot (Phase 3B) — after the gate is signed

Deliberately smaller than the brief's suggested pilot, and different in composition.

| # | Source | Sample | Est. size | Purpose |
|---|---|---|---|---|
| 1 | Wikidata | 3 bounded SPARQL queries (Indian companies, persons with ≥2 external IDs, org-membership relations) | < 200 MB | Prove ER pair generation and provenance capture |
| 2 | GLEIF | Level 1 + Level 2 India subset | < 100 MB | Prove gold-key ER and ownership edges |
| 3 | SEC EDGAR | 500 filings across Form 4 / Ex-21 / 13D/G | < 500 MB | Prove document extraction + rate-limit compliance + evidence offsets |
| 4 | DocRED | Full dev split | < 100 MB | Prove relation-extraction training format |
| 5 | Naamapadam | Hindi split | < 100 MB | Prove Indic NER and Unicode normalisation |
| 6 | OpenNyAI InJudgements | **50 documents only** | < 20 MB | Prove the PII quarantine path on genuinely hard input |

**Total under ~1 GB.** No NCRB, no NIBRS, no GDELT in the pilot — nothing that cannot demonstrate
a task the pipeline claims to serve.

Item 6 is included for one reason: to make the privacy pipeline face real Indian personal data
at a size small enough to review by hand. If Presidio plus the Indian-identifier rules cannot
handle 50 judgments under manual inspection, they will not handle 13,000.

**Stop conditions** (per brief §3B): unclear license, unexpected PII density, access
restrictions, rate-limit rejection, provenance failure, or terms conflicting with intended use.

---

## 6. What to build, and what not to

From the [GitHub audit](./github-repository-audit.md): four permissively-licensed components
cover most of Phases 3–4.

| Layer | Use | Do not build |
|---|---|---|
| Schema | FollowTheMoney (MIT) — as a documented profile | A fourth investigative entity ontology |
| Entity resolution | nomenklatura (MIT) — index + resolver graph + adjudication | A custom connected-components identity manager |
| Document extraction | Apache Tika (Apache-2.0), containerised | Per-format parsers |
| PII detection | Presidio (MIT) as **layer 1 of 3** | A single-detector privacy gate |
| Crawling | — | Scrapy or any crawler (rule 1.1) |

**Where the build effort genuinely belongs**, because nothing off-the-shelf provides it:

1. Indian identifier recognisers — Aadhaar (Verhoeff), PAN, +91 mobile, IFSC, GSTIN, vehicle
   registration, PIN — for **detection and quarantine**, never storage.
2. Provenance extension to FtM: page / paragraph / char-offset / extraction-method / model-version
   evidence, in the KILT style. FtM tracks dataset origin only.
3. Leakage-safe splitting grouped by source, entity cluster and time.
4. The observed / corroborated / algorithmic-signal / AI-inference / investigative-lead
   distinction, which is the project's actual differentiator and exists in no public tool.

---

## 7. Open decisions blocking the next phase

| # | Question | Blocks | Who decides |
|---|---|---|---|
| 1 | Will NetIntel AI ever be commercial or third-party licensed? | OpenSanctions (SRC-012); influences MAVEN-ERE | Project owner |
| 2 | Who signs the court-judgment privacy policy? | SRC-007, SRC-008 (highest India value) | Project owner + institution |
| 3 | Does SICSR hold an LDC membership? | TACRED, ACE 2005, OntoNotes, TimeBank | Institution |
| 4 | What does the existing model consume — documents, entity pairs, or graph triples? | **All of Phase 7**; no source can be called "directly usable" until this is read | Requires repository access |
| 5 | Is there any labelling capacity at all? | Determines weak-supervision vs supervised strategy | Project owner |

Question 4 is the load-bearing one. Everything in this report about *which* transformation each
source needs is provisional until the training code is read.
