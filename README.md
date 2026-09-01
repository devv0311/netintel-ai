# NetIntel AI

*A synthetic-data investigative intelligence platform for demonstrating evidence ingestion, entity resolution, relationship analysis, spatial/temporal corroboration, grounded investigation assistance, and report generation.*

> This project is not production software and makes no claim of production readiness. It exists to demonstrate an investigative-intelligence workflow end-to-end using synthetic data.

## Project Status

```text
Status: Pre-setup / Foundation
```

The repository currently contains its foundational structure, governance documentation, and development conventions. Application architecture, technology stack, and implementation have not yet begun.

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
├── docs/            # Project documentation
│   ├── architecture/  # System architecture (not yet decided)
│   ├── contracts/     # Interface / data contracts between components
│   ├── data/          # Synthetic data specification and generation notes
│   ├── demo/          # Demo runbook and walkthrough materials
│   ├── evaluation/     # Evaluation methodology and criteria
│   └── progress/      # Implementation ledger and visual-progress evidence
├── evidence/        # Synthetic evidence artifacts used by the demo
│   ├── ground-truth/  # Known-correct answers for synthetic scenarios
│   └── synthetic/     # Generated synthetic evidence (documents, records, etc.)
├── evaluation/      # Evaluation scripts and results
├── scripts/         # Utility and automation scripts
├── src/             # Application source code (not yet started)
├── .env.example     # Environment variable template (no real secrets)
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
