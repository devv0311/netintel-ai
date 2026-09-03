# Real-data pilot — GLEIF (SRC-002)

**Date:** 2026-09-03
**Command:** `node --import ./scripts/eval-resolve.mjs scripts/real-data-pilot.ts`
**Results:** `reports/real-pilot/gleif-pilot-results.json`
**Raw payloads:** `data/public/raw/SRC-002/2026-09-03T19-05-00-000Z/` (immutable)
**Normalised records:** `data/public/raw/SRC-002/2026-09-03T19-09-00-940Z/`

The first real public-register data to enter this pipeline. Everything below is
measured on **24 real GLEIF LEI records and 1 real Level 2 relationship record**, not
on a fixture. Where a number is not a real-world measurement, it says so.

---

## 1. What was collected

| | |
|---|---|
| Source | SRC-002 GLEIF LEI, registry status APPROVED |
| Licence | CC0 1.0 — `https://www.gleif.org/en/meta/lei-data-terms-of-use` |
| Requests | 5 (2 jurisdiction pages, 1 name search, 1 relationship record, 1 single LEI) |
| Raw payloads | 5 files, 67,273 bytes, each hashed individually |
| Unique LEI records | **24** (1 duplicate detected across payloads and dropped) |
| Level 2 relationship records | **1** (`IS_FUND-MANAGED_BY`) |
| Retrieval channel | `agent-relay` — see `docs/data-research/network-access-diagnosis.md` |
| Wikidata records | **0 — access blocked on every official endpoint** |

Bounded by construction: `--limit 30` against an adapter whose `MAX_LIMIT` is 500,
against a register of 3.4 million records. Nothing resembling bulk collection was
performed or is expressible with this tool.

The set is deliberately two-part: 16 records taken by jurisdiction (`IN`), which supply
ordinary Indian corporate name morphology — `PRIVATE LIMITED`, `LLP`, sole
proprietorships registered under a natural person's name with a trading name attached —
and 8 records from one real corporate family (Carnelian), which supply near-collision
names across distinct legal entities.

## 2. Results

```
  evidence items          24          entities created        24
  extracted records      272          aliases persisted        7
  graph nodes             24 (organisation)   graph edges       0

  subjectsRecoveredWhole   100.0%  (24/24)
  falseMergeRate             0.0%  (0/24)
  fragmentationRate          0.0%  (0/24)
  unresolvedOrAmbiguous      0.0%  (0/24)
  aliasAttachment          100.0%  (7/7)     ← 0.0% before the fix in §3
  provenanceCompleteness   100.0%  (327/327)

  resolution types:  new_entity 24   (no other type fired, at all)
```

**Read the resolution histogram before reading anything else.** All 24 records resolved
as `new_entity`. Not one merge of any kind occurred, so `falseMergeRate 0%` and
`subjectsRecoveredWhole 100%` are **not** evidence that the resolver is accurate. They
are arithmetic: a resolver that never merges cannot merge wrongly, and a subject
represented by exactly one record is recovered whole by doing nothing. Quoting those
two figures as real-world accuracy would be the single most misleading thing this
document could do.

What the run *does* establish, with real records:

- The `public_record` path ingests real registry data end-to-end without schema
  violation — 24 records → 272 extracted facts → 24 entities → graph, no rejections.
- Provenance survives the whole pipeline on real data: **327/327 rows** carry all six
  required fields. This is the one metric with a defined pass threshold, and it passes.
- Real name morphology is preserved verbatim: no suffix stripping, no case folding.
- There were **zero exact name collisions** among 24 real entities — including
  `Carnelian Energy Capital IV, L.P.` versus `CARNELIAN ENERGY CAPITAL V, L.P.`, which
  differ only in a roman numeral and case. Tier B (byte-exact name match) was therefore
  never in a position to merge wrongly here. That is a fact about this sample, not a
  safety property of Tier B.

## 3. Real failures found

Two defects that the synthetic corpus never exposed. Both were found by real data;
neither is a resolver *matching-strategy* weakness.

### 3.1 Publisher aliases were silently discarded — FIXED

`extractPublicRecord` emits alias facts with `relationshipType: "alias_of"`
(`extract.ts:475`). Resolution accepted only `"has_alias"` (`resolve.ts:367`). The two
halves of the system disagreed on one string, so **every publisher-stated alias on
every public record was dropped without warning** — 0 of 7 attached.

This survived the synthetic corpus because no synthetic evidence type routes aliases
through `public_record`; the P6.6 fixture showed it as `aliasMatchRate 0.0% (0/1)`,
where n=1 was small enough to read as resolver weakness rather than a wiring bug.

Fixed by widening the accepted predicate set to `["has_alias", "alias_of"]` — one line,
no change to matching logic. Measured consequence:

| | before | after |
|---|---|---|
| Real-data `aliasAttachment` | 0.0% (0/7) | **100.0% (7/7)** |
| All 21 synthetic evaluation metrics | — | **byte-identical** |

The synthetic run was re-executed specifically to confirm the second row, because a
change that moved an existing evaluation number would have been out of scope for this
milestone regardless of its merit.

### 3.2 Real ownership relationships do not reach the graph — NOT FIXED, needs a decision

GLEIF's Level 2 record states that LEI `9845003F0DE4FCF83E11` (Carnelian Bharat
AmritKaal Fund 3) `IS_FUND-MANAGED_BY` LEI `335800VMJECJV6ML2349` (Carnelian Asset
Management & Advisors Private Limited). Both entities are in the corpus. The relation is
correctly extracted and persisted as a `relationship_mention`, and then **produces no
graph edge**: `edgesByType: {}`.

Two independent causes:

1. `graph/build.ts` maps `relationship_mention` → edge through `PERSON_ANCHORED` and a
   handful of named types. `registry_relation` matches none of them and falls through
   silently.
2. `RELATIONSHIP_TYPES` is `communication · financial · co_location · family ·
   associate · ownership · other`. Fund management is not ownership, and mapping it
   there would assert a beneficial-ownership claim the publisher did not make.

This is deliberately left unfixed. It is not a bug with an obvious one-line answer; it
is a modelling question — whether registry-stated corporate relations get a
first-class relationship type, or are carried as `other` with the publisher's predicate
in the attributes — and `rel.precision` / `rel.recall` are live evaluation metrics, so
changing edge construction changes existing evaluation semantics. That needs a decision,
not an improvisation.

## 4. What this pilot could not test

The honest limits, stated because the numbers above look better than the evidence
supports.

1. **Cross-source co-reference — not tested at all.** One register was collected.
   Wikidata, the other half of the approved pair, is unreachable. No subject in this
   corpus appears in two independently-published records, so the resolver's central
   function was never exercised on real data.
2. **Within-source co-reference — structurally absent.** A register publishes one
   record per legal entity. Tier B needs two records naming the same subject; GLEIF, by
   construction, does not provide them. Collecting *more* GLEIF records would not help:
   240 records would produce 240 `new_entity` decisions exactly as 24 did.
3. **Name-variation recall — still unvalidated.** GLEIF states one legal name per
   entity, so suffix, transliteration, abbreviation and name-ordering variants *of the
   same subject* do not occur in this data. The P6.6 findings on those four categories
   therefore remain what they were: characterisations of resolver behaviour on a
   synthetic fixture, **not** real-world measurements.

## 5. Recommended next step

**Obtain cross-source co-reference before touching the resolver.** Every ranked
recommendation in `docs/evaluation/resolver-failure-analysis.md` — suffix normalisation
first — is still a hypothesis from synthetic morphology, and this pilot did not
validate any of them, because the data could not.

The smallest thing that changes that is a second publisher naming the same legal
entities. In order of preference:

1. **Re-run collection over `direct-https` from an unrestricted network** (no code
   change; also upgrades the pilot's hash from custody to wire-byte). If Wikidata
   becomes reachable, `collect:public --source wikidata` already exists, and the
   `indian-companies-with-lei` query is written to join the two registers on LEI —
   which is exactly the Tier-A anchor plus independent name variation the resolver
   needs.
2. **Resolve §3.2** so registry-stated corporate structure becomes graph structure.
3. Only then re-run the generalisation experiment against real cross-source records,
   and let the observed failures — not the synthetic ones — select the resolver change.

Do not add fuzzy matching, embeddings or LLM adjudication on the strength of this run.
Nothing here measured a name-matching failure on real data.
