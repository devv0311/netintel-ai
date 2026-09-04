# P6.19 — From an evaluation corpus to a training corpus, and whether ML is justified yet

**Date:** 2026-09-04
**Sources:** GLEIF (SRC-002), Wikidata (SRC-001), **SEC EDGAR (SRC-006, newly used)**
**Resolver matching logic:** unchanged. One persistence defect fixed (§7.1); no tier,
threshold, rule or confidence was altered.
**Ground truth:** the P6.16 corpus is untouched and stays held out. The new corpus is separate.

---

## 0. Two corrections to the brief this phase inherited

Both were verified in code before anything was built on them.

1. **The shipped resolver was at 70.7% (53/75), not 88.0%.** The 88.0% figure was P6.18's
   *measured projection* of rules it explicitly proposed and did **not** enable —
   `git diff 44e578c 6171ddb -- src/` is empty — and five of its thirteen gained pairs
   depended on Wikidata `P1448` data that was not in the corpus.
2. **There was no P6.19 before this one.** The ledger ended at P6.18.5.

One environment change worked in our favour: the local runtime now has egress to both
publishers, so everything below was collected on the `direct-https` path with payload
hashing, rather than through the inadmissible `agent-relay` route P6.18 was stuck with.

---

## 1. What was already present — the audit (`scripts/corpus-audit.ts`)

Read-only, nothing recollected. It found three defects that no additional record count
would have fixed:

| | Measured |
|---|---|
| records | 257 (179 GLEIF + 78 Wikidata) |
| distinct LEIs | 180 · ground-truth subjects 182 |
| positive pairs | 75 · hard negatives 19 · undetermined 2 |
| **source pairings** | **positives: `gleif x wikidata` ×75 — and nothing else. Negatives: `gleif x gleif` ×19 — and nothing else.** |
| **script distribution** | **Latin 255 (99.2%)**, Cyrillic 1, Han+Kana 1 |
| name length | 1 token 25 · 2 tokens 120 · 3 tokens 74 · 4–5 tokens 36 · 6+ 2 |
| aliases | 102/257 records (39.7%), 107 strings |
| identifiers | GLEIF-only by construction (179); FULL regime 0/257 |
| **relationship coverage** | **0 — `relations[]` is masked by the corpus builder** |
| duplicates | none (0 duplicate record ids, 0 same-name-within-source) |
| **leakage** | **10 subjects appear in both a positive pair and a hard negative; the Devanagari pilot shares 54 of 75 subjects with the main corpus** |

The three findings that mattered:

- **One source pairing.** A resolver — or a model — measured only here learns *GLEIF house
  style versus Wikidata house style*, which is not entity resolution.
- **No script diversity**, because the linkage set was filtered to India.
- **The "second" corpus was never independent.** The Devanagari pilot is the same 54
  subjects re-viewed through their Hindi labels, so it could never have served as a
  held-out set.

---

## 2. Data gaps, by what the evidence can actually support

| Class | Real examples then | Bucket | Why |
|---|---|---|---|
| identical, capitalisation, punctuation, legal suffix | 53 joined | **A — deterministic** | Solved; 92–98% on the new corpus too |
| dotted legal form (`B.V.`), leading article | 2 | **A — deterministic** | P6.18 defect fix + one rule |
| containment / abbreviation | 9 | **A, with a precision cost** | §6 measures the cost honestly |
| divergent (brand vs legal name) | 12 | **B — needs authoritative evidence** | `ORAVEL STAYS LIMITED` / `OYO Rooms` share no character. Not a string problem |
| parent/subsidiary | 3 | **D — ML must not be used** | A policy question about what "same entity" means, not a matching question |
| transliteration / script | 1 (+51 in a non-independent pilot) | **C — ML might help** | P6.18: transliteration turns a script problem into a spelling problem |
| publisher aliases | 107 strings | **B** | Measured in P6.17.4, deliberately not enabled |
| genuinely unrelated same-name entities | 19 | **A — needed as negatives** | Far too few to prove safety, as §6 now shows |
| conflicting / missing identifiers | 2 undetermined | **A** | Policy implemented in P6.15.1 |
| relationship evidence | **0** | **B** | Absent from the corpus entirely |

---

## 3. Sources investigated

Priority was official registries, then government open data. Nothing was bulk-downloaded
during research; every probe was bounded and read-only.

| Source | Verdict |
|---|---|
| **Wikidata (SRC-001, APPROVED, CC0 1.0)** | **Used.** The adapter requested four fields and Wikidata publishes far more. `P1448` official name (~29,700 LEI-bearing items worldwide), `P1813` short name, `P1320` OpenCorporates id (~28,600), `P5531` SEC CIK (~2,100). Worldwide there are ~43,800 LEI-bearing items against the India-filtered slice we had been using. |
| **GLEIF (SRC-002, APPROVED, CC0 1.0)** | **Used.** Level 1 records already carried `ocid` (an OpenCorporates id) and `entity.registeredAs` + `registeredAt` (the entity's number in its **national** register — an Indian CIN, a UK company number). Both were being discarded by the adapter. |
| **SEC EDGAR (SRC-006, APPROVED_WITH_RESTRICTIONS, US Government work / public domain)** | **Used.** Already in the registry, so no new approval was required. Restrictions are 10 req/s and a declared User-Agent with a contact address, both enforced in the adapter rather than by convention. |
| Companies House (UK) | **Rejected for now** — free but requires registering for an API key. Creating an account on the user's behalf is out of scope. A strong future candidate: Wikidata publishes `P2622`. |
| OpenCorporates | **Rejected** — bulk/API access is licence-restricted for this use. Note that GLEIF *publishes OpenCorporates ids under CC0*, so the id is usable as a join key without touching OpenCorporates itself. |
| Open Ownership, EU BRIS, India MCA | **Rejected** — bulk-download-only, or no open API. |
| Research ER benchmarks (Abt-Buy, WDC, etc.) | **Rejected** — different domain (products), and they would not produce cross-source *register* evidence. |

### 3.1 One earlier finding re-tested, and confirmed against me

P6.16 rejected EDGAR because it publishes no LEI. The submissions schema *does* contain an
`lei` key, which looked at first like grounds to overturn that. **It was null for all 20
filers probed, so P6.16's rejection stands** and is restated in the adapter's own header.
EDGAR does **not** join GLEIF directly. It joins Wikidata through the CIK, and its real
value is its own name variants.

---

## 4. What was collected

Three bounded collections, all `direct-https`, raw payloads written before anything derived
and individually hashed.

| Source | Query / filter | Records | Raw | `rawSha256` (first 24) |
|---|---|---|---|---|
| Wikidata SRC-001 | `companies-with-lei-enriched`, LIMIT 800, **no country filter** | **663** | `data/public/raw/SRC-001/2026-09-04T03-07-48-927Z/` · 1 payload · 390,237 B | `b2e563fe3ab1bd64c93ccf83` |
| GLEIF SRC-002 | `--leis-from` the Wikidata records, limit 500 | **500** | `.../SRC-002/2026-09-04T03-08-22-399Z/` · 13 payloads · 1,423,529 B | `ecbae433e4153b9eb2a770a4` |
| SEC EDGAR SRC-006 | `--ciks-from` the Wikidata records, limit 120 | **100** | `.../SRC-006/2026-09-04T03-09-43-738Z/` · 100 payloads · 13,194,853 B | `f09874c32a48c27f5683368e` |

**Stopping condition:** one pass per source, bounded by each adapter's `--limit` and its own
`MAX_LIMIT`; no pagination beyond it, no retry loop, no second sweep. The linkage sets are
derived from already-collected approved records, never hand-typed and never crawled.

**Privacy:** only the company-level entity block is read. The adapter never requests a
filing and never touches EDGAR's `filings` content, so no natural person is collected —
which is why the registry's MEDIUM PII rating (officers named in Forms 3/4/5) does not bite.

Enrichment actually obtained, against the 10.3% official-name coverage of the India-filtered
sample: **officialName 221/663 (33.3%)**, OpenCorporates id 342 (51.6%), CIK 98 (14.8%),
EDGAR former names on 53 of 100 filers.

---

## 5. Ground truth (`scripts/build-expanded-corpus.ts`)

**A label is created only by an identifier or an explicit publisher assertion. Never by a
name.** No variant is manufactured; no model-generated label is used; no fuzzy similarity
appears anywhere in the builder.

| Basis | Meaning |
|---|---|
| `lei_shared` | two publishers state the same LEI (ISO 17442; GLEIF issues it) |
| `cik_shared` | two publishers state the same CIK (the SEC issues it) |
| `former_name` | the SEC states this filer previously filed under this official name — **one authority's temporal claim, kept as its own class** |
| `ocid_agrees` | both records also state the same OpenCorporates id — **corroboration only, never sufficient** |

**Hard negative** requires the two records to *share an identifier scheme and disagree on
its value*, **and** their names to actually collide. **Undetermined** is a record asserting
two or more distinct LEIs.

### 5.1 A correction I had to make to my own labels

The first build produced 320 hard negatives and the resolver appeared to falsely merge
**117** of them. Inspection showed they were not negatives at all: `UBER TECHNOLOGIES, INC.`
(GLEIF) and `Uber Technologies, Inc` (EDGAR) are one company. The rule had tested
*different identifier strings* (`LEI:x ≠ CIK:y`) rather than *disagreement within a shared
scheme* — and since EDGAR publishes no LEI and GLEIF no CIK, every correctly-resolved
GLEIF×EDGAR pair was being scored as a false merge.

The rule now requires comparability. **94 name-collision pairs are recorded as NOT
COMPARABLE and scored as neither.** The same flaw was present in the corpus-wide
false-merge metric and is fixed there too, where it had inflated the rate from 0.1% to
6.5%. Asserting a negative the evidence cannot support is the same failure as asserting a
positive on a name, and it happened to be one I introduced.

### 5.2 Result

| | Before (P6.16) | After (P6.19) |
|---|---|---|
| records | 257 | **1,245 scorable** (1,263 collected) |
| sources | 2 | **3** |
| cross-source positives | 75 | **578** |
| former-name pairs (separate class) | 0 | **79** |
| hard negatives | 19 | **146** |
| not-comparable name collisions | — | 94 (scored as neither) |
| undetermined | 2 | 11 |
| positive source pairings | 1 | **2** (`gleif×wikidata` 482, `edgar×wikidata` 96) |
| negative source pairings | 1 | **5** |
| script-variant positives | ~1 | **31** |
| divergent positives | 12 | **69** (+24 former-name) |
| OCID-corroborated positives | 0 | **193** |

**Leakage control.** Every subject used by the P6.16 evaluation corpus is **excluded**
(7 records dropped), so that 75-pair instrument remains a valid held-out measurement. What
remains is split **by subject, never by pair** — 278 training-candidate / 302 held-out
subjects — so no entity can appear on both sides. The split is unbiased: the shipped
resolver joins **40.9%** of the training half and **40.5%** of the held-out half.

---

## 6. Re-evaluation of the deterministic system

Full pipeline — ingestion → extraction → resolution → graph — in its own database, never
mixed with DarkNet Delhi, the synthetic fixtures or the P6.16 corpus. Per-record leak check
**CLEAN**.

| Metric | P6.16 corpus (75 pairs) | **Expanded corpus (578 pairs)** |
|---|---|---|
| `positivePairJoinRate` | 70.7% (53/75) | **40.7% (235/578)** |
| `falseMergeRate` | 0.5% (1/203) | **0.1% (1/994)** |
| `hardNegativeFalseMergeRate` | 0.0% (0/19) | **0.7% (1/146)** |
| `fragmentationRate` | 29.3% | 61.7% (298/483) |
| `selfReportedUnresolvedRate` | 9.3% | 39.9% (497/1245) |
| `provenanceCompleteness` | 100% | **100% (13,772/13,772)** |
| `crossSchemeMergesUnprovable` | — | 6.4% (64/994) — reported, never scored |

**The drop from 70.7% to 40.7% is not a regression.** The resolver is unchanged; the corpus
is harder and more honest. The old one was India-filtered and dominated by case and suffix
differences — the two classes deterministic normalisation already solves.

By name variation: identical **97.7%**, case-only **98.0%**, legal-suffix/punctuation
**92.3%** — and containment **0/160**, partial token overlap **0/69**, divergent **0/69**,
script variant **0/31**.

By source pairing: `gleif×wikidata` 38.4%, `edgar×wikidata` **52.1%** — the third publisher
is not harder, it is differently hard.

### 6.1 The deterministic ceiling, and P6.18's warning coming true

`scripts/expanded-deterministic-ceiling.ts` — measurement only, nothing enabled.

| Rule (none enabled) | Positives joined | Hard negatives merged |
|---|---|---|
| shipped | 249/578 (43.1%) | 3/146 (2.1%) |
| + dotted legal form, leading article | 262 (45.3%) | 4 (2.7%) |
| **+ publisher-stated official name** | **344 (59.5%)** | **4 (2.7%)** |
| + both of the above | 357 (61.8%) | 5 (3.4%) |
| + guarded prefix containment | **450 (77.9%)** | **10 (6.8%)** |

Two results matter more than the headline.

**The official name is worth +95 pairs at no additional precision cost.** That is the single
largest available gain in the project, it comes from a field the publisher already
publishes, and it is now *collected under CC0 with a verified hash* rather than probed.

**Guarded prefix containment doubles false merges — 5 → 10 — on 146 real hard negatives.**
P6.18 measured it at 0/19 and warned in writing that "zero measured cost is not zero risk"
because the corpus contained no counter-example. **It now contains counter-examples, and the
warning was correct.** The uniqueness guard fired 9 times here, against 0 in P6.18, so the
branch that was previously unexercised is finally doing work.

*Caveat, stated rather than buried:* this study is an upper bound. It unions any two records
sharing a key, whereas the shipped Tier B can only match **into** an existing Tier-A
cluster, so it reports 249/578 where the pipeline measures 235/578 — about 2.4 points
optimistic. Read the deltas, not the absolute values.

---

## 7. Tests, regression, and one real defect

`npx vitest run` — **615/615 passing** (612 + 3 new). `tsc --noEmit` clean, `eslint` clean.

Re-measured after the change:

- **DarkNet Delhi — all 21 metric values identical.**
- **GLEIF × Wikidata cross-source — byte-identical.**
- **No-identifier ANCHORED and FULL — byte-identical.**

### 7.1 The defect the bigger corpus found

The first pipeline run on 1,245 records died with `UNIQUE constraint failed: aliases.id`,
taking the **whole resolution stage** down — every metric read 0 and `unresolvedRate` read
100%.

`makeContentId` trims and lower-cases its parts, so an alias id is case-insensitive *by
design*: `PIONEER RAILCORP` and `Pioneer Railcorp` are one row. The emitter keyed its dedupe
map on the raw string, so both survived and persistence inserted one id twice. GLEIF
publishes exactly that pair of `otherNames` for real entities; the 257-record corpus simply
never contained one.

The fix makes the emitter agree with the id scheme — it keys on the canonical form, keeps
the publisher's own casing, and keeps the existing lowest-source-id tie-break. **No matching
logic, tier, threshold or confidence changed**, which is why all three prior corpora
re-measure identically. Pinned by `tests/unit/resolution-alias-id.test.ts` (3 tests) using
the real publisher strings that triggered it.

---

## 8. Provenance, licensing and reproducibility

| Source | Registry | Licence | Channel | Commercial use | Attribution |
|---|---|---|---|---|---|
| Wikidata | SRC-001 APPROVED | CC0 1.0 | `direct-https` | yes | not required |
| GLEIF | SRC-002 APPROVED | CC0 1.0 | `direct-https` | yes | not required |
| SEC EDGAR | SRC-006 APPROVED_WITH_RESTRICTIONS | US Government work / public domain | `direct-https` | yes | not required |

Governance: `issues_identifier_schemes=CIK` added to SRC-006, and `CIK: "edgar"` added to
`SCHEME_ISSUER_REGISTRY`, so the code and the registry cannot drift — the existing test
enforces it. **Declaring an issuer does not make a scheme mergeable:
`MERGEABLE_IDENTIFIER_SCHEMES` is still `{LEI}`.** A CIK carried by Wikidata is a
cross-reference, exactly as a Wikidata-carried LEI is.

**To reproduce:**

```bash
npm run collect:public -- --source wikidata --query companies-with-lei-enriched --limit 800
npm run collect:public -- --source gleif --leis-from data/public/raw/SRC-001/<ts>/public-records.json --limit 500
npm run collect:public -- --source edgar  --ciks-from data/public/raw/SRC-001/<ts>/public-records.json --limit 120
node --import ./scripts/eval-resolve.mjs scripts/build-expanded-corpus.ts
node --import ./scripts/eval-resolve.mjs scripts/expanded-experiment.ts
node --import ./scripts/eval-resolve.mjs scripts/expanded-deterministic-ceiling.ts
```

Live data changes, so record counts will drift; the stored raw payloads and their hashes are
the fixed evidential root, and `--from-dir` replays them.

**Known limitations.** (1) The ceiling study is an upper bound (§6.1). (2) GLEIF and EDGAR
share no identifier scheme, so 94 name collisions and 64 merges between them are
undecidable from identifiers alone. (3) `officialName` is carried and provenanced but read
by **no** resolution tier — enabling it is an owner decision. (4) Relationship evidence is
still absent; GLEIF Level 2 was not collected this phase. (5) The corpus is still
Latin-dominated: 31 script-variant pairs is better than 1, and still thin.

---

## 9. ML readiness

### **ML NOT JUSTIFIED — DETERMINISTIC / EVIDENCE METHODS PREFERRED**

Judged against the criteria, not a record count:

| Criterion | Status |
|---|---|
| enough labelled positives | **Yes** — 578 cross-source + 79 former-name, up from 75 |
| enough hard negatives | **No** — 146 against 578 positives. Real entity resolution is negative-dominated; this is inverted |
| sufficient diversity | **Partly** — 3 sources but only 2 positive pairings; 31 script variants is thin |
| multiple independent sources | **Yes** — GLEIF, Wikidata, SEC EDGAR |
| meaningful difficult cases | **Yes** — 160 containment, 93 divergent, 69 partial overlap, 31 script |
| held-out evaluation data | **Yes** — subject-disjoint, and unbiased (40.9% vs 40.5%) |
| no train/eval leakage | **Yes** — enforced in code; prior-evaluation subjects excluded outright |
| defensible labels | **Yes** — identifier-anchored only, and one bad rule of my own was caught and corrected |
| examples of the classes ML would address | **Not yet sized** — see below |

**The decisive reason is the last row.** The residual is not the ML target until the
deterministic rules already on the table have been applied to it, and they have not been:

- **+95 pairs are available from a field the publisher hands us for free**, at no measured
  precision cost. Training a model to recover what `P1448` states outright would be
  indefensible.
- **The next-largest class (containment, 160) is deterministic** — and now demonstrably
  costs precision (§6.1). That is a threshold and policy decision, not a learning problem.
- **Divergent names (93) are not a string problem at all.** `ORAVEL STAYS LIMITED` and
  `OYO Rooms` share no character; no model reading those two strings can succeed, because
  the information is not in them. More official-name coverage is the answer.
- **Script variants (31) are too thin to train on**, and P6.18 showed transliteration
  converts a script problem into a spelling problem.

After the safe deterministic rules, ~221 of 578 would remain — and only after they are
enabled and measured can anyone say honestly what a model would be for.

**What would change the verdict.** Enable the official-name rule and re-measure; settle the
parent/subsidiary policy; raise hard negatives to at least parity with positives; and get
script-variant pairs into the low hundreds from *independent* subjects. If a well-defined
residual then remains — most plausibly spelling-variant matching after transliteration —
that is a sizeable, honest ML problem with labels behind it.

**No ML training has begun, no embeddings, no LLM matcher and no fuzzy matching were added.**

---

## 10. Decisions required

| # | Decision | Evidence | Risk |
|---|---|---|---|
| 1 | **Enable `officialName` as its own Tier-B evidence type**, below `normalized_name_match`, naming the publisher in the decision row | +95 pairs (43.1%→59.5%), **no** extra hard-negative merges | Low — a publisher's own legal-name claim, now collected under CC0 with a verified hash |
| 2 | Enable the dotted-legal-form fix and leading-article rule (P6.18 #2, #3) | +13 pairs | Very low — #2 is a defect fix |
| 3 | **Guarded prefix containment — now measurable, and it costs** | +93 pairs, but hard-negative merges 5 → 10 (3.4% → 6.8%) | **Medium, and no longer hypothetical.** Needs an explicit precision/recall call |
| 4 | Parent/subsidiary policy | 3 cases in P6.16, more here | Decision, not code — it changes what "correct" means |
| 5 | Collect GLEIF Level 2 relationships next phase | Relationship coverage is 0 | Low — SRC-002 is approved and the adapter already maps relations |

**Recommended:** approve 1 and 2 now — both zero-cost and 2 is a defect fix. Take 4 before
3, because the parent/subsidiary answer changes what counts as a false merge in 3.
