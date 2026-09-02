# NetIntel AI

*A synthetic-data investigative intelligence platform for demonstrating evidence ingestion, entity resolution, relationship analysis, spatial/temporal corroboration, grounded investigation assistance, and report generation.*

> This project is not production software and makes no claim of production readiness. It exists to demonstrate an investigative-intelligence workflow end-to-end using synthetic data.

## Project Status

```text
Status: Early Implementation
```

The repository foundation, governance, requirements/data/agent/demo/evaluation contracts, and the technology stack (ADR-001) are complete. The application bootstrap (P4.1) and the domain/data foundation (P4.2) — typed domain models, deterministic IDs, executable provenance, a migrated SQLite schema, and a validated fixture-loading boundary — are in place. The full synthetic investigation corpus (P5.1) — Operation DarkNet Delhi, generated deterministically from a fixed version/seed: 5 FIRs, 8 suspects, 1,150 CDRs, 560 transactions and supporting records, with a held-out ground-truth answer key kept isolated from the evidence path (`docs/data/corpus.md`) — exists under `evidence/`. The **evidence ingestion workflow** (P5.2) is implemented: a real, streamed, 8-stage pipeline (validate → normalize → assign deterministic IDs → attach provenance → persist) that loads the corpus into the application and shows the investigation loaded with its evidence summary; deterministic and idempotent (`docs/data/ingestion.md`). The **evidence extraction workflow** (P5.3) is implemented: a real, streamed, 7-stage pipeline (select evidence → parse content → extract explicit facts → validate → attach provenance → persist) that structures every explicitly-stated fact across the 12 evidence types into 1,996 extracted records, each classified Observed Fact with full provenance; deterministic and idempotent, with no entity resolution or investigative inference performed (`docs/data/extraction.md`). The **entity resolution workflow** (P5.4) is implemented: a real, streamed, 8-stage pipeline (select records → canonicalize identifiers → cluster identities → resolve mentions → validate → attach provenance → persist) that resolves 1,996 extracted facts into 54 canonical entities (10 people, 44 phone/IMEI/vehicle/bank-account identifiers) and 25 aliases via 85 resolution decisions, each classified AI Inference with full provenance back to the extracted record it came from; deterministic and idempotent, with every merge justified by a shared identifier or an unambiguous exact-name match — ambiguous name matches are left deliberately unmerged, never force-resolved (`docs/data/resolution.md`). The **graph synthesis workflow** (P5.5) is implemented: a real, streamed, 10-stage pipeline (load resolved entities → load extracted records → map evidence to canonical entities → construct candidates → validate endpoints → construct edges → attach provenance → persist → build in-memory graph → result) that assembles 54 canonical entities and 14 real locations into 68 graph nodes and 196 relationship edges (ownership, communication, financial, co-location), each with full provenance and an evidence-classification label; deterministic and idempotent, with the deliberately hidden S1↔S4 connection staying structurally indirect and the money-mule chain represented only through real account entities (`docs/data/graph.md`). The sidebar's Graph screen is live: node/edge selection, filtering, and full evidence traceability from any relationship back to its source. Analytics, corroboration, the Copilot, and report generation are not implemented yet; see `docs/progress/implementation-ledger.md` for current status.

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

All evidence, entities, cases, and datasets used in this project are entirely fictional and generated for demonstration purposes only. Any resemblance to real individuals, organizations, or investigations is coincidental and unintended.

## Intended Demonstration Flow

The following describes the **intended** end-to-end workflow this project aims to demonstrate. It reflects project direction, not current implementation status.

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
├── docs/                  # Project documentation
│   ├── architecture/        # ADR-001 technology stack + stack contract
│   ├── contracts/            # Interface / data contracts between components
│   ├── data/                  # Synthetic data specification and generation notes
│   ├── demo/                   # Demo runbook and walkthrough materials
│   ├── evaluation/               # Evaluation methodology and criteria
│   └── progress/                  # Implementation ledger and visual-progress evidence
├── evidence/               # Synthetic evidence artifacts used by the demo
│   ├── ground-truth/         # Known-correct answers for synthetic scenarios
│   │   └── fixtures/           # Small ground-truth fixtures for testing (not the full dataset)
│   └── synthetic/              # Generated synthetic evidence (documents, records, etc.)
│       └── fixtures/             # Small synthetic fixtures for testing (not Operation DarkNet Delhi)
├── evaluation/             # Evaluation scripts and results
├── scripts/                # Utility and automation scripts
├── src/                    # Application source (Next.js App Router)
│   ├── app/                  # Routes, layout, global styles
│   ├── components/            # UI — components/ui (shadcn primitives), components/shell (app shell)
│   └── lib/                     # ai/, corpus/ (deterministic corpus generator/loader), db/ (schema +
│                                   validated repository), domain/ (typed domain models), env,
│                                   extraction/ (P5.3 extraction pipeline), fixtures/ (synthetic +
│                                   ground-truth loaders), graph/ (P5.5 graph synthesis pipeline),
│                                   ingestion/ (P5.2 ingestion pipeline), pipeline/, resolution/
│                                   (P5.4 entity resolution pipeline), utils
├── tests/                  # tests/unit (Vitest), tests/e2e (Playwright)
├── drizzle/                # Generated SQL migrations
├── data/                   # Local SQLite database (git-ignored, created on first run)
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

**Status**: the application foundation (P4.1), domain/data foundation (P4.2), the synthetic corpus (P5.1), the **evidence ingestion workflow** (P5.2), the **evidence extraction workflow** (P5.3), the **entity resolution workflow** (P5.4), and the **graph synthesis workflow** (P5.5) are in place. You can load the Operation DarkNet Delhi synthetic corpus through a real ingestion pipeline, extract every explicitly-stated fact from it into provenance-tracked, Observed-Fact-classified records, resolve those facts into canonical entities and aliases, then synthesize a browsable investigative graph — every relationship traceable back to the resolved entities and extracted evidence that justify it, never a fabricated or shortcut connection. Analytics, corroboration, the Copilot, and reporting are later milestones.

Requirements: Node.js 26.8.1+ (provides the built-in `node:sqlite` module). No Docker required.

```bash
npm install
cp .env.example .env   # optional — the app runs with no AI_PROVIDER_API_KEY set
npm run dev            # http://localhost:3000
```

### Demo workflow

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
→  entities resolved: 54 canonical entities (10 people · 14 phones · 14 IMEIs ·
   4 vehicles · 12 bank accounts) + 25 aliases from 85 decisions, each AI Inference
→  reload / "Re-run resolution"  →  state persists, re-resolution is idempotent
→  "Synthesize Graph"  →  watch the 10 real graph-synthesis stages
→  graph synthesized: 68 nodes (54 entities + 14 locations) · 196 edges
   (38 ownership · 69 communication · 63 co-location · 26 financial)
→  sidebar "Graph" enables live  →  select an entity  →  inspect its
   neighborhood and connected entities  →  select a relationship  →
   trace it to its source evidence
→  reload / "Re-run graph synthesis"  →  state persists, idempotent
```

Ingestion, extraction, resolution, and graph synthesis are fully local and
deterministic (one SQLite file, one JSON corpus, no Anthropic call, no
Docker). Details: `docs/data/ingestion.md`, `docs/data/extraction.md`,
`docs/data/resolution.md`, `docs/data/graph.md`.
Extraction performs no entity resolution, relationship inference, or investigative
conclusions — every extracted record states only what a single source explicitly
says. Resolution merges mentions only on explicit shared-identifier or
unambiguous exact-name evidence — a name matching more than one identifier-anchored
entity is left deliberately unmerged, never force-resolved. Graph synthesis never
recreates identity resolution and never asserts a relationship the evidence does
not directly support — the deliberately hidden connection between two principal
suspects stays structurally indirect, recoverable only by traversing the real
graph, never shortcut into a single edge.

Other scripts:

```bash
npm run build       # production build
npm run typecheck   # tsc --noEmit
npm run lint         # eslint .
npm test              # vitest run (unit tests)
npm run test:e2e      # playwright test (end-to-end)
npm run db:generate   # regenerate Drizzle migrations after a schema change
```

The SQLite database is a local file at `DATABASE_URL` (default `./data/netintel.db`), created and migrated automatically on first use — nothing to provision manually.

## Development Environment

Verified baseline:

- macOS (Apple Silicon, arm64), 18 GB RAM
- Homebrew, Xcode Command Line Tools
- Git and GitHub CLI, with active GitHub authentication
- Node.js 26.8.1 (provides the built-in `node:sqlite` module used by the stack) and Python toolchains available
- Docker Desktop installed and operational — available for optional infrastructure/testing use, but not required by the selected stack's default development/runtime path

## License

This project is licensed under the [MIT License](./LICENSE).

## Future Documentation

The following areas will be developed as the project progresses:

- **Architecture** — `docs/architecture/` — [ADR-001 technology stack](./docs/architecture/technology-stack.md) and [stack contract](./docs/architecture/stack-contract.md) are complete; component-level system design follows
- **Contracts** — `docs/contracts/` — interface and data contracts between components
- **Data Specification** — `docs/data/` — synthetic dataset design and generation methodology
- **Evaluation Methodology** — `docs/evaluation/` — how correctness and quality will be measured
- **Demo Runbook** — `docs/demo/` — how to run and present the demonstration
- **Visual Progress** — `docs/progress/` — the implementation ledger and visual-evidence convention
- **Implementation Ledger** — `docs/progress/implementation-ledger.md` — feature-by-feature status tracking

No details beyond what is documented in this repository have been established.
