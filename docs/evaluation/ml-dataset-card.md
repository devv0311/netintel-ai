# Dataset card — CIPHER entity-resolution pairs

Three datasets. They are not three attempts at one thing; each has a
different job, and mixing them would destroy what the others measure.

| Dataset | Version | Pairs | Role |
| --- | --- | --- | --- |
| `cipher-er-pairs` | 1.0.0 | 4,053 | P6.24. **Superseded**, kept for the head-to-head. Fails leakage check L12 retrospectively. |
| `cipher-er-pairs` | 2.0.0 | 10,764 | Trained and selected the shipped model. Its test partition is a **development** test. |
| `cipher-er-pairs-final-test` | 1.0.0 | 5,257 | The **final frozen test**. Overlap with either dataset above: **0 subjects**. |

---

## 1. Sources, licences and provenance

All data is real, collected from three publishers approved in
[`../data-research/source-registry.md`](../data-research/source-registry.md).
No synthetic data. No manufactured name variants. Every name, official
name and alias is the publisher's own string.

| Source | Registry | Licence | Licence URL | Channel |
| --- | --- | --- | --- | --- |
| SRC-001 | Wikidata | CC0 1.0 | `wikidata.org/wiki/Wikidata:Data_access` | direct-https |
| SRC-002 | GLEIF LEI (L1+L2) | CC0 1.0 | `gleif.org/en/meta/lei-data-terms-of-use` | direct-https |
| SRC-006 | SEC EDGAR | US Government work / public domain | `sec.gov/os/webmaster-faq` | direct-https |

All three permit training use and redistribution. **Operation DarkNet
Delhi and every synthetic fixture are excluded from all three datasets by
construction** and must never be mixed in.

**What is preserved for every collection run**, under
`data/public/raw/<source>/<retrievedAt>/`: the raw payload bytes as the
publisher sent them, `rawSha256` over those bytes, byte counts, the exact
endpoint and query, the retrieval channel, the licence and licence URL,
per-payload record counts, and every warning raised during transformation.
A manifest recording a hash of bytes kept nowhere is not provenance —
nobody can verify it and the derived records cannot be rebuilt.

`retrievalChannel` distinguishes `direct-https` (this process opened the
socket; `rawSha256` is a wire-byte hash) from `agent-relay` (retrieved
out-of-band because egress was blocked; the hash covers the *stored*
payload only). Every run in these three datasets is `direct-https`.

**Collection is bounded by construction, not by restraint.** The
collector takes a registry `source_id`, never a URL; endpoints and queries
are constants inside each adapter; `--limit` is capped by the adapter's
own `MAX_LIMIT`; there is no "fetch everything" mode. Cross-source linkage
sets are always derived from an already-collected approved source, never
hand-typed. `--dry-run` prints exactly what would be requested and exits
before any socket opens, and was run before every collection here.

## 2. `cipher-er-pairs` v2.0.0 — what the model learned from

Built by `scripts/build-corpus-v2.ts` → `scripts/ml/build-pair-dataset.ts`.

| | |
| --- | --- |
| Collection runs merged | Wikidata 4, GLEIF 14, EDGAR 2 |
| Distinct records collected | 3,575 |
| Excluded (prior-evaluation subject) | 257 |
| Undetermined (record states 2+ LEIs) | 28 |
| **Scorable records** | **3,290** |
| With a stated jurisdiction | 3,256, over **126 distinct jurisdictions** |
| Cross-source positives | **1,711** (gleif×wikidata 1,508, edgar×wikidata 203) |
| Curated hard negatives | **477** |
| Former-name pairs (own class, never trained) | 169 |
| Name collisions scored as NOT COMPARABLE | 247 |

Partitions, split by **subject** and grouped into connected components so
no labelled pair can straddle a boundary:

| Partition | Pairs | Positives | Curated hard neg | Mined hard neg | Sampled neg | Subjects |
| --- | --- | --- | --- | --- | --- | --- |
| train | 3,121 | 512 | 101 | 460 | 2,048 | 563 |
| validation | 951 | 177 | 25 | 41 | 708 | 183 |
| test (development) | 6,692 | 1,022 | 351 | 1,231 | 4,088 | 1,028 |

**The v1 → v2 change that mattered most was one field.** The P6.19
Wikidata query returned no jurisdiction at all, so every Wikidata record
carried a null, the jurisdiction breakdown had a single bucket, and the
three cross-border features could never fire on a Wikidata side. v2 adds
P17 → P297, the ISO 3166-1 alpha-2 country code — the same vocabulary
GLEIF already uses, so the publishers become comparable without a mapping
table of our own. It is a **feature** field: agreement never creates a
positive, disagreement never creates a negative. (§5 records what this
field does *not* mean.)

The v2 builder also merges **every** collection run rather than the
latest. Reading only the latest, as the P6.19 builder did, would have
discarded 1,678 of 1,743 GLEIF records.

## 3. `cipher-er-pairs-final-test` v1.0.0 — the untouched exam

Built by `scripts/build-final-test-corpus.ts`.

**Why it exists.** The v2 test partition stopped being a clean exam the
moment it informed a development decision, and it did: its false merges
were read, they were overwhelmingly corporate-family pairs, and two
features were added in response. Model *selection* never touched it —
that was always validation — but feature *design* did. Reporting it as
though it had stayed frozen would be the self-deception the leakage suite
exists to prevent.

So this corpus was collected **after** all feature work, from nine bounded
country queries (IN, GB, FR, JP, AU, BR, ZA, SG and what they bridge to),
which also widens jurisdiction coverage beyond the US/DE/CZ/NO
concentration an unordered worldwide `LIMIT` returns.

| | |
| --- | --- |
| Records collected | 5,400 |
| **Dropped because a prior dataset had seen the subject** | **3,312** |
| Excluded (prior-evaluation subject) | 257 |
| Scorable records | 1,801, over **46 jurisdictions** |
| **Pairs / positives / curated hard negatives** | **5,257 / 892 / 244** |
| Subjects | 963 |
| **Overlap with any partition of v1 or v2** | **0** |

Exclusion runs at the **record** level, not the pair level. Filtering only
the labelled pairs was tried first and was not enough: 1,563 of 2,520
subjects still appeared, because mined and sampled negatives are *derived*
from whatever records the corpus holds. The positives were clean and the
negatives were not.

It has **one partition**. Nothing in it is ever fitted on, so a
train/validation cut would only leave rows that look available for
training — and the builder's `--all-test` mode exists because carving one
silently discarded 20 curated hard negatives the evaluator never reads.

## 4. How a label is created

Fully specified in [`ml-label-specification.md`](./ml-label-specification.md).
In brief, and identical character-for-character across all three datasets:

- **Positive** — two publishers independently state the same LEI (ISO
  17442: one LEI, one legal entity) or the same SEC CIK.
- **Curated hard negative** — the two records *share an identifier scheme
  and disagree on its value*, **and** their names actually collide.
- **Sampled / mined negative** — same scheme, disagreeing value, without
  the name-collision requirement.
- **Not comparable** — no shared scheme (GLEIF publishes no CIK, EDGAR no
  LEI). Scored as neither. Getting this wrong once produced 117 false hard
  negatives.
- **Former name** — a temporal claim by one authority. Its own class,
  never cross-source agreement, never trained on.
- **Undetermined** — a record asserting 2+ distinct LEIs names no single
  legal entity. Kept, never scored.

**No label anywhere is created from name similarity, and no
model-generated label is used.**

## 5. Known limitations of the data

**`jurisdiction` conflates two different properties, and it is not yet
fixed.** GLEIF publishes the legal jurisdiction of *incorporation*
(Jersey, Cyprus, BVI); EDGAR publishes the US state of incorporation;
Wikidata P17 is the country the entity is *associated with*. So a
"conflict" between a GLEIF and a Wikidata record frequently means
"incorporated offshore, operating onshore" rather than "different
entities" — `CAPITAL COM SV INVESTMENTS LIMITED` (CY) and `Capital.com`
(AU) are one company. On the final test this costs real recall: 6 of 106
cross-border positives recovered, against the resolver's 54. Discovered by
reading the final test, therefore **not** to be fixed by tuning against it.

**The anchored regime is deliberate.** GLEIF keeps the LEI it issues;
every other record is masked behind a surrogate id and its identifiers are
withheld. For most records the identifier a label was derived from is not
merely unused by the model — it is physically absent from what the model
sees.

**Class balance is not natural.** Sampled negatives are drawn at 4 per
positive, so the negative-heavy ratio is a construction choice. Any
false-merge rate quoted over all negatives is therefore diluted, which is
why hard-negative rates are reported separately everywhere.

**Coverage is three publishers, corporate entities only.** No natural
persons, no vessels, no addresses. Latin script dominates; 106 of 892
final-test positives are script variants, which is the largest such slice
the project has had but is still not broad multilingual coverage.

## 6. Reproduction

Every count above regenerates from committed inputs — see
[`ml-reproduction.md`](./ml-reproduction.md).
