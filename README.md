# CIPHER

*A synthetic-data investigative intelligence platform for demonstrating evidence ingestion, entity resolution, relationship analysis, spatial/temporal corroboration, grounded investigation assistance, and report generation.*

> This project is not production software and makes no claim of production readiness. It exists to demonstrate an investigative-intelligence workflow end-to-end using synthetic data.

## Project Status

```text
Status: Implemented end to end on synthetic data · P6 ML closed · M10 UI in progress
```

**Canonical current state — what is built, closed, in progress, blocked and next —
is [`docs/progress/README.md`](./docs/progress/README.md).** Per-task truth, with
commit hashes and evidence, is the
[implementation ledger](./docs/progress/implementation-ledger.md). This section is
a summary and defers to both.

The full demonstration pipeline runs end to end, locally and deterministically,
against the Operation DarkNet Delhi synthetic corpus — ingestion → extraction →
deterministic entity resolution → graph synthesis → topology analytics →
spatial/temporal corroboration → grounded Investigation Copilot → dossier. No
Docker, and no network call is required at any stage. Each stage's contract,
guarantees and measured counts live in its own document under
[`docs/data/`](./docs/data/), which is canonical for those numbers.

An **advisory** entity-resolution model (P6.24–P6.28) ships alongside. It reads
**no identifier** — every label in the project is derived from identifier
agreement, so an identifier feature would be the answer rather than evidence —
and **it does not merge anything.** `src/lib/resolution/` is unchanged and remains
the sole authority on identity; the model emits an `algorithmic_signal` carrying
its score, threshold, model version, the deterministic verdict beside it, and
every feature value behind the number, so a suggestion is always shown with its
evidence and never as a fact. Its one measurement, the limits of the instrument
that produced it, and the reason it stays advisory are in
[`docs/evaluation/ml-final-test-4.md`](./docs/evaluation/ml-final-test-4.md) and
[`docs/evaluation/ml-model-card.md`](./docs/evaluation/ml-model-card.md); how it is
exposed is in [`docs/architecture/ml-integration.md`](./docs/architecture/ml-integration.md).
Those are the only places ML figures are quoted.

Remaining: the Map, Timeline and rich Evidence surfaces of the UI milestone (M10),
then integration hardening, evaluation and demo rehearsal (M11–M13). One owner
decision is open — parent/subsidiary policy, P6.21.2.

## ⚠️ Important Disclaimer

**This project uses exclusively synthetic, fabricated data for demonstration purposes.**

This project does **not** use, and must **never** use:

- Real First Information Reports (FIRs)
- Real Call Detail Records (CDRs)
- Real bank or financial records
- Aadhaar or other government-issued identity information
- Real phone numbers
- Real financial identifiers (account numbers, card numbers, UPI IDs, etc.)
- Private or classified investigative records
- Any data belonging to a real person, case, or investigation

All evidence, entities, cases, and datasets in the **demonstration corpus** are entirely fictional and generated for demonstration purposes only. Any resemblance to real individuals, organizations, or investigations is coincidental and unintended.

### Two data classes, never mixed

Since P6.5 the project also uses **real, openly licensed public-register data** — and the two are kept strictly apart:

| | Operation DarkNet Delhi (SRC-019) | Public registers (SRC-001 / 002 / 006) |
|---|---|---|
| Nature | **Synthetic**, generated from a fixed seed | **Real** company records |
| Subjects | Fictional people and cases | Legal entities only; no natural person |
| Sources | Project-owned | Wikidata (CC0 1.0), GLEIF (CC0 1.0), SEC EDGAR (US public domain) |
| Used for | The demonstration flow | Resolver evaluation and, from P6.24, model training |
| Never used for | Training, or any real-world claim | The demonstration narrative |

Operation DarkNet Delhi is registered **EVALUATION ONLY** and is **never** represented as real investigative data. The real public-register data contains no personal, private or restricted information: only company-level records under CC0 or public-domain terms, every one carrying its source, retrieval time, licence and payload hash.

## Demonstration Flow

Every stage below is **implemented and runnable** — see [Demo workflow](#demo-workflow)
for the walkthrough, and [`docs/data/`](./docs/data/) for each stage's contract and
measured output.

```text
Upload Evidence
      ↓
Ingestion
      ↓
Extraction
      ↓
Entity Resolution
      ↓
Graph Synthesis
      ↓
Analytics
      ↓
Spatial / Temporal Corroboration
      ↓
Investigation Copilot
      ↓
Dossier / Report
```

## Repository Structure

```text
netintel-ai/
├── CLAUDE.md              # Durable AI operating rules — read first
├── docs/                  # Project documentation
│   ├── architecture/        # ADR-001 stack, stack contract, ML integration boundary
│   ├── contracts/            # Interface / data contracts between pipeline stages
│   ├── data/                  # Synthetic corpus spec + one document per implemented stage
│   ├── data-research/          # Phase-1 public-source research, registry, licensing
│   ├── demo/                    # Demo contract
│   ├── evaluation/               # Evaluation + ML methodology, model/dataset cards, frozen tests
│   ├── progress/                  # Canonical project status, implementation ledger, visual evidence
│   └── training/                   # Training-feasibility record (historical)
├── evidence/               # Corpora — synthetic demo data and real public-register datasets
│   ├── ground-truth/         # Held-out answer key for the synthetic scenario
│   ├── synthetic/             # Operation DarkNet Delhi (the demonstration corpus)
│   ├── expanded*/ · final-test*/ · ml/ · no-identifier/ · public-pilot/
│   │                           # Real public-register corpora and frozen ML test sets
├── models/                 # Trained model artifacts (JSON; the shipped one is v2lr)
├── reports/                # Generated evaluation, experiment and ML reports — never hand-edited
├── data/                   # Local SQLite databases (git-ignored) + committed public/raw payloads
├── scripts/                # Corpus generation, evaluation, public collection, scripts/ml/ training
├── src/                    # Application source (Next.js App Router)
│   ├── app/                  # Routes, layout, global styles
│   ├── components/            # UI — components/ui (shadcn primitives), components/shell (app shell)
│   └── lib/                     # adapters/ (public-register collectors), ai/, analytics/, copilot/,
│                                   corpus/, corroboration/, db/, domain/, dossier/, evaluation/,
│                                   extraction/, fixtures/, graph/, ingestion/, ml/ (advisory
│                                   classifier), pipeline/, resolution/ (FROZEN), utils
├── tests/                  # tests/unit (Vitest), tests/e2e (Playwright)
├── drizzle/                # Generated SQL migrations
├── package.json, tsconfig.json, next.config.ts, drizzle.config.ts,
│   vitest.config.ts, playwright.config.ts, components.json
├── .env.example            # Environment variable template (no real secrets)
├── .gitignore
├── LICENSE
└── README.md
```

Each `docs/` subdirectory contains its own `README.md` explaining its purpose, current status, and what has intentionally **not** been decided yet.

## Development Rules

- **GitHub is the canonical progress repository.** This repository is the single source of truth for project state.
- **Every accepted implementation increment must be pushed immediately.** Work is not considered complete until it is committed and synchronized with the remote.
- **Secrets must never be committed.** See `.gitignore` and `.env.example`.
- **Synthetic evidence only.** No real investigative, personal, financial, or classified data may enter this repository at any point.
- **AI inferences must not be represented as established facts.** Any AI-generated conclusion must be clearly distinguishable from verified evidence, with provenance preserved.
- **Evidence provenance must be retained.** Every piece of evidence must be traceable to its origin.
- **Major features require visual evidence.** See `docs/progress/` for the visual-progress convention.

## Technology Stack

A single-runtime, local-first TypeScript application. Full rationale in [ADR-001](./docs/architecture/technology-stack.md); the definitive implementation baseline is the [stack contract](./docs/architecture/stack-contract.md).

| Layer | Selection |
| --- | --- |
| Application | Next.js (App Router) + React + TypeScript, Tailwind CSS + shadcn/ui |
| Backend | Next.js route handlers + typed pipeline modules (no agent framework) |
| Data | SQLite (`node:sqlite` + Drizzle); FTS5 for retrieval; local file, no server |
| Graph | `graphology` in-memory + `sigma.js` for visualization |
| AI | Claude API (remote, primary inference path); responses cached to disk, keyed on model + prompt version + schema version + input, for deterministic offline replay once populated |
| Spatial / temporal | Leaflet + OpenStreetMap; `vis-timeline` |
| Testing | Vitest + Playwright (Playwright also captures visual evidence) |
| Local execution | `npm run dev` — Docker is not required for development or runtime |

Deliberately **not** used: Neo4j, PostgreSQL, vector databases, Docker for application services, and LLM agent frameworks — see [ADR-001 §10](./docs/architecture/technology-stack.md#technologiespatterns-we-are-not-using). Local model inference (Ollama) is available only as an emergency offline fallback, never the default path.

## Getting Started

**Status**: the full pipeline is implemented — see
[`docs/progress/README.md`](./docs/progress/README.md) for what is built, closed,
in progress and blocked. You can load the Operation DarkNet Delhi synthetic corpus
through a real ingestion pipeline, extract every explicitly-stated fact from it
into provenance-tracked Observed-Fact records, resolve those facts into canonical
entities and aliases, synthesize a browsable investigative graph, compute
deterministic structural analytics over it, corroborate spatially and temporally,
ask the grounded Investigation Copilot a natural-language question, and generate
the twelve-section dossier — every claim classified, every claim traceable back to
the evidence item behind it, and nothing promoted up the evidence ladder along the
way.

Requirements: Node.js 26.8.1+ (provides the built-in `node:sqlite` module). No Docker required.

```bash
npm install
cp .env.example .env   # optional — the app runs with no AI_PROVIDER_API_KEY set
npm run dev            # http://localhost:3000
```

### Demo workflow

The counts below are what the pipeline produces on the committed corpus. If any of
them ever disagrees with the stage document under [`docs/data/`](./docs/data/),
**the stage document is canonical** — it is regenerated from a measured run, this
is a runbook.

```text
start the app  →  open http://localhost:3000
→  "Start ingestion"  (loads the Operation DarkNet Delhi synthetic corpus)
→  watch the 8 real ingestion stages
→  investigation loaded: 6 sources · 1,820 evidence items · 1,150 communications ·
   560 financial transactions · 14 locations
→  reload / "Re-run ingestion"  →  state persists, re-ingestion is idempotent
→  "Extract Evidence"  →  watch the 7 real extraction stages
→  evidence extracted: 1,996 records (99 entity mentions · 60 attribute mentions ·
   123 relationship mentions · 1,714 event mentions), each Observed Fact
→  reload / "Re-run extraction"  →  state persists, re-extraction is idempotent
→  "Resolve Entities"  →  watch the 8 real resolution stages
→  entities resolved: 61 canonical entities (17 people · 14 phones · 14 IMEIs ·
   4 vehicles · 12 bank accounts) + 25 aliases from 133 decisions, each AI Inference
→  reload / "Re-run resolution"  →  state persists, re-resolution is idempotent
→  "Synthesize Graph"  →  watch the 10 real graph-synthesis stages
→  graph synthesized: 75 nodes (61 entities + 14 locations) · 191 edges
   (37 ownership · 65 communication · 63 co-location · 26 financial)
→  sidebar "Graph" enables live  →  select an entity  →  inspect its
   neighborhood and connected entities  →  select a relationship  →
   trace it to its source evidence
→  reload / "Re-run graph synthesis"  →  state persists, idempotent
→  "Run Analytics"  →  watch the 10 real analytics stages
→  analytics synthesized: 75 ranked entities · 19 bridge entities · 19
   communities · 263 total algorithmic signals
→  sidebar "Analytics" enables live  →  inspect ranked/bridge/community
   views  →  select an entity  →  inspect its degree, centrality, and
   signals  →  run a shortest-path query  →  "View in graph" to inspect
   the underlying edges
→  reload / "Re-run analytics"  →  state persists, idempotent
→  "Run Corroboration"  →  watch the 10 real corroboration stages
→  corroboration synthesized: 456 findings — 438 corroborated facts ·
   18 algorithmic signals (3 proximity · 3 single-occasion temporal ·
   12 travel-speed contradictions)
→  sidebar "Corroboration" enables live  →  inspect the entity-pair
   overlap roll-up  →  open the spatial / temporal / repeated-overlap /
   contradiction tabs  →  filter to corroborated facts or algorithmic
   signals  →  select a finding  →  inspect its classification, the
   metric that produced it, the full provenance chain, and the cited
   evidence ids  →  "View in graph" to inspect the underlying edges
→  reload / "Re-run corroboration"  →  state persists, idempotent
→  sidebar "Dossier" enables live  →  "Generate dossier"  →  watch
   the 11 real dossier stages
→  dossier generated: 12 sections · 104 findings — 12 observed facts ·
   33 corroborated facts · 34 algorithmic signals · 13 AI inferences ·
   12 investigative leads, over 1,311 resolved references
→  read the report  →  expand any finding  →  inspect its explanation,
   the persisted ids it rests on, and its full provenance chain back to
   the source evidence item  →  "Graph" / "Analytics" / "Corroboration"
   / "Evidence" to open the screen that owns those ids
→  reload / "Regenerate dossier"  →  same report version, same finding
   count, same generation time — deterministic and idempotent
```

Ingestion, extraction, resolution, graph synthesis, topology analytics,
spatial/temporal corroboration, and dossier generation are fully local and
deterministic (one SQLite file, one JSON corpus, no Anthropic call, no Docker).
Details: `docs/data/ingestion.md`, `docs/data/extraction.md`,
`docs/data/resolution.md`, `docs/data/graph.md`, `docs/data/analytics.md`,
`docs/data/corroboration.md`, `docs/data/dossier.md`.
Extraction performs no entity resolution, relationship inference, or investigative
conclusions — every extracted record states only what a single source explicitly
says. Resolution merges mentions only on explicit shared-identifier or
unambiguous exact-name evidence — a name matching more than one identifier-anchored
entity is left deliberately unmerged, never force-resolved. Graph synthesis never
recreates identity resolution and never asserts a relationship the evidence does
not directly support — the deliberately hidden connection between two principal
suspects stays structurally indirect, recoverable only by traversing the real
graph, never shortcut into a single edge. Analytics never treats raw
degree/centrality/bridge status as suspicious, never labels a detected
community a criminal organization, and never calls its structural-prominence
ranking a "criminality score" — every signal is an Algorithmic Signal
describing network structure, not a claim about the world. Corroboration
never claims two entities were together from a shared cell tower or
geographic proximity, never claims contact or causation from timing, and
never silently resolves a contradiction in favour of one source — a
finding is a Corroborated Fact only when two or more independent evidence
items agree, and is otherwise an Algorithmic Signal. The dossier re-derives
nothing and re-labels nothing: it carries each source row's own classification
and confidence forward unchanged, refuses to store a classification a section
does not permit, and withholds the entire report rather than publish one in
which any claim cannot be classified or traced back to a persisted record.

Other scripts:

```bash
npm run build         # production build
npm run typecheck     # tsc --noEmit
npm run lint          # eslint .
npm test              # vitest run (unit tests)
npm run test:e2e      # playwright test (end-to-end; needs `npx playwright install chromium`)
npm run db:generate   # regenerate Drizzle migrations after a schema change
npm run evaluate      # deterministic evaluation harness -> reports/evaluation/
```

The SQLite database is a local file at `DATABASE_URL` (default `./data/cipher.db`), created and migrated automatically on first use — nothing to provision manually.

## Development Environment

Verified baseline:

- macOS (Apple Silicon, arm64), 18 GB RAM
- Homebrew, Xcode Command Line Tools
- Git and GitHub CLI, with active GitHub authentication
- Node.js 26.8.1 (provides the built-in `node:sqlite` module used by the stack) and Python toolchains available
- Docker Desktop installed and operational — available for optional infrastructure/testing use, but not required by the selected stack's default development/runtime path

## License

This project is licensed under the [MIT License](./LICENSE).

## Documentation Map

`CLAUDE.md` carries the durable operating rules and the full canonical-document
table. The short version:

| Question | Document |
|---|---|
| What is built, closed, in progress, blocked, next | [`docs/progress/README.md`](./docs/progress/README.md) |
| Did task X complete, at which commit | [`docs/progress/implementation-ledger.md`](./docs/progress/implementation-ledger.md) |
| What must the system do | [`docs/requirements.md`](./docs/requirements.md) |
| What may I build with | [`docs/architecture/stack-contract.md`](./docs/architecture/stack-contract.md) · [ADR-001](./docs/architecture/technology-stack.md) |
| How does pipeline stage X behave | [`docs/data/`](./docs/data/) |
| How good is the model, on what | [`docs/evaluation/README.md`](./docs/evaluation/README.md) |
| Where did the data come from | [`docs/data-research/source-registry.md`](./docs/data-research/source-registry.md) |
| Git, branch and secret protocol | [`docs/repository-governance.md`](./docs/repository-governance.md) |

Historical material — point-in-time captures under `docs/progress/evidence/`, the
Phase-1 research in `docs/data-research/`, and superseded assessments — is labelled
as such in each file and is never retouched when later counts change.
