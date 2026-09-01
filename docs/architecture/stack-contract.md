# Stack Contract

**This is the implementation baseline.** Every implementation agent builds against these choices. Rationale, alternatives, and tradeoffs are in [ADR-001](./technology-stack.md); this document is the short, definitive answer to "what do I use for X?"

`Status` values: `Baseline` — use this. `Optional` — add only if the stated trigger occurs. `Fallback` — use only if the baseline fails.

## Selected Stack

| Layer | Selected Technology | Role | Status |
| --- | --- | --- | --- |
| Language | TypeScript | Single language across UI, backend, scripts, and tests | Baseline |
| Application framework | Next.js (App Router) | UI and server-side route handlers in one process | Baseline |
| UI library | React | Component model | Baseline |
| Styling / components | Tailwind CSS + shadcn/ui | Dashboard, panels, forms | Baseline |
| Backend | Next.js route handlers + typed pipeline modules | Pipeline execution; same process, no separate service | Baseline |
| Orchestration | Sequential runner over six typed modules | Agent 1–6 execution; **no agent framework** | Baseline |
| Contract enforcement | Zod | Schema validation at every stage boundary; the executable form of the agent contracts | Baseline |
| Structured data | SQLite via `better-sqlite3` | Single store of record | Baseline |
| Schema / queries | Drizzle ORM | Typed schema and queries (FTS5 via raw `sql` template) | Baseline |
| Graph representation | `graphology` (in-memory, rebuilt from SQLite) | Nodes, edges, provenance-carrying graph model | Baseline |
| Graph analytics | `graphology-metrics`, `graphology-communities-louvain`, `graphology-shortest-path` | Centrality, community detection, path analysis, intermediary identification | Baseline |
| Search / retrieval | SQLite FTS5 + structured SQL + graph traversal | Copilot grounding; every hit is a row with provenance | Baseline |
| Semantic retrieval | `sqlite-vec` + embeddings | Add **only if** M8 shows paraphrase recall is insufficient | Optional |
| Evidence storage | Local filesystem (`evidence/synthetic/`) + SQLite metadata | Evidence files and normalized content | Baseline |
| AI inference | Claude API via `@anthropic-ai/sdk` (remote) | Extraction, merge adjudication, Copilot | Baseline |
| Model | `claude-opus-5` | Copilot and ambiguous-merge adjudication | Baseline |
| Model (cost step-down) | `claude-sonnet-5` / `claude-haiku-4-5` | Bulk extraction **only** after prompt caching and the Batch API; an explicit owner decision, not a default | Optional |
| Inference determinism | Disk cache keyed by hash of (model, prompt, schema) | Reproducibility + offline demo replay. **Not** `temperature: 0` — sampling params return 400 on Opus 5 / Sonnet 5 | Baseline |
| Structured extraction | Claude structured outputs (`output_config.format`) + `strict: true` tools | Schema-valid extraction, then Zod-validated | Baseline |
| Local inference | Ollama (7–8B) | Offline emergency only; degraded quality, must be disclosed | Fallback |
| Entity resolution | Deterministic blocking/scoring + LLM adjudication for the ambiguous band only | Isolates nondeterminism to one labeled, cached step | Baseline |
| Spatial analysis | Haversine distance + time-window queries in TypeScript | Co-location, proximity, movement | Baseline |
| Temporal analysis | ISO-8601 timestamps in SQLite + interval queries in TypeScript | Timelines, overlaps, correlations | Baseline |
| Graph visualization | `sigma.js` | Graph view; consumes the `graphology` instance directly | Baseline |
| Graph visualization | Cytoscape.js | If `sigma.js` blocks progress (requires a graph→JSON adapter) | Fallback |
| Map | Leaflet + OpenStreetMap raster tiles | Spatial view; **no API key** (OSM/ODbL attribution required in the UI) | Baseline |
| Map | MapLibre GL JS + free vector tiles | If raster rendering proves inadequate | Fallback |
| Timeline | `vis-timeline` | Timeline view | Baseline |
| Charts | Recharts | Analytics panel | Baseline |
| Synthetic data generation | TypeScript script in `scripts/`, seeded PRNG; LLM for narrative prose only | Operation DarkNet Delhi dataset (Workstream A) | Baseline |
| Unit / integration testing | Vitest | Stage logic and contract-conformance tests | Baseline |
| E2E testing | Playwright | Golden-path E2E | Baseline |
| Visual evidence capture | Playwright screenshots + video | Task I4; evidence produced by the run that verifies the feature | Baseline |
| Evaluation harness | Vitest + TypeScript over `evidence/ground-truth/` | Workstream K; reads ground truth only after pipeline output is final | Baseline |
| Local execution | `npm run dev` | Development; **Docker is not used** | Baseline |
| Demo delivery | Local production build on the M3 Pro | Primary demo path | Baseline |
| Demo delivery | Vercel deployment, read-only prebuilt DB | Backup if the local environment fails | Fallback |

## Hard Constraints

1. **One secret only** — `AI_PROVIDER_API_KEY`. No database, map, storage, or vector credential exists. Never commit it; `.env` is git-ignored.
2. **No Docker for application services.** Freeing the ~7.75 GB Docker allocation is a deliberate part of the resource budget.
3. **Provenance is a column, not a convention** — source, location/reference, method, confidence, processing history, timestamp on every derived row. A stage that cannot populate them must fail validation rather than write a partial row.
4. **The model never mints an identifier.** It selects from row IDs given to it; any citation that does not resolve to a real row is rejected before it reaches a user.
5. **Cache every LLM response from the first call.** Determinism, cost, and the offline demo all depend on a warm cache; it cannot be retrofitted late.
6. **Nothing on the rejected list in [ADR-001 §10](./technology-stack.md#technologiespatterns-we-are-not-using) may be reintroduced** without a new ADR.

## Build Order (M1 gate)

These four must exist before any workstream begins, because they are the shared contract surface:

1. Next.js project skeleton
2. Drizzle schema (including provenance columns and FTS5 tables)
3. Zod contract schemas for all six agent boundaries
4. Claude API client with the disk response cache
