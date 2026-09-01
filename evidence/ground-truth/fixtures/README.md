# Ground-Truth Fixtures

The known-correct answer key for `evidence/synthetic/fixtures/`, kept separate per `docs/data/ground-truth-spec.md` §2.

**Isolation is architectural, not just conventional**: `src/lib/fixtures/synthetic-loader.ts` never reads from this directory, and nothing under `src/lib/db/` or `src/lib/domain/` references it. Only `src/lib/fixtures/ground-truth-loader.ts` reads these files, and it is never called from the production ingestion/persistence path — only from evaluation/test code. See `tests/unit/fixtures.test.ts` for an automated check of this boundary.
