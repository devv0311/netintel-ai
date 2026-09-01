# Visual Progress Evidence Convention

This document defines the convention every major implemented feature must follow to provide visual proof of its state, as required by the [implementation ledger](./implementation-ledger.md).

## Requirement

Every major implementation feature must have, at minimum:

1. **An implementation screenshot** — a real capture of the feature in its working state.
2. **A side-by-side visual comparison against the intended/reference state**, where an intended/reference state exists (e.g. a design mock, a prior version, or a specification diagram) — placed next to the actual implementation so the two can be compared directly.
3. **An interaction recording**, where interaction matters (e.g. a multi-step user flow, a live query against the copilot) — a short screen recording, not a single static frame.
4. **An associated implementation status** — the ledger row's `Status` value at the time the evidence was captured.
5. **An associated Git commit** — the exact commit hash the evidence corresponds to, matching the ledger row's `Git Commit` value.

## Prohibited

- No fabricated, mocked, or placeholder screenshot may be labeled as implementation evidence.
- No visual artifact may be attached to a ledger row unless it depicts the actual running system at the referenced commit.
- No evidence may be back-dated or attributed to a commit other than the one it was actually captured against.

## Naming Convention

All visual artifacts live under `docs/progress/evidence/<feature-id>/` and follow:

```text
docs/progress/evidence/<feature-id>/<feature-id>_<type>_<yyyy-mm-dd>_<short-sha>.<ext>
```

- `<feature-id>` — the ledger ID the evidence supports (e.g. `P1.3`, matching the `ID` column in `implementation-ledger.md`)
- `<type>` — one of: `screenshot`, `comparison`, `recording`
- `<yyyy-mm-dd>` — capture date
- `<short-sha>` — the 7-character short form of the associated Git commit hash
- `<ext>` — `png`/`jpg` for screenshots and comparisons, `mp4`/`gif` for recordings

Examples:

```text
docs/progress/evidence/P1.3/P1.3_screenshot_2026-09-05_a1b2c3d.png
docs/progress/evidence/P1.3/P1.3_comparison_2026-09-05_a1b2c3d.png
docs/progress/evidence/P1.3/P1.3_recording_2026-09-05_a1b2c3d.mp4
```

## Current Status

**No visual evidence exists yet.** This convention is established during the pre-setup / foundation phase, ahead of any application feature implementation, so that the first implemented feature can follow it from the start.
