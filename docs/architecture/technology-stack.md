# ADR-001 — CIPHER Technology Stack

**Status**: Accepted — this is the definitive implementation baseline.
**Date**: 2026-09-02
**Supersedes**: the technology-neutral placeholder in `docs/architecture/README.md`.
**Scope**: selection and rationale only. No application code, dependency, or service is created by this decision.

---

## 1. Executive Decision

**CIPHER is built as a single-runtime, local-first TypeScript application: Next.js (App Router) + React + Tailwind/shadcn on the front, Next.js server-side route handlers and typed pipeline modules on the back, SQLite (`node:sqlite` + Drizzle) as the single store of record, an in-memory `graphology` graph rebuilt from SQLite for graph synthesis and analytics, `sigma.js` for graph rendering, Leaflet + OpenStreetMap for the map, and remote Claude API inference for extraction and the Copilot — with every LLM response cached to disk, keyed on model/prompt/schema version as well as input, so the demo is deterministic and survives a network failure.**

Four decisions carry most of the weight, and each is a deliberate reduction in moving parts:

1. **One language, one process, one runtime.** TypeScript end to end. Nine specialized AI agents working in parallel across twelve workstreams is a coordination problem before it is a coding problem; a second language doubles the contract surface and the ways agents can disagree.
2. **No database server, no graph database, no vector database.** The complete dataset is roughly 1,500 records and a few hundred entities. A file-backed SQLite database plus an in-memory graph fits in tens of megabytes. Neo4j, Postgres, and Qdrant would each add a service, a schema dialect, a client, RAM, and setup hours to buy capability this dataset never needs.
3. **No agent framework.** The six agent contracts in `docs/contracts/agent-contracts.md` describe six *stages with typed inputs and outputs* — they do not describe autonomous, open-ended exploration. They are implemented as six plain typed modules behind a sequential runner. Frameworks (LangChain, LangGraph, CrewAI, AutoGen) would insert abstraction exactly where this project's hardest requirement — provenance you can trace and explain — needs transparency.
4. **Remote inference, cached to disk.** 18 GB of RAM cannot host a capable local model alongside a dev server, a browser, an editor, and multiple AI coding agents. Inference goes to the Claude API; every response is cached by a composite key covering model, prompt version, schema version, and normalized input (not input alone — see the LLM Response Cache subsection in §3), which buys back determinism (a requirement) and removes the network from the demo-day critical path (a risk).

---

## 2. Selected Stack

| Layer | Selection |
| --- | --- |
| Application / UI | Next.js (App Router) + React + TypeScript |
| Styling / components | Tailwind CSS + shadcn/ui |
| Backend | Next.js server-side route handlers + typed pipeline modules (same process) |
| Structured data | SQLite via `node:sqlite` (Node's native module), schema/queries via Drizzle ORM |
| Graph representation | `graphology` in-memory, materialized from SQLite `nodes`/`edges` tables |
| Graph analytics | `graphology-metrics` (centrality), `graphology-communities-louvain`, `graphology-shortest-path` |
| Search / retrieval | SQLite FTS5 full-text + structured SQL + graph traversal (no vector DB) |
| Evidence storage | Filesystem under `evidence/synthetic/`, metadata + normalized content in SQLite |
| AI inference | Claude API (remote) via `@anthropic-ai/sdk`; disk cache keyed by (model, prompt version, schema version, normalized input hash) |
| Model baseline | `claude-opus-5` for Copilot and merge adjudication; per-stage step-down is an explicit, documented cost decision (see §6) |
| Structured extraction | Claude structured outputs (`output_config.format`) + `strict: true` tools, validated by Zod |
| Contract enforcement | Zod schemas at every stage boundary |
| Entity resolution | Deterministic-first (normalization, blocking, similarity) + LLM adjudication only for ambiguous candidates |
| Graph visualization | `sigma.js` (shares the `graphology` model — no data conversion) |
| Map | Leaflet + OpenStreetMap raster tiles (no API key, no account) |
| Timeline | `vis-timeline` |
| Charts / analytics panel | Recharts |
| Synthetic data generation | TypeScript script in `scripts/`, seeded PRNG for determinism, LLM only for narrative prose |
| Testing | Vitest (unit + integration), Playwright (E2E) |
| Visual evidence capture | Playwright screenshots + video — the same run that tests a feature captures its evidence |
| Local execution | `npm run dev`; **no Docker required** |
| Demo delivery | Local production build on the M3 Pro; optional read-only Vercel deployment as backup |

---

## 3. Component-by-Component Rationale

Each entry gives the reason, the major tradeoff accepted, integration notes, resource implications, and the fallback if it fails.

### Next.js (App Router) + React + TypeScript — application and backend

- **Reason**: one project, one dev server, one language for UI and API. It is the single most heavily represented full-stack shape in AI coding-agent training data, which directly serves priority #12 (easy delegation) and #2 (fast implementation). Server-side route handlers give the pipeline a natural home without a second service.
- **Tradeoff**: TypeScript's data-science ecosystem is thinner than Python's. Accepted because the two places that would hurt — heavy document parsing and graph algorithms — are neutralized: our evidence is synthetic (we choose its formats) and `graphology` covers every analytic the requirements name.
- **Integration**: pipeline modules live as plain functions callable from both route handlers and CLI scripts, so the same code path serves the UI, the tests, and the evaluation harness.
- **Resources**: ~400–700 MB for the dev server.
- **Fallback**: if App Router server behavior causes trouble, the pipeline modules are framework-independent and can be driven by a thin Express/Fastify server or CLI without rewriting stage logic.

### SQLite (`node:sqlite`) + Drizzle ORM — store of record

- **Reason**: zero operational surface. No server, no credentials, no container, no port. The development environment runs Node.js 26.8.1, where `node:sqlite` is Node's built-in, synchronous SQLite module — selected over `better-sqlite3` specifically because it removes a native-addon dependency (a compiled binding that must match Node's ABI and the local toolchain) that the runtime already makes unnecessary. Drizzle gives one typed schema definition that all nine agents share, without a codegen daemon or engine binary. A public repo with no database credential is a security win (§8).
- **Tradeoff**: `node:sqlite` is newer than `better-sqlite3` and has a smaller track record; its API surface is close enough to `better-sqlite3`'s that Drizzle's SQLite dialect works against it with the same query patterns. Accepted — the reduced dependency footprint is worth more here than the marginal maturity difference, and `better-sqlite3` remains the documented fallback (below) if a gap in `node:sqlite`'s support surfaces during implementation.
- **Integration**: FTS5 virtual tables are created via raw SQL migration and queried through Drizzle's `sql` template — Drizzle does not model FTS5 natively, and implementers should expect to hand-write those queries. This is unaffected by the driver choice.
- **Resources**: file on disk plus page cache; tens of MB.
- **Fallback**: if `node:sqlite` has a gap (e.g. a missing extension-loading hook FTS5 setup needs), swap to `better-sqlite3` — same SQL, same Drizzle schema, a driver-adapter change only, not a redesign. Moving to Postgres later remains a separate, larger fallback: a connection-string and dialect change.

### `graphology` (in-memory) — graph representation and analytics

- **Reason**: the graph is the analytical core, and at ~1,500 records it is small. An in-memory graph rebuilt from SQLite on demand gives full algorithmic power with no service, no query language, and no persistence layer to keep in sync. `graphology-metrics`, `graphology-communities-louvain`, and `graphology-shortest-path` cover every capability named in Workstream E: centrality, community detection, path analysis, and intermediary identification (betweenness).
- **Tradeoff**: `networkx` (Python) is more mature and has a wider algorithm catalogue. Accepted — we need six algorithms, all of which `graphology` has, and keeping one language is worth more than algorithm breadth we will not use.
- **Integration**: SQLite is the source of truth; the graph is a derived, rebuildable projection. Every node and edge carries the provenance/classification fields from its SQLite row, so analytics never operate on data stripped of its lineage.
- **Resources**: well under 100 MB at this scale.
- **Fallback**: Cytoscape.js has overlapping analytics if a specific algorithm disappoints; a Neo4j migration remains possible but is explicitly rejected for this project (§10).

### SQLite FTS5 + structured SQL + graph traversal — retrieval

- **Reason**: this is the most consequential AI-architecture decision after model choice. The corpus is five FIRs, a few dozen statements, and ~1,500 structured records — small enough that **retrieval should be structured, not fuzzy**. Every retrieved item is a row with a stable ID and a provenance chain, which is precisely what `docs/requirements.md` §8 demands. A vector store would return chunks whose lineage must then be reconstructed, and would introduce embeddings, a service, and a similarity threshold to tune, all for recall we can get from exact identifier matching and full-text search.
- **Tradeoff**: no semantic matching on paraphrase ("the guy with the silver car" will not match "grey vehicle") out of the box. Accepted for the must-have path; semantic recall is a should-have (below).
- **Integration**: the Copilot's retrieval layer (Task G1) composes three sources — FTS5 over evidence text, SQL over structured records, graph traversal over relationships — and returns rows with provenance attached.
- **Resources**: negligible; FTS5 is built into SQLite.
- **Fallback (should-have, not must-have)**: if paraphrase recall proves insufficient during M8, add embeddings stored in SQLite (`sqlite-vec`) using either a hosted embeddings call or a small local model via `transformers.js` (~100 MB, well within budget). This is an additive change to one module, not a re-architecture.

### Claude API (remote) via `@anthropic-ai/sdk` — inference

- **Reason**: see §6 for the full local/remote/hybrid analysis. In short: the hardware cannot host a capable local model alongside the development environment, and extraction quality directly determines whether the entire downstream pipeline has anything correct to work with.
- **Model baseline**: `claude-opus-5` (1M context, $5/$25 per MTok) for the Copilot and for ambiguous-merge adjudication — the two surfaces where reasoning quality is the product. Bulk structured extraction across 1,500 records is the one place where cost tuning is worthwhile; the order of levers there is **prompt caching first, then the Batch API at 50%, and only then a model step-down** (`claude-sonnet-5` at $2/$10, or `claude-haiku-4-5` at $1/$5 for mechanical passes). A step-down is a deliberate, recorded decision for the project owner to make — not a default this ADR imposes.
- **Tradeoff**: a network dependency and a per-token cost. Both are mitigated below.
- **Integration**: extraction uses **structured outputs** (`output_config: {format: {...}}`) and `strict: true` tool definitions so the model returns schema-valid JSON that Zod then validates at the stage boundary — the same Zod schema that enforces the agent contract. Note two API facts implementers must not get wrong: sampling parameters (`temperature`, `top_p`) are **removed on Claude Opus 5 and Sonnet 5 and return a 400** — determinism does not come from `temperature: 0`; and document `citations` are **incompatible with `output_config.format`**, so extraction uses structured outputs while citation-style grounding, if used at all, belongs only to the Copilot surface.
- **Resources**: zero local RAM.
- **Fallback**: the response cache described below. Once the demo dataset has been processed, the pipeline replays from cache with no network at all. This single mechanism answers three separate requirements at once — reproducibility (`docs/requirements.md` §6), demo-day network failure (risk register), and cost. A secondary fallback is a local Ollama model for offline extraction only, accepted as degraded quality (see §6).

### LLM Response Cache — determinism and offline replay

The cache key is **not** a hash of the input alone — an input-only key would happily serve a response generated under a prompt, schema, or model that has since changed, which defeats the reproducibility requirement it exists to satisfy rather than meeting it. The key is a composite hash over every input that can change what the model returns:

- **Model ID/version** — e.g. `claude-opus-5`. A model swap must miss the cache, not silently serve a prior model's answer.
- **System/prompt version** — an explicit version identifier on every prompt template used in the pipeline (extraction, entity-resolution adjudication, Copilot). Editing a prompt bumps its version, which invalidates only the entries generated under the old wording.
- **Tool/schema version** — an explicit version identifier on every Zod/tool-input schema. A schema change (a field added, a type tightened) bumps its version for the same reason.
- **Normalized input** — the actual evidence/question content, normalized (whitespace/ordering-stable) before hashing so semantically identical input hits the same entry.
- **Relevant generation configuration** — `output_config.effort`, `max_tokens`, and any other parameter that affects output, so a configuration change is not silently masked by a stale hit.

**Cached entry metadata** (minimum fields every cache record must store, in addition to the response itself):

| Field | Purpose |
| --- | --- |
| `model` | Which model produced this response |
| `modelVersion` | The exact model ID string sent to the API (redundant with `model` today, but keeps the record self-describing if model naming changes) |
| `promptVersion` | Which version of the prompt template produced this response |
| `schemaVersion` | Which version of the tool/output schema constrained this response |
| `inputHash` | Hash of the normalized input, for lookup and for detecting an input change independent of the other fields |
| `response` | The full response payload, in the shape the calling stage expects |
| `createdAt` | Creation timestamp, for audit and for manual cache-invalidation sweeps |

A lookup is a hit only when model, prompt version, schema version, and input hash all match the current call. This is what makes the design an actual reproducibility mechanism rather than a raw speed optimization that happens to also serve stale answers: a prompt or schema edit during development correctly produces fresh entries instead of silently replaying pre-edit behavior, while the *unmodified* majority of prior calls still replay instantly and offline.

### No agent framework — orchestration

- **Reason**: applying the standard four-part test for whether to build an agent — complexity, value, viability, cost of error — this workload fails the complexity criterion by design. Each of the six contracts specifies a fixed input and a fixed output. That is a **workflow with code-controlled logic**, the tier below an agent. A sequential runner calling six typed modules is easier to test, easier to debug, easier to explain to a judge, and easier to split across nine parallel agents than any framework's abstraction.
- **Tradeoff**: no free retry/observability machinery. Accepted; a sequential runner with explicit per-stage status is roughly a day's less work than learning a framework's failure modes, and `docs/requirements.md` §6 requires per-stage observability we would be building visibility into anyway.
- **Integration**: the runner is the natural place to enforce the J2 provenance-propagation check and the per-stage status required by §4 of the requirements.
- **Fallback**: none needed — this is the removal of a dependency, not the addition of one.

### Deterministic-first entity resolution

- **Reason**: `docs/requirements.md` §6 requires reproducibility, and §5 requires a documented confidence floor with a review queue. Exact identifier matching (phone, IMEI, account number) and string-similarity scoring are deterministic and explainable; the LLM is invoked **only** to adjudicate candidates in the ambiguous band. This isolates nondeterminism to one labeled, cached step instead of smearing it across the stage.
- **Tradeoff**: more upfront logic than "ask the model to merge these." Accepted — it is also the only version that can honestly claim reproducibility.
- **Fallback**: widen or narrow the LLM adjudication band; the deterministic core keeps working either way.

### `sigma.js` — graph visualization

- **Reason**: it consumes a `graphology` instance directly. The analytics model and the render model are the same object, so there is no serialization layer to keep in sync — a real source of bugs when two agents own the two halves. WebGL rendering handles our node count with room to spare.
- **Tradeoff**: less styling flexibility than Cytoscape.js.
- **Fallback**: Cytoscape.js, at the cost of writing a graph→JSON adapter.

### Leaflet + OpenStreetMap — map

- **Reason**: **no API key, no account, no secret.** In a public repository where the secret surface should stay at exactly one credential, that matters more than vector-tile polish. Leaflet is small, stable, and extremely well represented in training data.
- **Tradeoff**: raster tiles look less modern than MapLibre/Mapbox vector tiles.
- **Note**: this leaves `MAP_PROVIDER_API_KEY` in `.env.example` unused. That file is a template of categories the system *may* need (`docs/requirements.md`, P0.8), so an unused entry is not a contract violation; it is left in place.
- **Fallback**: MapLibre GL JS with a free tile source, if vector rendering becomes necessary.

### Vitest + Playwright — testing and visual evidence

- **Reason**: Vitest is TypeScript-native and fast for the unit and contract-conformance tests that Workstream J needs. Playwright earns its place twice: it provides E2E coverage **and** its screenshot/video capture is the natural implementation of Task I4 — the visual-evidence capture process required by `docs/progress/visual-evidence-convention.md`. Evidence produced by the same run that verifies the feature cannot drift from the feature, and cannot be fabricated.
- **Tradeoff**: Playwright downloads browser binaries (~500 MB disk) and uses ~500 MB–1 GB RAM while running. Accepted; it runs on demand, not continuously.
- **Fallback**: manual capture per the convention document, if Playwright automation proves fiddly.

---

## 4. Alternatives Considered

Scored 1–5 on the dimensions that actually discriminate here: **Speed** (implementation speed), **Agent** (AI coding-agent familiarity and documentation quality), **Fit** (capability fit for our stated requirements), **Host** (Apple Silicon + 18 GB suitability), **Ops** (integration, debugging, deployment simplicity — 5 = simplest), **Risk** (5 = lowest failure risk). All candidates listed are permissively licensed (MIT/Apache-2.0/BSD/public domain) and safe for a public MIT repository, so licensing did not discriminate between them; the one exception is noted.

### Application / backend

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Next.js full-stack (TS)** | 5 | 5 | 4 | 5 | 5 | 4 | **Selected** |
| FastAPI (Python) + React | 3 | 5 | 5 | 4 | 3 | 3 | Rejected — two runtimes, two dependency sets, CORS/serialization overhead, and a doubled contract surface across parallel agents. Its real advantage (pandas/networkx/spaCy) is neutralized by synthetic data we control and by `graphology` |
| Python-only (Streamlit/Gradio) | 5 | 4 | 2 | 5 | 5 | 3 | Rejected — cannot deliver the ten distinct UI surfaces in Workstream I (graph, map, timeline, profile, report preview) at demo quality |
| Separate TS API + SPA | 3 | 4 | 4 | 4 | 3 | 3 | Rejected — a second process and a network hop for no benefit at this scale |

### Structured data

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **SQLite (`node:sqlite`) + Drizzle** | 5 | 5 | 4 | 5 | 5 | 4 | **Selected** |
| PostgreSQL (Docker) | 3 | 5 | 5 | 3 | 2 | 3 | Rejected — a container, ~500 MB–1 GB RAM, credentials in a public repo's config, and setup time, to buy concurrency and types this demo never uses |
| Prisma + SQLite | 4 | 5 | 4 | 4 | 4 | 4 | Rejected narrowly — excellent DX, but the codegen step and engine binary add friction across nine agents; Drizzle's plain-SQL closeness also makes the FTS5 work easier |
| JSON files only | 5 | 4 | 2 | 5 | 5 | 2 | Rejected — no query layer for the provenance joins and evidence lookups the Copilot needs |

### Graph

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`graphology` in-memory** | 5 | 4 | 4 | 5 | 5 | 4 | **Selected** |
| Neo4j (Docker) | 2 | 5 | 5 | 2 | 1 | 2 | Rejected — 2–4 GB RAM, a container, Cypher as a second query language, and a persistence layer to synchronize. Genuinely better at 10M edges; we have ~20K |
| networkx (Python) | 4 | 5 | 5 | 4 | 2 | 3 | Rejected — best-in-class algorithms, but only reachable by adding the Python runtime this stack deliberately avoids |
| SQL recursive CTEs only | 3 | 3 | 2 | 5 | 4 | 2 | Rejected — expressible, but centrality and Louvain community detection in SQL is a poor use of a 36-hour budget |

### Retrieval

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **FTS5 + SQL + graph traversal** | 5 | 4 | 4 | 5 | 5 | 4 | **Selected** — every hit is a row with provenance |
| Qdrant / Weaviate (Docker) | 2 | 4 | 3 | 2 | 1 | 2 | Rejected — a service and ~1 GB RAM for semantic recall over a corpus small enough to search exhaustively |
| Chroma (embedded) | 4 | 4 | 3 | 4 | 3 | 3 | Rejected as a default; the embedded model is reasonable, but `sqlite-vec` in the existing database is a smaller step if embeddings become necessary |
| LlamaIndex RAG pipeline | 3 | 4 | 2 | 4 | 2 | 2 | Rejected — chunk-based retrieval actively works against the per-item provenance requirement |

### AI provider and orchestration

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Claude API + plain typed modules** | 5 | 5 | 5 | 5 | 5 | 4 | **Selected** |
| Local Ollama (8B, primary) | 3 | 4 | 2 | 2 | 3 | 2 | Rejected as primary — 5–6 GB RAM alongside everything else, and materially weaker structured extraction. Retained as an **offline fallback** |
| LangChain / LangGraph | 2 | 4 | 3 | 5 | 2 | 2 | Rejected — abstraction over exactly the layer whose transparency the provenance requirement depends on; also a fast-moving API surface for a 36-hour build |
| CrewAI / AutoGen | 2 | 3 | 2 | 5 | 2 | 1 | Rejected — multi-agent autonomy for a fixed six-stage pipeline is solving a problem this project does not have |

### Visualization and mapping

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **`sigma.js`** | 5 | 4 | 4 | 5 | 5 | 4 | **Selected** — shares the `graphology` model |
| Cytoscape.js | 4 | 5 | 5 | 4 | 4 | 4 | Strong runner-up and the designated fallback; loses only on the data-conversion layer |
| react-force-graph / d3-force | 3 | 4 | 3 | 4 | 3 | 3 | Rejected — more custom work for equivalent output |
| **Leaflet + OSM** | 5 | 5 | 4 | 5 | 5 | 5 | **Selected** — no key, no secret |
| MapLibre GL JS | 4 | 4 | 5 | 4 | 4 | 4 | Fallback — better rendering, slightly more setup |
| Mapbox GL JS | 4 | 5 | 5 | 4 | 3 | 3 | Rejected — requires an account and an access token, adding a second secret to a public repo for cosmetic gain |

### Testing

| Candidate | Speed | Agent | Fit | Host | Ops | Risk | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **Vitest + Playwright** | 5 | 5 | 5 | 4 | 4 | 4 | **Selected** — Playwright doubles as visual-evidence capture |
| Jest + Cypress | 3 | 5 | 4 | 4 | 3 | 3 | Rejected — Jest needs more TS/ESM configuration; Cypress is heavier than Playwright here |
| Vitest only | 5 | 5 | 3 | 5 | 5 | 3 | Rejected — no E2E coverage and no automated evidence capture |

---

## 5. Tradeoffs Accepted

Stated plainly, because implementation agents should not rediscover these as surprises:

1. **Weaker data-science ecosystem.** We give up pandas, networkx, and spaCy. Mitigated by controlling the synthetic data formats and by `graphology` covering the required algorithms.
2. **No semantic retrieval by default.** Paraphrased questions may miss. Mitigated by an additive `sqlite-vec` path if M8 shows it is needed.
3. **Single-writer, local-only database.** No concurrent writers, no hosted write path. Irrelevant to a single-operator demo.
4. **A network dependency and a per-token cost for inference.** Mitigated by the response cache, which converts the second run and the demo into offline replays.
5. **Raster map tiles.** Less polished than vector tiles; chosen to keep the secret surface at one credential.
6. **In-memory graph ceiling.** Fine at ~20K edges; would need rework at millions. Out of scope by design (`docs/requirements.md` §6 sets no scalability requirement beyond the fixed dataset).

---

## 6. Resource Implications

### Local, remote, and hybrid inference — the explicit comparison

| Approach | RAM cost | Quality | Demo-day risk | Verdict |
| --- | --- | --- | --- | --- |
| **Local only** (Ollama, 7–8B Q4) | 5–6 GB steady, competing with dev server, browser, editor, and coding agents | Materially weaker at schema-constrained extraction and multi-hop grounded reasoning — the two things this pipeline most depends on | Low (no network) | **Rejected as primary** |
| **Remote only** (Claude API) | ~0 GB | Highest | Network dependency at demo time | Selected as primary |
| **Hybrid: remote + response cache + optional local fallback** | ~0 GB normally; 5–6 GB only if the offline fallback is ever activated | Highest during development; degraded only in the offline emergency path | **Lowest** — a warm cache makes the demo fully offline | **Selected** |

The hybrid is not a hedge, it is the design: the cache is written during development anyway, so by demo time the canonical run replays from disk with zero network calls. The Ollama path exists only for the case where new, uncached evidence must be processed without connectivity, and its reduced quality is accepted and documented there.

### Runtime & Docker Posture (authoritative summary)

- **The default development and runtime path is the local Node.js/Next.js runtime** — `npm run dev`, nothing containerized.
- **SQLite is local-file based** — a file on disk, no server process.
- **The graph is in-memory** — a `graphology` instance rebuilt from SQLite at process start, not a persisted graph service.
- **Remote Claude inference is the primary inference path** for extraction, entity-resolution adjudication, and the Copilot.
- **Cached responses provide deterministic offline replay once the cache has been populated** — the *first* run of any given (model, prompt version, schema version, input) combination requires network access; every *subsequent* run of that same combination replays from disk with no network call, per the LLM Response Cache subsection above.
- **Local model inference (Ollama) is an emergency fallback only**, for the case where genuinely new, uncached evidence must be processed with no connectivity — never the default path, and its degraded quality must be disclosed if it is ever used for the actual demo.
- **Docker Desktop remains installed and available for optional infrastructure/testing use** — e.g. running Playwright in a container for CI parity, or sandboxing a future integration test — but is **not required** for ordinary development or runtime. This is a scoping distinction, not a contradiction: Hard Constraint #2 in the stack contract ("no Docker for application services") governs the architecture — no database, graph store, or pipeline component runs in a container — and does not forbid using Docker Desktop for incidental tooling that never becomes part of the running application.

### Resource Budget

Against an 18 GB host (Docker Desktop is currently allocated ~7.75 GB; because no application service runs in a container, that allocation is not drawn on during ordinary development):

| Component | Expected footprint | When it runs |
| --- | --- | --- |
| Next.js dev server (Node) | 400–700 MB | Continuously |
| SQLite (in-process) + page cache | 50–150 MB | Continuously |
| In-memory `graphology` graph | < 100 MB | Continuously (rebuildable) |
| Browser (Chrome, WebGL graph rendering) | 1–2 GB | Continuously |
| Editor + Claude Code agents | 1.5–3 GB | Continuously |
| Playwright (headless Chromium) | 500 MB–1 GB | On demand (tests, evidence capture) |
| Synthetic data generation script | < 300 MB | On demand (once) |
| Evaluation harness | < 300 MB | On demand |
| LLM inference | **0 GB local** | Remote (cached replay after first run) |
| Docker | **0 GB in the default path** | Not required; available on demand for optional tooling only |
| Ollama offline fallback (if activated) | 5–6 GB | Emergency only |

**Steady-state total: roughly 4–6 GB of 18 GB.** Comfortable headroom, with the largest single reclaim coming from not requiring Docker for the application. Even with the Ollama fallback active the system lands near 10–12 GB — tight but workable if the browser and editor are trimmed.

**Run continuously**: Next.js dev server, SQLite, browser.
**Run on demand**: Playwright, data generation, evaluation harness, production build; Docker only if an implementer chooses it for optional tooling.
**Run remotely**: LLM inference (cached after first run); optionally embeddings if the should-have semantic path is taken.

---

## 7. Integration Implications

### Architecture compatibility with the pipeline

Every stage of `Evidence → ingestion → extraction → entity resolution → graph synthesis → analytics → spatial/temporal corroboration → Copilot → dossier/report` maps to a concrete component, and each of the six agent contracts is implementable without modification:

| Contract | Implementation | Contract satisfied by |
| --- | --- | --- |
| **Agent 1 — Ingestion** | Route handler + typed intake module; files from `evidence/synthetic/`, normalized rows into SQLite | Per-item accept/reject with reason; provenance row written at intake; Zod validation produces the errors/warnings the contract requires |
| **Agent 2 — Entity Resolution** | Deterministic blocking/scoring + LLM adjudication for the ambiguous band; `resolved_entities` + `entity_mentions` tables | Merge confidence and justification are columns; contributing mentions are rows, so provenance is preserved structurally rather than by convention |
| **Agent 3 — Graph Synthesis** | `graphology` graph built from `nodes`/`edges` tables; `graph_version` column | Every edge row carries evidence references and an evidence-classification field; an edge without them fails Zod validation and is rejected, as the contract demands |
| **Agent 4 — Topology Analytics** | `graphology-metrics`, `-communities-louvain`, `-shortest-path` | Signals are written with method + explanation + graph version; the E3 guardrail is a Zod schema requiring the `Algorithmic Signal` classification, so an unlabeled signal cannot be emitted |
| **Agent 5 — Spatial/Temporal Corroboration** | TypeScript over SQLite: time-window overlap queries, haversine proximity | Findings cite the compared row IDs; "insufficient data" is a distinct result type from "no correlation found", as §4 of the requirements requires |
| **Agent 6 — Investigation Copilot** | FTS5 + SQL + graph traversal retrieval, then a Claude call constrained by structured outputs | Per-claim citations are row IDs that must resolve; the G4 guardrail rejects any answer whose citations do not resolve — grounding is verified in code, not assumed from the model |

**No genuine incompatibility was found. No contract requires modification.** Four points of friction were identified and resolved without weakening any requirement:

1. **LLM nondeterminism vs. the reproducibility requirement (§6).** Resolved by the response cache plus schema-constrained outputs — *not* by `temperature: 0`, which these models reject with a 400.
2. **Remote inference vs. demo reliability.** Resolved by the same cache; the canonical run replays offline.
3. **Unused `.env.example` entries** (`VECTOR_STORE_*`, `MAP_PROVIDER_API_KEY`, `STORAGE_*`). Not a violation — that file is a template of categories the system may need. Left as-is; §8 records which are actually used.
4. **Provenance across the LLM boundary.** Resolved by never letting the model mint identifiers: it selects from row IDs supplied to it, and any citation that does not resolve is rejected by the guardrail.

### Mapping to the 36-hour blueprint

- **Establish first (M1 gate)**: Next.js project skeleton, Drizzle schema, the Zod contract schemas, and the LLM client with its cache. These four are what every other workstream depends on; nothing else should start until they exist, because they *are* the shared contract surface.
- **Parallelizable once the skeleton exists**: synthetic data generation (Workstream A, pure TypeScript, no UI dependency), UI shells (Workstream I, against Zod types before real data flows), and the evaluation harness scaffolding (Workstream K, once ground truth exists).
- **Highest integration risk**: (a) the extraction→resolution boundary, where output shape drift silently corrupts everything downstream — mitigated by Zod contract tests at the boundary, per Task J1; (b) Copilot grounding, mitigated by the G4 guardrail; (c) graph↔UI data flow, minimized by `sigma.js` sharing the `graphology` model.
- **Fallback-equipped components**: inference (cache → Ollama), graph rendering (`sigma.js` → Cytoscape.js), map (Leaflet → MapLibre), retrieval (FTS5 → `sqlite-vec`), deployment (local → Vercel read-only).

This ADR does not modify the blueprint; it supplies the concrete technologies the blueprint's milestones assume.

---

## 8. Security and Secrets Implications

The stack was chosen partly to minimize the secret surface, and it lands at **exactly one required secret**:

| `.env.example` entry | Used? | Notes |
| --- | --- | --- |
| `AI_PROVIDER_API_KEY` | **Yes — the only required secret** | Claude API key; read from the environment, never committed |
| `DATABASE_URL` | Yes, as a local file path | No credential — SQLite is a file |
| `APP_SECRET`, `APP_ENV`, `APP_PORT`, `LOG_LEVEL` | Yes | No sensitive value |
| `MAP_PROVIDER_API_KEY` | No | Leaflet + OSM needs no key |
| `VECTOR_STORE_URL` / `VECTOR_STORE_API_KEY` | No | No vector store |
| `STORAGE_*` | No | Evidence lives on the local filesystem |

Existing controls already cover this: `.gitignore` excludes `.env` and `.env.*` (keeping `.env.example`), and GitHub secret scanning with push protection is enabled (`docs/repository-governance.md`). The synthetic-only rule is unaffected by any choice here — no selected technology transmits evidence anywhere except the Claude API, and the evidence sent there is fabricated by design (`docs/requirements.md` §9). Implementers should note that the LLM response cache will contain synthetic evidence text; since it is synthetic, committing it is permissible, but it should be treated as a build artifact and kept out of source control unless it is deliberately committed to guarantee the offline demo replay.

## 9. Licensing and Open-Source Implications

Every selected library is permissively licensed and compatible with this repository's MIT license: Next.js, React, Tailwind, shadcn/ui, `graphology` and its modules, `sigma.js`, Recharts, Vitest, `@anthropic-ai/sdk`, Zod (MIT); Drizzle, Playwright, `vis-timeline` (Apache-2.0 / dual); Leaflet (BSD-2-Clause); SQLite and `node:sqlite` (public domain / Node core, MIT). OpenStreetMap tiles are ODbL — attribution is required in the map UI and must be included; the standard Leaflet attribution control satisfies this. No copyleft obligation attaches to our source. The Claude API is a paid service rather than a licensing consideration; nothing about it restricts publishing this repository.

## 10. Rejected Alternatives

### Technologies/Patterns We Are NOT Using

**This section is binding. Implementation agents must not reintroduce anything below without a new ADR.**

| Rejected | Why |
| --- | --- |
| **Neo4j** (or any graph database server) | 2–4 GB RAM, a container, Cypher as a second query language, a sync layer. `graphology` in memory covers every required algorithm at our scale |
| **PostgreSQL / MySQL** | A server, credentials, and a container for concurrency and types a single-operator demo never exercises |
| **PostGIS** | Spatial correlation here is haversine distance and time windows — tens of lines of TypeScript |
| **Vector databases** (Qdrant, Weaviate, Pinecone, Chroma as default) | Semantic recall over a corpus small enough to search exhaustively, at the cost of a service and weaker provenance. `sqlite-vec` is the additive path if needed |
| **Elasticsearch** | FTS5 covers full-text search for five FIRs and a few dozen statements |
| **Redis** | No caching tier is needed; the LLM cache is a directory on disk |
| **Docker / docker-compose application services** | The single largest resource reclaim available. Nothing in this stack needs a container, and the ~7.75 GB Docker allocation is freed |
| **Kubernetes, IaC, multi-environment infrastructure** | Production scaling concerns irrelevant to a 36-hour local demo |
| **LangChain / LangGraph / LlamaIndex / CrewAI / AutoGen** | Abstraction over the exact layer whose transparency the provenance requirement depends on; fast-moving APIs; the six contracts describe a workflow, not autonomous agents |
| **A second language runtime (Python/FastAPI) for the application** | Doubles the contract surface across nine parallel agents for capability we can obtain in one language |
| **Local LLM as the primary inference path** | 5–6 GB RAM competing with the dev environment, and weaker structured extraction. Retained only as an offline fallback |
| **`temperature: 0` for determinism** | Not a stylistic rejection — sampling parameters are **removed on Claude Opus 5 and Sonnet 5 and return a 400**. Determinism comes from the response cache |
| **OCR / PDF parsing pipelines** (Tesseract, unstructured.io) | We author the synthetic evidence, so we choose text and structured formats. Real-world OCR is a different project |
| **Mapbox GL JS** | Requires an account and an access token — a second secret in a public repo for cosmetic gain |
| **Message queues / background workers** (Kafka, RabbitMQ, BullMQ) | The pipeline is a sequential run over a fixed dataset |
| **GraphQL** | A schema layer over an API consumed by one client in the same process |
| **Authentication, multi-tenancy, RBAC** | Single-operator demo; no requirement in any contract document |
| **CI/CD pipelines** | Explicitly named as non-essential automation in `docs/implementation-blueprint.md` §13 |
| **Microservices** | Every stage boundary would become a network boundary, multiplying failure modes during the highest-risk milestone |

---

## 11. Fallback Strategy

Ordered by likelihood of being needed:

1. **Network unavailable at demo time** → replay from the LLM response cache; the canonical run needs no network.
2. **Uncached evidence must be processed offline** → Ollama local model, accepting degraded extraction quality, disclosed in the presentation.
3. **Paraphrase retrieval proves too weak in M8** → add `sqlite-vec` embeddings to the existing database (additive, one module).
4. **`sigma.js` rendering or styling blocks progress** → Cytoscape.js plus a graph→JSON adapter.
5. **Leaflet raster tiles look inadequate** → MapLibre GL JS with a free vector tile source.
6. **`vis-timeline` API friction** → a hand-rolled SVG timeline (roughly 100 lines).
7. **Full-scale integration is unstable near the deadline** → demo the M2 walking-skeleton fixture end to end rather than the full dataset, disclosed honestly.
8. **Local demo environment fails on the day** → the optional read-only Vercel deployment, or Playwright-captured recordings per `docs/progress/visual-evidence-convention.md`.

## 12. Implementation Implications

What implementation agents should take as given:

- **Build the M1 gate first and completely**: Next.js skeleton, Drizzle schema, Zod contract schemas, LLM client with disk cache. Everything else depends on these four, and they are the shared contract surface across all parallel agents.
- **Zod schemas are the agent contracts made executable.** The contract-conformance tests in Task J1 are Zod validations at each stage boundary. Do not let a stage emit unvalidated output.
- **Provenance is a column, not a convention.** Every derived row carries source, location, method, confidence, processing history, and timestamp. A stage that cannot populate them fails validation rather than writing a partial row.
- **The model never mints an identifier.** It selects from row IDs supplied to it. Any citation that does not resolve to a real row is rejected by the guardrail before reaching a user.
- **Cache every LLM response from the first call.** Determinism, cost, and demo-day resilience all depend on the cache being warm — it cannot be retrofitted the night before.
- **No application service runs in Docker.** Docker Desktop remains installed and may be used for optional tooling (e.g. containerized CI/test runs) without a new ADR, but if an agent proposes putting the database, graph, or any pipeline component *itself* into a container, that is a deviation from this ADR requiring a new one.
- **`claude-opus-5` is the baseline model.** Stepping down for cost is a legitimate decision for the project owner, taken deliberately after prompt caching and the Batch API have been applied — not a default an implementation agent picks unilaterally.
