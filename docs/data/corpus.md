# Operation DarkNet Delhi — Synthetic Investigation Corpus (P5.1)

**Status**: Generated and committed. This document describes the corpus
that now exists under `evidence/`, per
`docs/data/synthetic-investigation-spec.md` and
`docs/data/ground-truth-spec.md`. It covers only the evidence corpus and
its deterministic loading/validation (blueprint Workstream A / M3, tasks
A1–A5). No pipeline stage (extraction, entity resolution, graph
synthesis, analytics, corroboration, Copilot, reporting) is implemented
by this milestone.

Everything in the corpus is **entirely fictional**. It contains no real
person, phone number, account, device, address, FIR, or case data.

---

## 1. Identity — version and seed

| Field | Value | Where |
| --- | --- | --- |
| Corpus name | `operation-darknet-delhi` | `src/lib/corpus/config.ts` |
| Corpus version | `1.0.0` | `CORPUS_VERSION` |
| Deterministic seed | `20260901` | `CORPUS_SEED` |
| Fixed derivation instant | `2026-01-01T00:00:00.000Z` | `CORPUS_GENERATED_AT` (stamped as `provenance.timestamp` on every structured row) |
| In-case timeline | `2025-06-01` → `2025-09-08` | `CASE_START` / `CASE_END` |
| Manifest canonical fingerprint | `f3a1acb45643a1f1e3a31ed660a940e79f3e5c011498d980c2e252454c979c62` | sha256 of the canonical form |
| Ground-truth canonical fingerprint | `71c026e59fd5a69f8399cb535be1e2be4e0d454f2e460ffbe0188df8a0a2ed75` | sha256 of the canonical form |

Bumping `CORPUS_VERSION` is the only sanctioned way to change the
dataset, and requires a matching ground-truth re-author and a ledger
note (`docs/data/synthetic-investigation-spec.md` §5).

---

## 2. Counts

### Application evidence — `evidence/synthetic/operation-darknet-delhi.json`

| Evidence item type | Count | Required minimum |
| --- | --- | --- |
| `fir` | **5** | 5 |
| `suspect_record` | 15 (8 canonical primary suspects + 7 spelling-variant mentions) | 8 primary suspects |
| `alias_record` | 18 | — |
| `phone_record` | 14 | — |
| `imei_record` | 14 | — |
| `vehicle_record` | 4 | — |
| `bank_account_record` | 12 (8 personal + 1 shell + 3 mule) | — |
| `location_record` | 14 | — |
| `cdr_event` | **1,150** | 1,000+ |
| `financial_transaction_record` | **560** | 500+ |
| `witness_statement` | 10 | — |
| `crime_event` | 4 | — |
| **Total evidence items** | **1,820** | — |
| Evidence sources | 6 | — |

Structured observational projections (the P4.2 tables built "for the full
dataset"), each carrying full provenance back to its source evidence
item:

| Table | Count |
| --- | --- |
| `communicationEvents` | 1,150 (1:1 with `cdr_event`) |
| `financialTransactions` | 560 (1:1 with `financial_transaction_record`) |
| `locations` | 14 (8 synthetic cell towers, 3 crime scenes, 3 residences) |

### Ground truth — `evidence/ground-truth/operation-darknet-delhi.ground-truth.json`

Covers every category in `docs/data/ground-truth-spec.md` §3:

| Content | Count |
| --- | --- |
| Principal suspects (key actors) | 8 |
| Intermediaries (3 money mules + 1 communication intermediary) | 4 |
| Expected entity merges | 12 (8 suspects + 4 intermediaries) |
| Do-not-merge look-alike pairs | 1 |
| Alias → entity mappings | 18 |
| Expected relationships | 44 (3 explicitly non-explicit / indirect) |
| Hidden connections | 1 |
| Money-mule paths | 1 (4 hops / 5 accounts, ≈₹1.76M routed on the first hop, 145 tranche txn refs) |
| Temporal correlations | 4 |
| Spatial correlations | 3 |
| Contradictions | 3 |
| Misleading (noise) relationships | 5 |
| Expected communities | 3 |
| Expected analytics signals | 3 |
| Intended conclusions | 5 |
| Expected Copilot answers | 8 (one per canonical demo question) |

---

## 3. Investigative complexity (spec §4)

Every required structural property is deliberately built in — see
`src/lib/corpus/case-design.ts` (each is tagged `// [spec §4: ...]`):

| Property | How it is realised |
| --- | --- |
| **Aliases** | 8 suspects each have 2–4 aliases; 18 `alias_record` items; `suspect_record.knownAliases`. |
| **Duplicate / ambiguous identities** | Spelling variants ("Rohan Malhotra" / "R. Malhotra" / "Rohan M.", "Kabir Sharma" / "Kabir Sharman") as separate mentions that must merge; **plus** two different people named "Vikram Singh" (accused enforcer vs. bystander witness) that must **not** merge. |
| **Conflicting statements** | 3 contradictions: S5's whereabouts on 2025-07-19 (W3 vs. W7, with CDR support for W3); seized-vehicle colour (FIR 3 white vs. W5 silver); "SilkFox" handle owner (W2 vs. W9). |
| **Indirect relationships** | S1↔S4 (hidden), S3↔S7 (via X1), S1↔S6 (via mules) — true in the data, stated nowhere. |
| **Temporal correlations** | S1-phone-2 & S4 co-active on SYN-CT-07 (2025-08-14 23:05–23:35); S3 & S7 both call X1 within the same hour on 6 days; S5 on SYN-CT-02 at C1 time; S2 & S6 co-active on SYN-CT-05 during the W4 handoff. |
| **Intermediary actors** | M1/M2/M3 (money mules) and X1 (Rahul Mehta) — the sole communication bridge between the vendor and courier sub-cells. |
| **Money-mule pattern** | `SYN-AC-000001` (S1) → `SYN-MA-000001` (M1) → `SYN-MA-000002` (M2) → `SYN-MA-000003` (M3) → `SYN-SH-000001` (S6 shell), in sub-threshold tranches — reconstructable by walking `fromAccount`/`toAccount` across `financial_transaction_record` contents. |
| **Misleading low-value relationships** | S2↔S8 and S5↔S8 personal transfers (₹150–₹500); S7→food-delivery, S4→dental-clinic, S5→cab-dispatch calls. Present in the data with **no** "noise" marker — the pipeline must judge materiality. |
| **Known hidden relationship** | S1 (financier) and S4 (chemist) — **no** direct call and **no** direct transaction anywhere. Recoverable only by combining the laundering path (`M3 → SYN-AC-000004`) with the SYN-CT-07 co-location that covers the C2 lab-raid site. This is the demo's "hero" finding. |

### Demo-contract entity bindings

`docs/demo/demo-contract.md` §3 leaves the entities in questions 2, 3 and
7 to be fixed "once the case is generated". Fixed here (in
`case-design.ts` `DEMO_QUESTION_BINDINGS`; the demo-contract document
itself is not edited by this milestone):

- **Q2** (direct relationship?) — Kabir Sharma (S3) & Imran Sheikh (S7): none direct; only via X1.
- **Q3** (financial connection + path?) — Rohan Malhotra (S1) & Neha Kapoor (S6): the mule chain above.
- **Q7** (intermediary linked to >1 principal?) — Rahul Mehta (X1): linked to S3 and S7.

---

## 4. The application-evidence / ground-truth boundary

Two strictly separate layers, per `docs/data/ground-truth-spec.md` §2:

| | Application evidence | Ground truth |
| --- | --- | --- |
| File | `evidence/synthetic/operation-darknet-delhi.json` | `evidence/ground-truth/operation-darknet-delhi.ground-truth.json` |
| Loader | `src/lib/corpus/load.ts` — `loadInvestigationCorpus()` | `src/lib/corpus/ground-truth.ts` — `loadInvestigationGroundTruth()` |
| Contains | Raw/observational evidence only | Expected merges, aliases, relationships, hidden connections, mule paths, temporal/spatial correlations, contradictions, communities, signals, intended conclusions, expected Copilot answers |
| Reachable from the pipeline? | Yes — this is what the pipeline processes | **Never.** Not imported by `src/lib/corpus/load.ts`, `persist.ts`, `generate.ts`, `validate.ts`, `manifest-schema.ts`, `index.ts`, or anything under `src/lib/db/**` or `src/lib/domain/**`. |

`src/lib/corpus/index.ts` deliberately does **not** re-export the
ground-truth loader, keeping it off the convenient
`import … from "@/lib/corpus"` path. `tests/unit/corpus.test.ts` asserts
the whole boundary automatically (a source scan plus a check that the
loaded evidence object contains no expected-answer keys).

---

## 5. Fixture format

The corpus manifest (`src/lib/corpus/manifest-schema.ts`,
`CorpusManifestSchema`) **is** the P4.2 synthetic-fixture format
(`src/lib/fixtures/schema.ts`) scaled up — not a second format:

- same concepts: one investigation, evidence sources, evidence items with
  a free-form `content` record whose shape is implied by `itemType`;
- same domain enums (`EvidenceItemTypeSchema`, `EvidenceSourceTypeSchema`,
  `LocationTypeSchema`, …);
- same rule that **the file never carries an authoritative primary key** —
  the loader assigns every domain-row id via `src/lib/domain/ids.ts`
  (`makeContentId`), exactly as the `foundation-smoke` loader does.

It adds `corpus` metadata (version, seed, `generatedAt`) and first-class
arrays for the three structured observational tables P4.2 defined for the
full dataset (`locations`, `communicationEvents`, `financialTransactions`),
each linked to an evidence item by a local `ref`. The P4.2
`foundation-smoke` fixture and its loader are untouched.

---

## 6. Synthetic safety

Every generated identifier cannot be mistaken for a real one
(`src/lib/corpus/synthetic-identifiers.ts`):

- **Phone numbers** use ITU country code **`+99`** (unassigned) —
  `+99 70 NNN NNNN`.
- IMEIs (`SYN-IMEI-…`), bank accounts (`SYN-AC-/MA/SH-…`), vehicle plates
  (`SYN-VEH-…`), transaction refs (`SYN-TXN-…`), cell towers (`SYN-CT-…`)
  all carry an explicit `SYN-` marker and follow no real format.
- FIR numbers are namespaced `ODD/SYN/2025/NNN`.
- Coordinates are generic points inside a coarse Delhi-NCR bounding box
  with clearly-fictional labels ("Synthetic Cell Tower CT-03",
  "Fictional crime scene — Karol Bagh warehouse (synthetic)"); none is
  tied to a real address or incident.

The validation routine sweeps all evidence content for real-looking
patterns (`+91` numbers, 12-digit Aadhaar-style, IFSC, PAN, 15-digit
IMEI) and asserts none appear.

---

## 7. Determinism

Generation is a pure function of `(CORPUS_VERSION, CORPUS_SEED)`:

- One seeded PRNG (`src/lib/corpus/prng.ts`, mulberry32) drives every
  stochastic choice, in a fixed call order.
- All in-evidence timestamps derive from the fixed `CASE_START`; all
  `provenance.timestamp` values are the fixed `CORPUS_GENERATED_AT`.
- IDs are content-addressed (`makeContentId`) — including the
  investigation id (`makeContentId("investigation", [name, version])`),
  which is deterministic here, unlike the ad-hoc `foundation-smoke`
  loader's opaque id, because the corpus is a fixed versioned dataset.
- Canonicalisation (`src/lib/corpus/canonicalize.ts`) sorts object keys;
  generation already emits arrays in a fixed order.

`npm run corpus:generate` regenerates the two committed files; it aborts
unless two back-to-back generations are canonically identical **and**
every structural check passes. `tests/unit/corpus.test.ts` pins both
canonical fingerprints and asserts the committed files still match the
generator.

---

## 8. Procedures

### Generation

```bash
npm run corpus:generate
```

Runs `scripts/generate-corpus.ts` (via `scripts/ts-resolve.mjs`, a tiny
dependency-free Node resolve hook). Emits:

- `evidence/synthetic/operation-darknet-delhi.json`
- `evidence/ground-truth/operation-darknet-delhi.ground-truth.json`

both as sorted-key pretty JSON, and prints the counts, the PASS/FAIL
validation report, and both fingerprints.

### Loading application evidence

```ts
import { loadInvestigationCorpus } from "@/lib/corpus";
import { persistCorpus } from "@/lib/corpus/persist";

const loaded = loadInvestigationCorpus();     // validates + assigns deterministic IDs + provenance
await persistCorpus(loaded);                   // inserts via src/lib/db/repository.ts ONLY
```

`loadInvestigationCorpus()` validates the file against
`CorpusManifestSchema`, then re-validates every derived domain object
through `validateOrThrow(<DomainSchema>)`. `persistCorpus()` writes every
row through the P4.2 validated repository layer — it never touches
Drizzle, the schema, or the client directly, so provenance and
Zod validation are enforced on the way in.

### Loading ground truth (evaluation only)

```ts
import { loadInvestigationGroundTruth } from "@/lib/corpus/ground-truth";
const gt = loadInvestigationGroundTruth();     // held-out; call only after pipeline output exists
```

### Validation

```ts
import { generateCorpusManifest, generateGroundTruth, validateCorpus } from "@/lib/corpus";
const report = validateCorpus(generateCorpusManifest(), generateGroundTruth());
// report.ok === true; report.checks is the 16-line PASS/FAIL list
```

`tests/unit/corpus.test.ts` (38 tests) covers, deterministically: the 4
volume floors; each of the 9 structural properties; synthetic safety;
ground-truth isolation (source scan + no-leak check); schema rejection of
malformed input; deterministic regeneration (fingerprint pins +
committed-file sync); and the full database path (empty → migrate → load
→ persist → verify counts → verify provenance round-trip).
