# CIPHER — operating rules for AI sessions

Durable, repository-wide rules. **No volatile state lives here** — no HEAD, no test
counts, no current task, no model metrics. Those live in the canonical documents
below, which you read at the start of a session instead of being told in a prompt.

---

## 1. What this project is

CIPHER (repository slug `devv0311/netintel-ai`, deliberately not renamed) is a
**demonstration** investigative-intelligence platform: evidence ingestion →
extraction → deterministic entity resolution → graph synthesis → topology
analytics → spatial/temporal corroboration → grounded Copilot → dossier. It is
not production software and makes no production-readiness claim.

Two data classes exist and are **never mixed**:

| | Operation DarkNet Delhi | Public registers |
|---|---|---|
| Nature | **Synthetic**, fixed seed | **Real** company records (Wikidata, GLEIF, SEC EDGAR) |
| Subjects | Fictional people and cases | Legal entities only; no natural person |
| Used for | The demonstration flow | Resolver evaluation and ML training |
| Never used for | Training, or any real-world claim | The demonstration narrative |

No real FIR, CDR, bank, Aadhaar, phone, financial-identifier, private or
classified data may enter this repository at any point.

## 2. Canonical documents — read before acting, in this order

| Question | Authority |
|---|---|
| What is built / closed / in progress / blocked / next | **`docs/progress/README.md`** |
| Did task X complete, at which commit | **`docs/progress/implementation-ledger.md`** |
| What must the system do | `docs/requirements.md` |
| What may I build with | `docs/architecture/stack-contract.md` (ADR-001: `technology-stack.md`) |
| How is the ML model exposed | `docs/architecture/ml-integration.md` |
| How does pipeline stage X behave, with measured counts | `docs/data/<stage>.md` |
| How good is the model, on what | `docs/evaluation/README.md` → `ml-final-test-4.md`, `ml-model-card.md` |
| What a dataset may be used for | `docs/evaluation/ml-evaluation-protocol.md` §2 |
| Where data came from, under what licence | `docs/data-research/source-registry.md`, `docs/evaluation/ml-dataset-card.md` |
| Git, branch and secret protocol | `docs/repository-governance.md` |
| What a screenshot proved, and when | `docs/progress/evidence/**` (**historical**) |

**One fact, one home.** A changing number is owned by exactly one document;
everywhere else links to it. Never copy a metric into a second current-state
document — link instead.

## 3. Repository state beats conversation

The repository and **measured** behaviour are authoritative. A prompt, a summary,
a memory or an earlier session's claim is a hypothesis. Verify before you write:
read the file, run the check, inspect the artifact. Never restate a number you
have not seen produced.

**Fact vs inference.** State what you measured, cite where it came from, and mark
anything you concluded as a conclusion. "The suite passes" requires having run it.

## 4. Architectural boundaries — do not cross without an approved decision

- **The deterministic resolver is frozen.** `src/lib/resolution/` decides identity.
  It is byte-identical to `af22018`; keep it that way. It never merges on fuzzy
  similarity, and an ambiguous match stays deliberately unmerged.
- **ML is advisory only.** `src/lib/ml/` emits an `algorithmic_signal` — a score,
  its threshold, its model version, the deterministic verdict beside it, and every
  feature behind it. It merges nothing. **No resolver code path may call it.**
  Promoting it to a merge is an owner decision, not an implementation detail.
- **AI never contributes a fact.** Claims are built in deterministic TypeScript
  from persisted records and carry that record's classification and confidence; a
  model is used for wording only, and its output is discarded whole on any
  guardrail failure.
- **Evidence classification is a one-way ladder.** `observed_fact` /
  `corroborated_fact` / `algorithmic_signal` / `ai_inference`. Nothing promotes a
  claim up it. Assembly stages carry the source row's own label forward unchanged.
- **Provenance is mandatory.** Every record traces to the evidence item it came
  from. A stage that cannot classify or trace a claim fails loudly and writes nothing.
- ADR-001 §10 lists technologies that must **not** be reintroduced (Neo4j,
  PostgreSQL, vector DBs, Docker app services, LLM agent frameworks). A new ADR is
  required to change that.

Preserve existing architecture unless the task requires changing it. If a test
fails, fix the cause — never edit frozen code to make a test pass.

## 5. Completed-phase protection

A phase recorded `Completed` in the ledger is closed. Do not reopen it, re-run its
training, regenerate its artifacts, or "improve" its numbers as a side effect of
another task. **A frozen test is spent once read** — never re-score a spent test to
support a new decision (`docs/evaluation/ml-evaluation-protocol.md`).

Historical documents and evidence captures stay historical. When counts change,
correct the **current-state** document and leave the point-in-time record as
captured, saying what superseded it.

## 6. Handling stale or conflicting documentation

Documentation drifts; that is expected, not an error to hide.

1. Verify against the repository.
2. Fix the document whose job is current state.
3. If two documents claim the same dynamic fact, pick one canonical home and make
   the other link to it.
4. If a document was true at its date, add a status header saying what superseded
   it — do not rewrite its findings.
5. Never delete something that is the only record of how a decision was reached.

## 7. Evidence and provenance for your own work

- **Every number you publish must be regenerable** from committed artifacts by a
  command in the repository. Cite the artifact path.
- **Major features require visual evidence** — `docs/progress/visual-evidence-convention.md`.
  Never fabricate, stage or relabel a capture.
- **Distinguish an environment blocker from a product failure.** "Browsers not
  installed", "egress blocked", "no API key" are environment facts: report them as
  such, never as a passing result and never as a product defect. Conversely, never
  file a real defect as an environment problem.

## 8. Testing expectations

- `npm test` (Vitest), `npm run test:e2e` (Playwright), `npm run typecheck`,
  `npm run lint`, `npm run build` must all be green before a commit is accepted.
- Current counts are **not** recorded here — they live in the ledger row for the
  most recent increment.
- Pipelines are deterministic and idempotent: re-running a stage must produce the
  same result. Tests assert that; keep it true.
- A fixture expectation that disagrees with measured output is a defect in one of
  the two. Find out which before changing either.

## 9. Git discipline

`implement → validate → commit → push → verify remote`. Nothing is complete until
it is on `origin/master`.

- Atomic, logically-scoped commits with a real message; no batching unrelated work.
- **No destructive history operations** — no force push, no rebase of pushed
  commits, no branch deletion, no `reset --hard` on shared history — without an
  explicit request.
- **Never commit secrets.** Real keys live in a git-ignored `.env`; `.env.example`
  holds placeholders only. Scan the tree before committing.
- Do not commit generated artifacts, local databases, or pre-existing untracked
  files that are not part of your change.
- A commit hash is recorded in the ledger only once it exists. Never invent one;
  `Pending` is the honest placeholder.

## 10. Finishing a task

Before reporting completion:

1. Validation is green and you ran it.
2. The **ledger** has a row: status, owner, real commit hash, visual proof, test
   status, demo readiness.
3. Every current-state document the change touched is updated.
4. The work is pushed and the remote verified.

Report outcomes faithfully. If something failed, was skipped, or is blocked on an
owner decision, say so plainly with the evidence — a blocked item reported as done
is worse than a blocked item.

---

@AGENTS.md
