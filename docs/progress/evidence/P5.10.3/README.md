# P5.10.3 — Shared Inspector + Entity Profile: visual evidence

Evidence for ledger row **P5.10.3** (M10 / Workstream I), per
[`docs/progress/visual-evidence-convention.md`](../../visual-evidence-convention.md).

| Field | Value |
| --- | --- |
| **Ledger ID** | P5.10.3 |
| **Implementation status at capture** | In Progress (M10 milestone open; this task's artefacts complete) |
| **Associated Git commit** | `feat(P5.10.3): add shared investigation inspector and entity profile` — the commit this evidence was captured against. |
| **Capture date** | 2026-09-03 |
| **Captured by** | [`capture.mjs`](capture.mjs), run as `node docs/progress/evidence/P5.10.3/capture.mjs` — it drives the real screens the same way `tests/e2e/investigation-zzz-inspector.spec.ts` does. |
| **Application state** | The real app (`next dev`) against `./data/netintel-e2e.db`, full Operation DarkNet Delhi pipeline advanced through corroboration. No mocking, no fixtures, no stubbed network. |
| **Theme** | The committed dark operational theme (`colorScheme: "dark"`, 1440×900). |
| **AI provider key** | Not configured. |

Every artefact is a real capture of the running system. Nothing here is a
mock, a placeholder, or a design comp.

## Artefacts

| File | What it shows |
| --- | --- |
| `P5.10.3_screenshot-entity-profile-analytics_…png` | The shared **Entity Profile** opened from the Analytics ranked list — identity, structural metrics (an Algorithmic Signal), community, algorithmic signals, provenance, connected entities. |
| `P5.10.3_screenshot-analytics-with-inspector_…png` | The full Analytics screen with the shared Inspector docked on the right. |
| `P5.10.3_screenshot-entity-profile-graph_…png` | The **same** entity's profile, now shown in the Graph screen's Inspector — one component, both surfaces. |
| `P5.10.3_screenshot-focus-persists-graph_…png` | The full Graph screen after navigating from Analytics via the **sidebar** (no cross-nav button): the focused entity carried over — the command-bar focus chip and the Inspector both show it. |
| `P5.10.3_screenshot-relationship-detail_…png` | The Inspector's **Relationship** mode, drilled from a connected entity: type, direction, classification, confidence, conflicts, the source-evidence trail, provenance. |
| `P5.10.3_screenshot-evidence-reference_…png` | The Inspector's **Evidence Reference** mode, drilled from a source-evidence row — the reference the citing view carried, and an explicit note that the full source record is the Evidence surface's job (M10.6). |
| `P5.10.3_screenshot-inspector-cleared_…png` | The Inspector after an explicit clear — the empty state; the focus chip is gone. |
| `P5.10.3_screenshot-finding-detail_…png` | The Inspector's **Finding** mode in the Corroboration screen — classification, entities, window, metric, provenance, and the supporting-evidence chips that open the Evidence Reference. |
| `P5.10.3_recording-cross-nav_…mp4` | One take: Analytics → select an entity → "Corroboration" from the profile → Graph via the sidebar (focus carried) → inspect a relationship → drill a source-evidence row. |

## Notes

- **Recording format.** Playwright records `webm`; it was converted to
  `mp4` with `ffmpeg` for this row. The source `webm` is not kept.
- **Regression evidence.** On this commit: `npx tsc --noEmit`,
  `npx eslint .`, `npx vitest run` (462/462), `npx next build`,
  `npx playwright test` (**21/21** — the 20 existing specs plus the new
  `investigation-zzz-inspector.spec.ts`) and `git diff --check` all pass.
  The 20 pre-existing specs are unchanged.
- **What replaced what.** `graph-node-detail.tsx`, `graph-edge-detail.tsx`
  and `analytics-entity-detail.tsx` are removed; their behaviour and every
  `data-testid` they carried now live in
  `src/components/investigation/inspector/` (`EntityProfile`,
  `RelationshipDetail`, `FindingDetail`, `EvidenceReference`, `Inspector`).
