# P6.23 — Case overview, entity search and dark-first: visual evidence

Evidence for ledger rows **P6.23.1** / **P6.23.2**, per
[`docs/progress/visual-evidence-convention.md`](../../visual-evidence-convention.md).

| Field | Value |
| --- | --- |
| **Ledger ID** | P6.23.1 |
| **Implementation status at capture** | COMPLETE (UI milestone; no policy or backend work) |
| **Associated Git commit** | `a7f4535` — `feat(P6.23.1): a case overview, entity search, and dark-first delivered` |
| **Baseline commit (the "before" captures)** | `af22018` — `docs(P6.21.2): the parent/subsidiary decision memo` |
| **Capture date** | 2026-09-04 |
| **Captured by** | Playwright/Chromium driving the real app (`next dev`) against a database seeded by POSTing the real pipeline endpoints in order — ingestion → extraction → resolution → graph → analytics → corroboration → dossier. No mocking, no fixtures, no stubbed network. |
| **Application state** | Full Operation DarkNet Delhi pipeline, all nine stages complete: 1,820 evidence items / 6 sources, 2,044 extracted records, 61 resolved entities, 75 nodes / 191 edges, 104 dossier findings. |
| **Theme** | The committed dark operational palette — which, as of this milestone, is what a default browser context actually renders (see §3). |
| **AI provider key** | Not configured. The Copilot card states this rather than implying a model answered. |
| **Viewports** | 1440×900 (desktop) and 420×900 (mobile), `deviceScaleFactor: 2`. |

Every artefact is a real capture of the running system. Nothing here is a
mock, a placeholder, or a design comp.

## Artefacts

### Before → after, same screen, same data

| Before (`af22018`) | After (`a7f4535`) |
| --- | --- |
| `P6.23_screenshot-before-evidence_2026-09-04_af22018.png` | `P6.23_screenshot-after-evidence_2026-09-04.png` |
| `P6.23_screenshot-before-graph_2026-09-04_af22018.png` | `P6.23_screenshot-after-graph_2026-09-04.png` |
| `P6.23_screenshot-before-analytics_2026-09-04_af22018.png` | `P6.23_screenshot-after-analytics_2026-09-04.png` |
| `P6.23_screenshot-before-corroboration_2026-09-04_af22018.png` | `P6.23_screenshot-after-corroboration_2026-09-04.png` |
| `P6.23_screenshot-before-copilot_2026-09-04_af22018.png` | `P6.23_screenshot-after-copilot_2026-09-04.png` |
| `P6.23_screenshot-before-dossier_2026-09-04_af22018.png` | `P6.23_screenshot-after-dossier_2026-09-04.png` |

The "before" set has no Overview counterpart because **there was no
Overview screen** — the rail entry existed and was permanently disabled.

### New surfaces

| File | What it shows |
| --- | --- |
| `P6.23_screenshot-after-overview_2026-09-04.png` | The case overview. Case identity, the five-step investigator path with each step's real stage state, and one card per stage. The Graph card's classification census — 1 Observed Fact, 156 Corroborated Fact, 34 AI Inference — sums to the 191 edges the graph actually holds. |
| `P6.23_screenshot-after-entity-search_2026-09-04.png` | Command-bar entity search, open on the query `Rohan`: one real resolved entity, its recorded aliases, its kind. The caption under the hero variant states which set is being searched. |
| `P6.23_screenshot-after-graph-focused_2026-09-04.png` | The result of selecting that entity — the Graph screen, the entity focused, and the focus chip set in the command bar. Search → Graph in one action. |
| `P6.23_screenshot-after-overview-light_2026-09-04.png` | The same overview after the theme toggle. The light palette is now an explicit choice rather than an inherited OS setting. |
| `P6.23_screenshot-after-overview-mobile_2026-09-04.png` | 420×900. The rail is an icon strip, the flow steps wrap, the pipeline meter scrolls in one row, and nothing overflows horizontally. Before this milestone a 240px rail on a 420px viewport pushed the case off-screen. |

## 1. What the before/after pair is meant to show

- **Evidence** — unchanged in structure. The only content change is the
  "What happens next" card, which previously claimed six stages were
  "later milestones … unavailable until then" while all six were complete
  and live on the rail.
- **Graph** — three stacked control bands (~380px) became one toolbar row;
  the canvas gained that height. Filters became toggles carrying the
  canvas's own colour tokens, with hidden facets dashed, dimmed and struck
  through. **Node labels were black on the dark canvas** and are now
  legible — see §3.
- **Analytics / Corroboration / Copilot / Dossier** — no structural change.
  They are included because a theme change touches every surface, and the
  pair is the proof that it did not break them.

## 2. Every number on the Overview is the pipeline's own

No metric on the new screen is computed in the component. Each is read
from the same server-derived summary the shell already receives, and the
UI smoke suite asserts the equality directly rather than by eye:

```
PASS overview graph counts match the API (75 nodes / 191 edges)
```

A stage that has not run renders a stated "not run" line, never a zero.

## 3. A real defect this milestone exposed and fixed

Sigma's `labelColor` defaults to black. The selection/hover label already
read `--fg`, but ordinary node labels did not, so on the dark operational
canvas the product was always meant to render, node labels were black on
near-black. It had gone unseen because `@media (prefers-color-scheme:
light)` meant a default browser almost never rendered the dark canvas.
Making dark the actual default surfaced it immediately. Compare the label
legibility in the before/after graph pair.

## 4. Regression status at capture

| Gate | Result |
| --- | --- |
| `vitest run` | **621 / 621** |
| `tsc --noEmit` | clean |
| `eslint .` | clean |
| `next build` | clean |
| UI smoke checks (19, driving the real app) | **19 / 19** |
| Playwright e2e | 15 passed · 3 failed · 3 did not run |

**The three e2e failures are pre-existing and are not a regression.** A
pristine `git archive af22018` checkout, run through the identical
harness, produces the identical 15/3/3 result. All three are the same
root cause — hard-coded corpus expectations that the resolver's own
behaviour has since moved past:

| Spec | Assertion | Expected | Actual |
| --- | --- | --- | --- |
| `investigation-resolution.spec.ts:99` | `resolution-count-person` | 10 | **17** |
| `investigation-synthesis.spec.ts:124` | `graph-count-person` | 10 | **17** |
| `investigation-topology.spec.ts:128` | `analytics-count-ranked` | 68 | **75** |

They are reported, not fixed. Correcting them means either changing
resolution semantics or re-baselining evaluation expectations, and this
milestone is explicitly forbidden from doing either. See the final report
and the P6.23.2 ledger row.
