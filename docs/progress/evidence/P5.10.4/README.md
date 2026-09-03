# P5.10.4 — Graph surface redesign: visual evidence

Evidence for ledger row **P5.10.4** (M10 / Workstream I), per
[`docs/progress/visual-evidence-convention.md`](../../visual-evidence-convention.md).

| Field | Value |
| --- | --- |
| **Ledger ID** | P5.10.4 |
| **Implementation status at capture** | In Progress (M10 milestone open; this task's artefacts complete) |
| **Associated Git commit** | `feat(P5.10.4): redesign investigation graph surface` — the commit this evidence was captured against. |
| **Capture date** | 2026-09-03 |
| **Captured by** | [`capture.mjs`](capture.mjs), run as `node docs/progress/evidence/P5.10.4/capture.mjs` — it drives the real Graph screen the same way `tests/e2e/investigation-synthesis.spec.ts` does (the deterministic node picker, never a raw canvas-coordinate click). |
| **Application state** | The real app (`next dev`) against `./data/netintel-e2e.db`, full Operation DarkNet Delhi pipeline advanced through graph synthesis (68 nodes / 196 edges). No mocking, no fixtures, no stubbed network. |
| **Theme** | The committed dark operational theme (`colorScheme: "dark"`, 1440×900). |
| **AI provider key** | Not configured. |

Every artefact is a real capture of the running system. Nothing here is a
mock, a placeholder, or a design comp.

## Artefacts

| File | What it shows |
| --- | --- |
| `P5.10.4_screenshot-overview_…png` | Full graph overview — the deterministic ForceAtlas2-style spatialization (`src/lib/graph/layout.ts`), all 68 nodes / 196 edges, kind/relationship-type color encodings, the legend, and the taller canvas (no 520px cap). |
| `P5.10.4_screenshot-focused-neighborhood_…png` | Rohan Malhotra selected via the node picker: the accent ring + always-on label (`defaultDrawNodeHover` in `graph-view.tsx`), his neighborhood at full opacity, everything else dimmed to ~12% — and the shared Entity Profile Inspector open on the right. |
| `P5.10.4_screenshot-selected-edge_…png` | A relationship selected from the Entity Profile's connection list: the shared Inspector's Relationship mode (source evidence, classification, confidence) — selection state and cross-navigation unchanged from M10.3. |
| `P5.10.4_screenshot-filtered_…png` | The `phone` kind filter toggled off — phone nodes and their edges disappear; existing filters (`hiddenKinds`/`hiddenTypes`, unchanged logic) still work against the new canvas. |
| `P5.10.4_screenshot-hover_…png` | The hover tooltip (`label · kind · degree`) over a real node, plus the same accent ring the selection state uses. |
| `P5.10.4_screenshot-legend_…png` | The legend: six node-kind swatches, seven relationship-type swatches, and an explicit "Dashed = AI inference" line. |
| `P5.10.4_screenshot-overview-reloaded_…png` | The same full-graph overview after a hard page reload. **Byte-identical** to `screenshot-overview` (verified: both `sha1 fdbbf2e93a52345797b0537ae32aabbb9d7f1054`) — direct proof that repeated loads produce the same layout, not just a visual approximation. |
| `P5.10.4_comparison_…png` | Side by side: the committed `docs/progress/evidence/P5.5` overview (the old circular positioning, captured 2026-09-02, before M10.2/M10.3/M10.4) on the left, and the new deterministically spatialized dark-theme canvas on the right. |

## Notes

- **Regression evidence.** On this commit: `npx tsc --noEmit`, `npx eslint
  .`, `npx vitest run` (466/466 — the pre-existing 462 plus 4 new
  `computeLayout` determinism tests), `npx next build`, `npx playwright
  test`, and `git diff --check` all pass. See the ledger row and the root
  commit for exact counts.
- **Only presentation changed.** `getGraphSnapshot`
  (`src/lib/graph/summary.ts`), the graph synthesis pipeline, and every
  other M8/M9/M10.2/M10.3 surface are untouched — this milestone edits
  `graph-view.tsx`, `graph-screen.tsx` (layout/legend only), and adds
  `src/lib/graph/layout.ts`, `src/lib/graph/tokens.ts`,
  `src/components/investigation/graph-legend.tsx`. No new dependency: the
  layout is a self-contained force-directed simulation using only
  `graphology`'s existing types, and the dashed AI-inference treatment
  uses a 2D canvas overlay kept in sync with sigma's own camera
  (`framedGraphToViewport`, `getNodeDisplayData`/`getEdgeDisplayData`,
  the `afterRender` event) — all part of the already-installed `sigma`
  package, not a new WebGL program or library.
- **A real bug found and fixed along the way.** The first working version
  produced solid-black nodes: Chromium's `getComputedStyle` serializes
  the `oklch()` tokens in `globals.css` back out as `lab(...)`, which
  sigma's bundled color parser (hex / `rgb()`/`rgba()` only) silently
  reads as opaque black. `resolveToken` (`src/lib/graph/tokens.ts`) now
  round-trips the resolved color through an actual 1×1 canvas pixel
  (`fillStyle` + `getImageData`), which always yields sRGB bytes
  regardless of the source color space — a format sigma can parse.
- **Layout tuning.** A first pass at the force-directed simulation
  (mass-scaled repulsion + FA2-style gravity) converged into an
  over-dense, largely-unreadable cluster for this specific corpus (196
  edges over 68 nodes, avg degree ~5.8): unscaled edge attraction
  compounds across every node's several simultaneous edges and
  overwhelms repulsion regardless of how large the nominal spacing
  constant is set. `ATTRACTION_SCALE = 0.22` in `computeLayout`
  (`src/lib/graph/layout.ts`) counteracts this; gravity was also changed
  from distance-scaled (unbounded growth that eventually out-pulled
  repulsion at any spacing) to FA2's default constant-magnitude mode.
- **What stayed frozen.** `EdgeView`/`NodeView`/`GraphSnapshot`
  (`src/lib/graph/types.ts`), `GET /api/graph/snapshot`, the shared
  Inspector (`src/components/investigation/inspector/`), every
  `data-testid` the existing e2e specs assert
  (`graph-canvas`, `graph-node-detail`, `graph-edge-detail`,
  `graph-filter-kind-*`, `toggle-focus-mode`, `graph-node-picker`, …),
  and Copilot/Dossier/Corroboration behavior are all unchanged.
