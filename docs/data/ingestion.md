# Evidence Ingestion Workflow (P5.2)

**Status**: Implemented. This is the first real investigation workflow —
synthetic evidence selection → ingestion → validation → normalization →
provenance-preserving persistence → loaded investigation state. It covers
ingestion only; extraction, entity resolution, graph synthesis,
analytics, corroboration, the Copilot, and the dossier are later
milestones.

Everything ingested is the fully synthetic **Operation DarkNet Delhi**
corpus (`docs/data/corpus.md`). No real data enters at any point.

---

## 1. Demo workflow

```bash
npm install
npm run dev            # http://localhost:3000
```

1. Open `http://localhost:3000`. The workspace shows **No investigation
   loaded** with a synthetic-data-only notice.
2. Click **Start ingestion**.
3. Watch the eight real ingestion stages advance (this is the actual
   pipeline, not a timed animation); the persistence stage reports
   `written / total` records as it goes.
4. On completion the workspace shows **Investigation loaded** with the
   deterministic evidence summary:

   | | count |
   | --- | --- |
   | Evidence sources | 6 |
   | Evidence items | 1,820 |
   | Communications | 1,150 |
   | Financial transactions | 560 |
   | Locations | 14 |

   plus the per-type breakdown (5 FIRs, 15 suspect records, 1,150 CDR
   events, 560 transaction records, …).
5. Reload the page — the investigation stays loaded. Click **Re-run
   ingestion** — it reports *"already ingested — no records were
   changed"*.

The local SQLite file lives at `DATABASE_URL` (default `./data/cipher.db`),
created and migrated automatically on first ingestion.

---

## 2. Ingestion pipeline

`src/lib/ingestion/service.ts` — `runIngestion(source, onEvent?)` runs
eight explicit stages and returns a structured `IngestionResult`. It
never throws for an expected failure; every failure is a
`status: "failed"` result with a user-safe `error`.

| # | Stage | What it does |
| --- | --- | --- |
| 1 | `input` | Resolve the source: the built-in corpus (`evidence/synthetic/operation-darknet-delhi.json`) or an uploaded JSON value. |
| 2 | `file_validation` | Readable JSON, object-shaped, has `corpus` + `evidenceItems`. Rejects a held-out **ground-truth** file here. |
| 3 | `schema_validation` | Full `CorpusManifestSchema` (Zod) parse. |
| 4 | `normalization` | `materializeCorpus` → validated domain objects. Preserves original identity, source reference, source location, evidence type, timestamps, structured fields, provenance, warnings and validation state. Invents nothing. |
| 5 | `id_assignment` | Verify every id is a deterministic content-addressed id (`makeContentId`), no collisions. |
| 6 | `provenance` | Verify every structured row (locations, communications, transactions) carries all six provenance fields tracing to a real source evidence item; verify source evidence stays `accepted`; verify nothing is classified `ai_inference` or `algorithmic_signal`. |
| 7 | `persistence` | Idempotent write through the P4.2 validated repository layer only. |
| 8 | `result` | Assemble the `IngestionResult`. |

The streaming route handler `POST /api/ingestion` emits one
newline-delimited JSON `IngestionEvent` per stage transition (and per
persistence sub-batch), ending with `{ "type": "result", ... }`.
`GET /api/ingestion` returns the current `InvestigationState`.

---

## 3. Normalization

Normalization reuses `src/lib/corpus/load.ts` — the same loader P5.1
uses. It is deterministic: a given corpus version/seed always yields the
same domain-row ids, the same provenance, and the same in-evidence
timestamps. Source evidence and its normalized representation are kept
distinct:

- **Source evidence**: `evidence_sources` + `evidence_items` (raw
  `content` preserved verbatim, `validationStatus: "accepted"`).
- **Normalized/observational projection**: `locations`,
  `communication_events`, `financial_transactions` — each carrying a
  full `provenance` object whose `source` is the id of the evidence
  item it was projected from, `method` `corpus-projection:<version>`,
  and the fixed corpus `timestamp`. Entity foreign keys are left
  unresolved (that is entity resolution's job, a later milestone).

Ingestion output is never classified as AI inference.

---

## 4. Deterministic IDs & idempotency

- Every id is `makeContentId(kind, [...canonical parts])` — content
  addressed, no random component. The investigation id is
  `makeContentId("investigation", ["operation-darknet-delhi", "1.0.0"])`.
- **First ingestion** → every row created (`{ created: 3551, skipped: 0 }`).
- **Repeat ingestion** → an `app_meta` completion marker
  (`ingest:operation-darknet-delhi@1.0.0`) is found → status
  `already_ingested`, persistence skipped, zero writes.
- Idempotency does **not** depend on the marker: `idempotentPersist`
  loads the ids already in each table and skips any row whose
  deterministic id is present. A retry after a partial failure inserts
  only the missing rows.

---

## 5. Ground-truth isolation

The normal ingestion path can never load
`evidence/ground-truth/operation-darknet-delhi.ground-truth.json`:

- the built-in source is hardcoded to `evidence/synthetic/…`;
- no `src/lib/ingestion` module imports the ground-truth loader or
  addresses the held-out directory;
- an uploaded file containing answer-key fields
  (`expectedEntityMerges`, `hiddenConnections`, `intendedConclusions`,
  `expectedCopilotAnswers`, …) is rejected at `file_validation` with
  `GROUND_TRUTH_REJECTED` and nothing is persisted;
- `tests/unit/ingestion.test.ts` asserts all of the above, and that no
  answer-key content reaches the database.

---

## 6. Error taxonomy

Every error is `{ code, stage, message, issues? }` — a stable code, a
plain-language message, the stage it failed at, and sanitized issue
lines (schema paths only). No stack traces, filesystem paths, or
secrets are shown.

| Code | Cause |
| --- | --- |
| `INVALID_FIXTURE` | File missing / not JSON / not a corpus-manifest shape. |
| `MALFORMED_EVIDENCE` | Fails `CorpusManifestSchema`. |
| `UNSUPPORTED_EVIDENCE_TYPE` | An evidence item's `itemType` is outside the supported set. |
| `VALIDATION_FAILURE` | A normalized domain record fails validation, or an id / provenance invariant is violated. |
| `GROUND_TRUTH_REJECTED` | The input is a held-out ground-truth answer key. |
| `PERSISTENCE_FAILURE` | A repository write failed mid-persist (store may be partially populated; re-run to finish — already-written rows are skipped). |
| `INTERNAL_ERROR` | Any other unexpected error (details logged server-side only). |

---

## 7. Investigation state

`src/lib/ingestion/summary.ts` — `getInvestigationState()` returns
`{ status: "empty" }` or `{ status: "loaded", summary }` from the
domain tables + the ingestion marker. The client workspace layers the
transient run phase on top: `no_investigation` → `in_progress`
(streaming stages) → `completed` / `failed`. The summary exposes counts
and identity only — never ground-truth information.

---

## 8. Local & deterministic

Ingestion is entirely local: one SQLite file, one JSON corpus file, no
Anthropic call, no Docker, no external database, no queue, no worker
infrastructure. The 1,820-item corpus ingests in ~1–2 seconds on the
verified development environment.
