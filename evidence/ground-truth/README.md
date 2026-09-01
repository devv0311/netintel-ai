# Ground Truth

## `operation-darknet-delhi.ground-truth.json` — the held-out answer key

The independently-authored known-correct answers for **Operation DarkNet
Delhi** (P5.1), covering every category in
`docs/data/ground-truth-spec.md` §3: expected entity merges and
do-not-merge look-alikes, the alias map, expected relationships
(including the deliberately non-explicit ones), the hidden S1↔S4
connection and its evidence chain, the money-mule fund path, temporal
and spatial correlations, contradictions, expected communities and
analytics signals, intended conclusions, and the expected answer to each
of the 8 canonical demo questions.

**Isolation is architectural.** Per `docs/data/ground-truth-spec.md` §2
this is a held-out key, not an input:

- only `src/lib/corpus/ground-truth.ts` (`loadInvestigationGroundTruth()`)
  reads this file;
- nothing under `src/lib/db/**`, `src/lib/domain/**`, or the
  application-evidence corpus modules (`load.ts`, `persist.ts`,
  `generate.ts`, `validate.ts`, `manifest-schema.ts`, `index.ts`)
  imports it;
- `src/lib/corpus/index.ts` deliberately does not re-export it;
- `tests/unit/corpus.test.ts` asserts the boundary automatically.

Regenerated together with the application evidence by
`npm run corpus:generate`. Documentation: `docs/data/corpus.md`.

## `fixtures/`

The `foundation-smoke` ground-truth fixture for P4.2. See
`fixtures/README.md`.
