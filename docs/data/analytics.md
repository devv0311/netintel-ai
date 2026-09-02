# Topology Analytics Pipeline (P5.6)

**Status**: Implemented. This is the fifth real investigation workflow —
load graph state → build a deterministic analysis graph → compute
degree/centrality → detect bridges → detect communities → compute an
investigative ranking → validate → attach provenance → persist →
rebuild the in-memory analysis graph → return a structured result. It
covers topology analytics only; spatial/temporal corroboration, the
Copilot, and the dossier are later milestones.

Everything analyzed comes from the already-synthesized, fully synthetic
**Operation DarkNet Delhi** graph (`docs/data/graph.md`). Analytics
reads only already-persisted entities, locations, relationships, and
the graph-synthesis completion marker — never a file, never
`evidence/ground-truth/`, and never a new relationship.

---

## 1. What topology analytics is — and is not

Analytics computes deterministic structural signals over the P5.5
graph, per Agent 4 (`docs/contracts/agent-contracts.md`). It produces:

- **Degree** — total, weighted (summed `attributes.eventCount` across
  incident edges), incoming, outgoing, and a breakdown by relationship
  type. Computed live on request (`GET
  /api/analytics/entities/[id]`) — degree is a direct property of the
  already-persisted graph, so recomputing it costs nothing and there is
  no reason to also persist a second, potentially-stale copy of it.
- **Centrality** — degree centrality and betweenness centrality
  (`graphology-metrics`), one signal of each kind per graph node
  (entity or location).
- **Bridges** — structural articulation points: entities/locations
  whose removal would split the network into more connected
  components. Computed via a deterministic (sorted-neighbor-order)
  implementation of Tarjan's articulation-point algorithm over an
  undirected projection of the graph — `graphology`/`graphology-metrics`
  ship no built-in cut-vertex function, so this one function is
  hand-implemented in `src/lib/analytics/build.ts`, deterministically,
  with no external dependency added.
- **Communities** — modularity-based clusters (`graphology-communities-
  louvain`), seeded with a fixed deterministic PRNG (Louvain defaults
  to `Math.random`, which this project never uses for an observable
  result).
- **Investigative ranking** — a combined "structural prominence" score
  per node: `0.35 × betweenness + 0.35 × degree centrality + 0.30 ×
  normalized bridge score`. Every ranked result exposes its component
  metrics — never a single opaque number.
- **Shortest path** — computed live (`GET /api/analytics/path`), never
  persisted (see §9). Undirected reachability with each edge's true
  stored direction preserved in the result, optionally restricted to a
  set of relationship types.

Analytics does **not**:

- recreate identity resolution, graph synthesis, or invent a
  relationship — every computation reads the graph exactly as P5.5
  built it and never adds, removes, or reroutes an edge.
- imply guilt, criminal involvement, or organizational structure. A
  bridge is a **structural** signal about network position — the
  milestone brief is explicit that raw degree, betweenness, or bridge
  status alone is never "suspicious." A community is a **connected
  group**, never a "criminal organization." The ranking is
  **Investigative Priority / Structural Prominence**, never a
  "criminality score."
- draw any investigative conclusion beyond the structural fact being
  reported — even the money-mule chain (§6) is described exactly as it
  is (an account-level financial chain), never re-labeled as
  "laundering" or "suspicious."

Every signal is classified **exactly** `algorithmic_signal`
(`docs/requirements.md` §7) — never `observed_fact`,
`corroborated_fact`, `ai_inference`, or `investigative_lead`.
Classification is enforced at three layers: the domain schema
(`AnalyticalSignalSchema` fixes `classification` to the literal type),
`src/lib/analytics/verify.ts`'s `assertProvenance` (rejects any other
value before persistence), and a serialized-string scan for every
forbidden classification literal.

---

## 2. Demo workflow

```bash
npm install
npm run dev            # http://localhost:3000
```

1. Ingest, extract, resolve, then synthesize the graph
   (`docs/data/ingestion.md`, `docs/data/extraction.md`,
   `docs/data/resolution.md`, `docs/data/graph.md`).
2. Once the graph is synthesized, the evidence workspace shows
   **Compute topology analytics** with a **Run Analytics** button.
3. Click it. Watch the ten real analytics stages advance.
4. On completion the workspace shows **Analytics synthesized** with
   ranked/bridge/community counts, and the sidebar's **Analytics**
   entry becomes clickable — live, without a page reload.
5. Open **Analytics**. The screen shows an overview strip, a tab
   switcher (Ranked entities / Bridge entities / Communities), an
   entity-detail panel on selection, and a shortest-path panel below.
   Selecting an entity or a path result offers **View in graph**,
   which hands off to the Graph screen focused on that entity's real
   neighborhood.
6. Reload the page — the synthesized analytics stay. Click **Re-run
   analytics** — it reports the run is already complete.

---

## 3. Analytics algorithm

`src/lib/analytics/build.ts` — `synthesizeAnalytics(entities, locations,
relationships, investigationId, graphVersion, analyzedAt)` is a pure
function over already-persisted state.

### Analysis graph

`buildAnalysisGraph` constructs its **own** `graphology` instance from
the persisted rows — deliberately not a reuse of
`src/lib/graph/runtime.ts`'s `buildGraphFromRows`, per this milestone's
explicit constraint not to rewrite the P5.5 graph engine. Both
functions build from the exact same source rows via the same
`createEmptyGraph()` factory, so the two graphs are structurally
identical projections; the analytics version additionally carries a
`weight` edge attribute (from `attributes.eventCount`, defaulting to
`1`) that Louvain's weighted modularity needs and the P5.5 rendering
graph has no use for.

### Degree, centrality, bridges

Degree is read directly from `graphology`'s own `degree`/`inDegree`/
`outDegree`, with a `byRelationshipType` breakdown computed by walking
incident edges. Degree and betweenness centrality come from
`graphology-metrics`. Bridges come from a local, deterministic
Tarjan's-algorithm implementation over an **undirected** projection of
the graph (connectivity — "does removing this node disconnect the
network" — is inherently an undirected question, distinct from the
directed graph used for in/out degree).

### Communities

`graphology-communities-louvain` groups nodes by modularity, seeded
with a fixed mulberry32 PRNG (never `Math.random`) so the same graph
always produces the same partition. **Cluster ids are content-
addressed from the sorted member-entity-id set** —
`makeContentId("community", sortedMemberIds)` — never the algorithm's
own raw integer community index, which is not guaranteed stable
between otherwise-identical runs. This is what makes community ids
genuinely deterministic rather than merely "usually the same."

### Investigative ranking

A weighted combination of betweenness centrality (35%), degree
centrality (35%), and a bridge score normalized against the graph's
maximum observed bridge score (30%). Ties are broken by node id (never
by insertion order or a random tiebreak), so the exact rank ordering is
reproducible byte-for-byte across runs — proven in
`tests/unit/analytics.test.ts`.

### Shortest path

`src/lib/analytics/paths.ts` — `computeShortestPath` builds a **separate**
undirected projection (distinct again from both the P5.5 rendering
graph and the directed analysis graph) and runs
`graphology-shortest-path`'s `bidirectional` search. Reachability is
undirected because a strictly-directed search would report "no path"
between two people connected only through an identifier one owns in
the "wrong" direction for a directed walk (e.g. `ownership` edges are
always person → identifier, never the reverse) — investigatively, they
ARE connected. Each edge in the result still reports its true stored
`directed`/`relationshipType`, so the investigator sees the real flow
(e.g. a financial chain's actual from-account → to-account direction),
never a direction-stripped abstraction.

An optional relationship-type filter restricts the edge set the path
search can traverse *before* the graph is built, so a filtered query
can never find a path through an excluded edge type. A missing source/
target, a source-equals-target query, or a genuinely disconnected pair
all return a structured `{ found: false, reason }` result — never a
thrown error.

---

## 4. Full-corpus results (Operation DarkNet Delhi)

| Metric | Count |
| --- | --- |
| Entities analyzed | 54 |
| Locations analyzed (also graph nodes) | 14 |
| Edges analyzed | 196 |
| Centrality signals | 136 (68 nodes × 2 methods) |
| Bridge entities | 19 |
| Communities | 11 |
| Ranked entities | 68 |
| **Total persisted signals** | **234** |

Communities split cleanly along real structural lines: an 8-account
bank-account-only community (the financial-chain cluster), a 20-member
phone/imei/location community (the communication cluster), a 15-member
person/vehicle-dominant community (the core suspect cluster), and
several 1-member communities for isolated locations and the standalone
"Rahul Mehta" / "W6" entities — never merged into a larger cluster they
have no structural connection to.

---

## 5. Provenance

Every `AnalyticalSignal` carries the full six-field provenance object
(`docs/requirements.md` §8):

- **source** — the target node id (or the community's content-
  addressed cluster id, for community signals with no single target
  entity).
- **location** — `graph_version:<graphVersion>` — which exact graph
  state this signal was computed against.
- **method** — `analytics:<algorithm>` (e.g.
  `analytics:degree_centrality`, `analytics:betweenness_centrality`,
  `analytics:articulation_point`, `analytics:louvain_community`,
  `analytics:investigative_ranking`).
- **confidence** — `1` for every signal — a deterministic structural
  computation has no uncertainty of its own to express (confidence
  here answers "how faithfully was this computed," not "how likely is
  this true," which is exactly what P5.2–P5.5 already establish
  confidence means).
- **processingHistory** — `["graph:synthesized:<graphVersion>",
  "<method>"]` — traces back through the graph version to P5.5's own
  synthesis, never replacing that chain.
- **timestamp** — the real wall-clock instant the analytics run
  executed.

Every signal's `value` references **ids**, never inline evidence
copies: `supportingEdgeIds` (real `relationships.id` values),
`memberEntityIds`/`representativeEntityIds` (real entity/location ids).
Tracing "why does this signal exist" means resolving those ids back
through `GET /api/graph/edges/[id]` (P5.5) to the underlying
`extracted_records` — analytics adds a layer of structural
interpretation on top of the graph without duplicating a single byte
of the evidence beneath it.

---

## 6. Non-inference and classification guarantees

- **Raw degree/centrality/bridge status is never presented as
  suspicious.** Every UI surface and every persisted `explanation`
  string says so explicitly (e.g. bridge signals: "a structural signal
  about network position, never a claim of wrongdoing"; ranking
  signals: "an algorithmic signal about network position, never a
  claim of involvement").
- **Communities are never labeled a criminal organization.** Neutral
  terminology only — "community," "cluster," "connected group" — in
  both the persisted `explanation` text and every UI label.
- **The investigative ranking is never called a "criminality
  score."** It is labeled "structural prominence" / "investigative
  priority," and every ranked result's component metrics
  (`degreeCentrality`, `betweennessCentrality`, `bridgeScore`, `degree`,
  `communitySize`) are exposed alongside the combined score — never a
  single opaque number a user has to trust blindly.
- **S1↔S4 stays structurally indirect through analytics too.** The
  unfiltered shortest path between Rohan Malhotra and Farhan Qureshi
  resolves as `Rohan Malhotra → Kabir Sharma → Farhan Qureshi` (2 hops
  — a real S3↔S4 communication pair plus a real S3→S1 payment, both
  directly stated in the corpus) — analytics never manufactures a
  direct edge to "solve" the case faster. A financial-only filtered
  query instead surfaces a separate, real derived chain (`Rohan
  Malhotra → Anjali Verma → Deepak Yadav → Farhan Qureshi`, 3 hops) —
  distinct from the raw money-mule account chain, which is not
  reachable through this same query because the mule intermediaries
  never received a P5.4 person entity (see `docs/data/graph.md` §6) and
  therefore have no derived person-level edge to traverse through.
- **The money-mule chain stays represented through real bank-account
  entities.** Analytics never substitutes a synthetic "mule path" edge
  or signal — the financial community detected by Louvain is exactly
  the 8 real bank-account nodes the P5.5 financial edges already
  connect, nothing more.
- **Noise phone numbers never gain fabricated connectivity.** Every
  ranked signal for a phone entity is backed by at least one real,
  persisted relationship — analytics assigns a rank to every graph
  node (even a degree-zero one would rank last), but never invents an
  edge to make a node appear more connected than the evidence
  supports.

---

## 7. Ground-truth isolation

`src/lib/analytics/` never imports the ground-truth loader or addresses
`evidence/ground-truth/`, and never references any ground-truth-only
field name (`expectedEntityMerges`, `hiddenConnections`,
`intendedConclusions`, `expectedCopilotAnswers`, `moneyMulePaths`,
`resolutionForbidden`, `recoverableBy`, `aliasMap`, …) — verified by a
source-scan test mirroring `tests/unit/graph.test.ts`'s, plus a second
test scanning the actual **persisted signal output** of a full-corpus
run for the same forbidden strings. Every structural claim in §6 above
was discovered and verified by reading persisted evidence and running
the real algorithm, never by consulting the ground-truth answer key.

---

## 8. Error taxonomy

| Code | Cause |
| --- | --- |
| `NO_INVESTIGATION` | Analytics was requested before any evidence was ingested. |
| `NO_GRAPH` | Analytics was requested before graph synthesis had run (or the graph marker/relationships are missing). |
| `VALIDATION_FAILURE` | A candidate signal fails its Zod schema, or a provenance/classification/graph-version invariant is violated. |
| `PERSISTENCE_FAILURE` | A repository write failed mid-persist (store may be partially populated; re-run to finish — already-written rows are skipped). |
| `INTERNAL_ERROR` | Any other unexpected error (details logged server-side only). |

---

## 9. Deterministic IDs & idempotency

- Signals: `makeContentId("analytical_signal", [signalType-ish key
  parts…, targetId-or-clusterId, graphVersion])` — every signal id
  includes the graph version it was computed against, so a
  re-synthesized graph (a new graph version) naturally produces a
  **different** set of signal ids rather than silently overwriting or
  shadowing stale analytics from a prior graph state.
- Communities: `makeContentId("community", sortedMemberEntityIds)` —
  content-addressed from membership, not the algorithm's raw index.
- **Shortest paths are never persisted.** A path is an
  investigator-parameterized query result (source, target, optional
  relationship-type filter chosen at request time), not a corpus-wide
  structural fact the way centrality or communities are — persisting
  every possible query result would be unbounded and stale the moment
  the graph changes. It is always recomputed live, deterministically,
  from the same persisted graph.

First run creates every signal; a repeat run against the **same graph
version** finds every id already present and writes nothing (`status:
"already_synthesized"`); a partial-write retry (proven in
`tests/unit/analytics.test.ts`) persists only the rows still missing.

---

## 10. What downstream milestones can rely on

- **P5.7 (spatial/temporal corroboration)** — every signal's
  `value.supportingEdgeIds` resolves to real `relationships.id` values,
  which P5.5's own edge detail (`GET /api/graph/edges/[id]`) already
  exposes `communication_events`/`financial_transactions` timing data
  for — P5.7 can layer temporal/spatial correlation directly on the
  same edge references analytics already cites, without re-deriving
  them.
- **P5.8 (Copilot)** — `GET /api/analytics/entities/[id]` and `GET
  /api/analytics/path` give citable, resolvable structural claims (a
  centrality score, a bridge status, a path) the Copilot can quote with
  a real signal id — never a number it invents itself — continuing the
  "the model never mints an identifier" guarantee.
- **P5.9 (dossier/report)** — the investigative ranking
  (`analytics:investigative_ranking`) and its exposed component metrics
  give the report a ready-made, provenance-complete "structurally
  significant entities" section, already correctly labeled Algorithmic
  Signal per §7 of the requirements.

## 11. Limitations

- Betweenness centrality is computed unweighted
  (`getEdgeWeight: null`) — path *count* between nodes, not path
  *strength* — matching the stack contract's baseline centrality
  metrics (degree + betweenness) without introducing a weighting
  scheme this milestone does not require.
- The investigative-ranking weights (35/35/30) are a fixed, documented
  formula, not a tunable or learned model — consistent with this
  project's deterministic-first design throughout the pipeline.
- Shortest-path queries only ever return **one** shortest path (via
  `bidirectional`'s deterministic sorted-neighbor traversal) even when
  multiple equally-short paths exist — the investigator can narrow with
  a relationship-type filter to explore an alternative route, but this
  milestone does not enumerate all shortest paths.
