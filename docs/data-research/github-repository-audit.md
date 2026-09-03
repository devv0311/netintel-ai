# NetIntel AI — GitHub Repository Audit (Phase 1B)

**Date:** 2026-09-03 · **Phase:** 1 (research only) · **Nothing installed, nothing vendored yet.**

Scope: what each repository actually does, what is reusable, what is *not* reusable, and where
code licensing and data licensing diverge.

**Caveat:** this audit was written without access to the existing NetIntel AI codebase. "Reuse"
recommendations below are made against the architecture described in the brief, not against code
that was read. Any overlap with components you have already built will need reconciling.

---

## Summary

| Repository | Code license | Adopt? | Role in NetIntel AI |
|---|---|---|---|
| **followthemoney** | MIT | **Yes — adopt the schema** | Canonical entity/relationship ontology |
| **nomenklatura** | MIT | **Yes — adopt** | Entity resolution, resolver graph, adjudication UI |
| **opensanctions** (code / zavod) | MIT | Yes — pattern reference | Collector framework pattern |
| **opensanctions** (data) | **CC BY-NC 4.0** | **No — blocked** | See §3 |
| **presidio** | MIT | **Yes — as one layer only** | PII detection layer 1 of 3 |
| **openaleph** | Open source (verify file) | Reference architecture | Ingestion + cross-referencing design |
| **dedupe** | MIT | Evaluate against nomenklatura | Alternative ER; needs labelled pairs |
| **tika** | Apache-2.0 | Yes | Document text/metadata extraction |
| **frictionless-py** | MIT (verify) | Optional | Tabular schema validation + data packages |
| **scrapy** | BSD-3-Clause | **No** | Crawling framework — wrong tool, see §9 |

---

## 1. FollowTheMoney (`alephdata/followthemoney`) — **MIT — adopt**

**What it is.** "A pragmatic data model for the entities most commonly used in investigative
reporting: people, companies, assets, payments, court cases, etc." An ontology plus validation
and normalisation code, with a CLI and a Python library (Java and TypeScript ports exist).

**Why it matters here.** The brief's Phase 2B canonical schema — Entity, Relationship, Event,
Evidence — is a partial re-derivation of FtM. FtM already models these, is used across the
investigative-journalism sector (Aleph, OpenAleph, OpenSanctions, OCCRP), has an RDF/OWL
specification, and includes mapping tools for loading tabular data into the model.

**Recommendation.** Do not invent a fourth entity ontology. Either adopt FtM directly, or define
NetIntel's schema **as a documented profile of FtM** with an explicit mapping table. The
practical payoff is not elegance: it means Wikidata, GLEIF, SEC EDGAR and court-judgment entities
land in one shared type system instead of four bespoke ones, and it makes the graph exportable to
tools investigators already use.

**Caveat worth stating.** FtM's provenance model is lighter than what the brief requires. It
tracks which dataset an entity came from; it does not natively carry page/offset/extraction-method
evidence at the granularity of the brief's Evidence schema. **Extend it — do not assume it covers
provenance.**

**Licence.** MIT. Reusable in any commercial posture.

---

## 2. nomenklatura (`opensanctions/nomenklatura`) — **MIT — adopt**

**What it is.** Entity resolution over FtM entities. Components:

- **Index / cross-reference blocking** — inverted index to generate candidate pairs without
  O(n²) comparison.
- **Resolver graph** — the core. Stores merge decisions and computes connected components to
  assign "the best available ID for a cluster of entities" (canonicalisation).
- **Adjudication UI** — text-based interface for human same / different / undecided decisions,
  with transitive closure (A≡B, B≡C ⇒ A≡C candidate).
- **Persistence** — decisions stored in SQL (SQLite by default, configurable via
  `NOMENKLATURA_DB_URL`).

**Why it matters here.** This is a direct implementation of the brief's Phase 4B deduplication
ladder and its requirement to "preserve merge decisions and evidence". Blocking → scoring →
human adjudication threshold → persisted decisions is exactly the described design, already
built and MIT-licensed.

**Recommendation.** Adopt as the entity-resolution substrate. The resolver graph in particular
should not be reimplemented — connected-components identity management with reversible decisions
is subtle, and getting it wrong produces silently over-merged entities, which in an investigative
system means asserting two different people are the same person.

**Licence.** MIT.

---

## 3. OpenSanctions (`opensanctions/opensanctions`) — **code MIT, data CC BY-NC 4.0**

**Code.** Contains `zavod` (parse → clean → deduplicate → export framework) plus per-source
crawlers, built on FtM. `yente` (matching API) and `nomenklatura` are companions.

**Data.** Consolidated sanctions lists, PEPs and watchlists, already normalised and cross-source
deduplicated. Structurally the single best-shaped entity/relationship dataset in the registry
(20/27 task fit).

**The split, verified from the repository README:**

> "The code within this repository is licensed under the MIT License. For content and data, we
> adhere to CC 4.0 Attribution-NonCommercial."

**This is the exact hazard the brief warned about, and it is real.** NonCommercial is a
substantive restriction, not boilerplate — OpenSanctions sells Screening and Reseller/OEM
licenses precisely for commercial use. For a police/government-oriented platform this is not
hypothetical: an agency deployment, a licensing arrangement, or any commercialisation puts
NC-licensed training data in breach.

**Recommendation.**
- **Adopt:** zavod's collector *pattern* (source manifest → crawler → normalise → export with
  provenance). It is a good model for the brief's Phase 3 framework.
- **Do not ingest the data** until the project's commercial posture is decided in writing.
- If the answer is "non-commercial research only, forever, in writing", OpenSanctions moves to
  Tier A and becomes the strongest entity-resolution corpus available. That is a genuine option
  — it just has to be a decision, not a default.

---

## 4. Microsoft Presidio (`microsoft/presidio`) — **MIT — adopt as one layer**

**What it is.** PII detection and de-identification: Analyzer (detection), Anonymizer
(redaction), Image Redactor (images and DICOM), Structured, and a CLI. Detects credit cards,
names, locations, SSNs, crypto wallets, US phone numbers and financial data, extensible with
custom recognisers combining NER, regex, rule logic and checksums.

**The limitation, in the project's own words.** The repository states plainly:

> "because it is using automated detection mechanisms, there is no guarantee that Presidio will
> find all sensitive information."

This aligns with the brief's rule 1.5 — never rely on a single automated detector.

**Gap that matters for this project.** Out-of-the-box recognisers are US-centric. **Indian
identifiers need custom recognisers**: Aadhaar (12-digit with Verhoeff checksum), PAN
(`[A-Z]{5}[0-9]{4}[A-Z]`), Indian mobile formats (+91, 10-digit starting 6–9), IFSC, GSTIN,
vehicle registration, PIN codes. These do not exist by default and must be built and tested.

Note the governance implication: Aadhaar is on the project's prohibited-collection list. The
Aadhaar recogniser exists to **detect and quarantine**, never to store.

**Recommendation.** Presidio = layer 1. Layers 2 and 3 are deterministic rules for Indian
identifiers and a quarantine-plus-manual-review queue, per the brief's Phase 4C.

---

## 5. OpenAleph (`openaleph/openaleph`) — **reference architecture**

**What it is.** The maintained successor to OCCRP's discontinued Aleph, now under the Data and
Research Center (DARC). Ingests unstructured documents (PDF, Word, HTML) and structured data
(CSV, XLS, SQL), indexes them, and cross-references known entities such as names and companies
across datasets. Uses **FollowTheMoney** as its schema. Deployment: PostgreSQL + Elasticsearch +
Redis + Python services + web UI. ~11,900 commits, actively developed.

**Why it matters.** This is, in substance, a working implementation of a large part of what
NetIntel AI describes: evidence ingestion, document extraction, entity extraction, cross-dataset
entity matching, and search over an investigative corpus.

**Blunt observation.** If OpenAleph already does most of the ingestion and cross-referencing
layer, the differentiating work in NetIntel AI is the layer *above* it — topology analytics,
spatial/temporal corroboration, the investigation Copilot, and the observed/corroborated/
algorithmic/inferred/lead distinction. Rebuilding ingestion from scratch spends time on the
part that is already solved and commoditised. Worth deciding consciously rather than by
momentum.

**Action required:** verify the exact licence in `LICENSE.txt` before any code reuse — the
README references it without naming it, and Aleph's history includes AGPL-style terms which
would have real implications for a deployed product.

---

## 6. dedupe (`dedupeio/dedupe`) — **MIT — evaluate, probably don't adopt**

**What it is.** Python library for "accurate and scalable fuzzy matching, record deduplication
and entity-resolution", based on Bilenko's dissertation on learnable similarity functions. Uses
blocking plus a learned pairwise classifier. Actively maintained by DataMade; commercial
Dedupe.io service alongside.

**The catch.** It requires **human-labelled training pairs** via active learning before it
performs well. That is labelling work you do not currently have budget for, on top of the
labelling the ML tasks already need.

**Recommendation.** nomenklatura is the better fit because it is FtM-native and its resolver
graph matches the brief's provenance requirements. Keep dedupe as a fallback for
**record-level** deduplication of tabular sources (e.g. corporate registry rows) where FtM
modelling is overkill. Do not run two entity-resolution systems in parallel.

---

## 7. Apache Tika (`apache/tika`) — **Apache-2.0 — adopt**

"Detects and extracts metadata and text from over a thousand different file types (such as PPT,
XLS, and PDF)." Deployable as a Java library, CLI (`tika-app`), or server. Optional modules
include `tika-langdetect` and `tika-ml`; OCR integrates via Tesseract.

**Fit.** Directly serves the brief's document-extraction stage, and the Indian court-judgment
corpus (SRC-007) will need exactly this — those PDFs range from born-digital to scanned, so OCR
is not optional.

**Caveat.** Tika is JVM-based. If the pipeline is Python-first, run `tika-server` as a container
rather than embedding it; the `tika` Python bindings silently download and spawn a JAR, which is
a reproducibility problem for a pipeline that must pin versions.

**Licence.** Apache-2.0. Permissive with a patent grant. Fine commercially.

---

## 8. Frictionless Data (`frictionlessdata/frictionless-py`) — **optional**

A specification (Table Schema, Data Package) plus a Python implementation for describing and
validating tabular data. Serves the brief's Phase 2B "machine-readable schemas" and Phase 5
schema-validity gate for tabular sources.

**Honest assessment.** For a project of this scope, JSON Schema plus `pydantic` covers the same
ground with fewer moving parts and better ecosystem support. Frictionless earns its place only
if you want Data Package manifests as the interchange format for published datasets. Adopt the
*Data Package manifest* idea; the library is optional.

*Licence stated as MIT — confirm in the repository LICENSE file before vendoring.*

---

## 9. Scrapy (`scrapy/scrapy`) — **BSD-3-Clause — do not adopt**

Scrapy is a crawling framework: it is built to follow links across a site and discover pages.
Every source approved in this registry is reached by **bulk file download, a public S3 bucket, a
REST API, or a SPARQL endpoint**. None requires crawling.

Adopting Scrapy would put a general-purpose crawler in a repository whose governance rules
prohibit indiscriminate scraping (rule 1.1). That is a bad artifact to have present even unused
— it invites exactly the pattern the rules forbid, and it looks bad in any review.

**Recommendation.** Use `httpx` or `requests` with explicit per-source endpoints, a token-bucket
rate limiter, and a source-ID binding that makes arbitrary URLs unreachable by construction.
Reject Scrapy explicitly and record the reason.

---

## 10. What this means for the collection framework

Rather than the framework sketched in Phase 3, the audit suggests:

```
registry (source-registry.csv, status-gated)
    │
    ├─ collector: bound to source_id, never a free URL
    │     ├─ token-bucket rate limiter (SEC: hard 10/s)
    │     ├─ declared User-Agent + contact email
    │     ├─ content hash + manifest + retrieval timestamp
    │     └─ resumable, idempotent, dry-run, sample mode
    │
    ├─ extraction:  Apache Tika (documents) │ native parsers (JSON/CSV/Parquet)
    ├─ normalise:   → FollowTheMoney entities (MIT)
    ├─ privacy:     Presidio + Indian-identifier rules + quarantine  ← 3 layers
    ├─ resolve:     nomenklatura index → resolver graph → adjudication
    └─ provenance:  KILT-style spans (page/paragraph/char offsets) on FtM entities
```

Net effect: **four MIT/Apache components replace roughly the whole of Phases 3–4** except the
privacy rules for Indian identifiers and the provenance extension to FtM, which are genuinely
project-specific and are where the build effort belongs.

---

## 11. Verification still required

| Item | Why |
|---|---|
| `openaleph/LICENSE.txt` exact terms | AGPL vs permissive materially changes reuse |
| `frictionless-py` LICENSE file | Stated MIT, unconfirmed from primary source |
| Transitive dependency licences for any adopted package | Rule: no GPL/AGPL transitive dependency enters the runtime without review |
| OpenNyAI Legal-NER dataset licence | Referenced in registry SRC-008 notes, unverified |

None of these blocks Phase 1. All of them block vendoring code.

---

**Primary sources:**
[followthemoney](https://github.com/alephdata/followthemoney) ·
[nomenklatura](https://github.com/opensanctions/nomenklatura) ·
[opensanctions](https://github.com/opensanctions/opensanctions) ·
[OpenSanctions licensing](https://www.opensanctions.org/licensing/) ·
[presidio](https://github.com/microsoft/presidio) ·
[openaleph](https://github.com/openaleph/openaleph) ·
[dedupe](https://github.com/dedupeio/dedupe) ·
[tika](https://github.com/apache/tika) ·
[scrapy LICENSE](https://github.com/scrapy/scrapy/blob/master/LICENSE)
