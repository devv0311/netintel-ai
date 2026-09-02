# Evidence Extraction Pipeline (P5.3)

**Status**: Implemented. This is the second real investigation workflow —
select ingested evidence → parse content → extract explicit facts →
validate → attach provenance → persist, deterministically and
idempotently. It covers extraction only; entity resolution, graph
synthesis, analytics, corroboration, the Copilot, and the dossier are
later milestones.

Everything extracted comes from the already-ingested, fully synthetic
**Operation DarkNet Delhi** corpus (`docs/data/corpus.md`,
`docs/data/ingestion.md`). No real data enters at any point, and
extraction reads only already-persisted application evidence — never a
file, never `evidence/ground-truth/`.

---

## 1. What extraction is — and is not

Extraction identifies and structures **facts explicitly stated by a
single piece of source evidence**. Per `docs/contracts/agent-contracts.md`
(Agent 1) and `docs/requirements.md` §5 "Information extraction":

- a source names a person → an entity mention
- a source lists a phone number, IMEI, account, or vehicle → an entity
  mention
- a source associates an alias, a phone, an account, or a vehicle with a
  named record → a relationship mention (source-local, not a merge)
- a source records a communication event, a financial transaction, or a
  crime event → an event mention
- a source states an attribute (a FIR number, a role, a vehicle colour,
  a witness statement's text) → an attribute mention

Extraction does **not**:

- resolve whether two mentions refer to the same real-world entity
  (entity resolution — a later milestone)
- infer a relationship not explicitly stated by a single source
  (relationship inference — a later milestone)
- construct a graph, compute topology, or corroborate/contradict across
  sources (later milestones)
- draw any investigative conclusion (culpability, money-mule status,
  "suspicious" activity) — even when a source's own field literally says
  `"accountKind": "mule"`, extraction reproduces that field verbatim as
  an observed fact about what the source states; it does not add a
  suspicion label of its own

Every `ExtractedRecord` is classified **Observed Fact**
(`docs/requirements.md` §7) — never Corroborated Fact, Algorithmic
Signal, AI Inference, or Investigative Lead. Classification is a
top-level field on the record, kept separate from `provenance.confidence`
per §7 and §11 of this milestone's brief.

---

## 2. Demo workflow

```bash
npm install
npm run dev            # http://localhost:3000
```

1. Ingest the corpus (`docs/data/ingestion.md`) — "Start ingestion".
2. Once the investigation is loaded, the evidence workspace shows
   **Extract explicit facts from evidence** with an **Extract Evidence**
   button.
3. Click it. Watch the seven real extraction stages advance (the actual
   pipeline, not a timed animation).
4. On completion the workspace shows **Evidence extracted** with counts
   by record type (entity/event/relationship/attribute mentions) and a
   representative, paginated list of extracted facts — each showing its
   fact type, observed value, source reference, provenance, confidence,
   and evidence classification.
5. Reload the page — the extracted state stays. Click **Re-run
   extraction** — it reports the run is already complete, with no
   records changed.

---

## 3. Extraction pipeline

`src/lib/extraction/service.ts` — `runExtraction(onEvent?)` runs seven
explicit stages and returns a structured `ExtractionResult`. It never
throws for an expected failure; every failure is a `status: "failed"`
result with a user-safe `error`.

| # | Stage | What it does |
| --- | --- | --- |
| 1 | `select_evidence` | Load every evidence item for the current investigation from the store; keep only `validationStatus: "accepted"` items. |
| 2 | `parse_content` | Verify every selected item's `content` is a well-formed structured object. |
| 3 | `extract_facts` | Run the deterministic, per-evidence-type field extractor (`src/lib/extraction/extract.ts`) over every item's `content`, producing unvalidated candidates. |
| 4 | `validate_records` | Re-validate every candidate against `ExtractedRecordSchema` (Zod) — a malformed record is reported with detail, not silently dropped. |
| 5 | `attach_provenance` | Verify every record's provenance traces to a real, currently-persisted evidence item and is classified exactly `observed_fact`. |
| 6 | `persistence` | Idempotent write through the P4.2 validated repository layer only (`insertExtractedRecord`). |
| 7 | `result` | Assemble the `ExtractionResult`. |

The streaming route handler `POST /api/extraction` emits one
newline-delimited JSON `ExtractionEvent` per stage transition (and per
persistence sub-batch), ending with `{ "type": "result", ... }`.
`GET /api/extraction` returns the current `ExtractionState`.
`GET /api/extraction/facts?offset=&limit=` returns a paginated,
representative page of extracted facts (never the full corpus in one
response — capped server-side at 100 per page).

---

## 4. Supported evidence types and extracted facts

All 12 evidence item types from `docs/data/synthetic-investigation-spec.md`
§2 are covered. Every extractor reads only fields present on the single
evidence item it is given — never another item.

| Evidence type | Extracted facts |
| --- | --- |
| `fir` | Each name in `accused` → entity mention (person). `firNumber`, `filedAt` → attribute mentions. `seizedVehicle` (when present) → entity mention (vehicle) + attribute mention (colour). |
| `suspect_record` | `name` → entity mention (person). `role`, `residence`, `note` → attribute mentions. Each `phones`/`accounts`/`vehicles`/`knownAliases` entry, and `linkedPhone` → relationship mentions (`has_phone`, `has_account`, `has_vehicle`, `has_alias`). |
| `alias_record` | `alias` ↔ `primaryName` → relationship mention (`alias_of`) — a source-local association, not an entity merge. |
| `phone_record` | `number` → entity mention (phone). `imei`, `subscriberName` → relationship mentions. |
| `imei_record` | `imei` → entity mention (imei). `boundNumber` → relationship mention. |
| `vehicle_record` | `plate` → entity mention (vehicle). `colour` → attribute mention. `registeredTo` → relationship mention. |
| `bank_account_record` | `account` → entity mention (bank_account). `accountKind` → attribute mention (reproduced verbatim, including literal `"mule"`/`"shell"` values the source itself records). `holderName` → relationship mention. |
| `location_record` | `label` → entity mention (location), carrying `locationType`/`latitude`/`longitude`. |
| `cdr_event` | One event mention per record: caller, callee, timestamp, duration, cell tower. |
| `financial_transaction_record` | One event mention per record: transaction ref, from/to account, amount, currency, value date. |
| `witness_statement` | `text` → attribute mention (verbatim). Each `aboutNames` entry → entity mention (person). Free text is never parsed for additional structure. |
| `crime_event` | One event mention: event id, timestamp, FIR number, nearest tower, scene label. |

Over the full Operation DarkNet Delhi corpus (1,820 evidence items) this
produces **1,996 extracted records**: 99 entity mentions, 60 attribute
mentions, 123 relationship mentions, 1,714 event mentions (one per CDR +
one per transaction + one per crime event).

---

## 5. Provenance

Every `ExtractedRecord` carries the full six-field provenance object
(`docs/requirements.md` §8):

- **source** — the evidence item id the fact was read from.
- **location** — `<content.recordRef>#<field path>` (e.g.
  `suspect:S1#phones[0]`, `fir:003#seizedVehicle.colour`) — traceable to
  the exact field within the source record, not just the record.
- **method** — `extraction:field-read:<itemType>`.
- **confidence** — extraction quality only (how faithfully the field was
  read), never inflated for a fact appearing in multiple sources or for
  a fact drawn from a multi-element array. For this structured,
  unambiguous corpus every field-read is confidence `1`.
- **processingHistory** — `["evidence_item:<id>", "extraction:<factType>"]`
  — extraction's own step is appended, not a replacement of any prior
  chain (evidence items carry no upstream provenance of their own to
  preserve).
- **timestamp** — the real wall-clock instant the extraction run
  executed, shared by every record that run produces, and distinct from
  any in-evidence event timestamp (`startedAt`, `occurredAt`, …), which
  is preserved verbatim inside the record's own `data`.

---

## 6. Deterministic IDs & idempotency

- Every record id is `makeContentId("extracted_record", [evidenceItemId, fieldPath])`
  — content-addressed, no random component. Re-running extraction on
  unchanged evidence recomputes byte-identical ids.
- **First extraction** → every record created.
- **Repeat extraction** → every id already exists → `status: "already_extracted"`,
  `{ created: 0, skipped: N }`.
- **Partial-failure retry** → `idempotentPersistExtractedRecords`
  (`src/lib/extraction/persist.ts`) loads the ids already in
  `extracted_records` and skips any row already present, so a retry
  after a partial write persists only the records that are still
  missing.

---

## 7. Non-inference guarantees

Extraction is structurally incapable of merging identities or inferring
relationships: every fact is built from exactly one evidence item's own
`content` fields, in a single pass, with no cross-item comparison
anywhere in `src/lib/extraction/`. In particular, over the real corpus:

- The two structurally-distinct "Vikram Singh" evidence mentions (the
  FIR's `accused` entry and the suspect record's `name`) remain
  independent records from independent evidence items — nothing links
  them.
- Spelling-variant suspect records (`"R. Malhotra"`, `"Rohan M."`,
  `"Malhotra, Rohan"`, `"Kabir Sharman"`, …) each produce their own
  entity mention. Their source's own `note` field
  ("registry spelling variant — same individual") is extracted verbatim
  as an attribute — extraction reports what the source says, but never
  acts on it by merging records.
- Contradictory records (e.g. FIR 3's seized-vehicle colour "white" vs.
  a witness statement describing a different colour) both survive in
  the extracted set, unreconciled.
- No relationship or event mention connects the known hidden S1↔S4
  connection directly — only what each source itself states is
  extracted.
- Money-mule account/transaction facts are reproduced with their
  source's own literal field values and nothing else — no
  extraction-added `materiality`, `suspicious`, or mule-path label.
- Misleading, low-value relationships (small personal transfers,
  unrelated calls) are extracted exactly like any other observed fact —
  extraction applies no materiality judgment.

`tests/unit/extraction.test.ts` asserts all of the above against the
real corpus, plus per-evidence-type coverage, provenance/classification/
confidence behavior, deterministic ids, idempotency, partial retry, and
ground-truth isolation (a source scan proving no `src/lib/extraction/`
module imports the ground-truth loader or addresses
`evidence/ground-truth/`, mirroring `tests/unit/ingestion.test.ts`).

---

## 8. Error taxonomy

Every error is `{ code, stage, message, issues? }`. No stack traces,
filesystem paths, or secrets are ever shown.

| Code | Cause |
| --- | --- |
| `NO_INVESTIGATION` | Extraction was requested before any evidence was ingested. |
| `UNSUPPORTED_EVIDENCE_TYPE` | An evidence item's `itemType` has no registered extractor (defensive — unreachable via the normal ingested-evidence path, since the domain schema already restricts `itemType`). |
| `VALIDATION_FAILURE` | A candidate record fails `ExtractedRecordSchema`, an evidence item's content is malformed, or a provenance/classification invariant is violated. |
| `PERSISTENCE_FAILURE` | A repository write failed mid-persist (store may be partially populated; re-run to finish — already-written records are skipped). |
| `INTERNAL_ERROR` | Any other unexpected error (details logged server-side only). |

---

## 9. AI usage

None. Extraction over this structured, schema-validated synthetic corpus
is entirely deterministic field-reads — no Anthropic API call, no
nondeterminism, per this milestone's brief ("prefer deterministic
extraction for the structured synthetic corpus").

---

## 10. Local & deterministic

Extraction is entirely local: the same SQLite file ingestion uses, no
new file, no Anthropic call, no Docker, no external database, no queue,
no worker infrastructure. The full 1,820-item corpus extracts in well
under a second on the verified development environment.
