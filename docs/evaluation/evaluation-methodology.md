# Evaluation Methodology (Workstream K)

**Status:** Implemented. `npm run evaluate` produces `reports/evaluation/`.
**Implementation:** `src/lib/evaluation/`, entry point `scripts/evaluate.ts`, unit tests `tests/unit/evaluation.test.ts`.
**Companion:** `docs/evaluation/evaluation-spec.md` defines the categories; this document defines how each one is actually computed.

---

## 1. Design rules

Four rules, each of which changed the implementation somewhere:

1. **The evaluator reads persisted output; it never re-derives it.** Every metric is computed
   from what the pipeline wrote to the store, read back through `src/lib/db/repository.ts`.
   No metric re-runs a stage to obtain the value it scores, so a metric can never accidentally
   grade a different code path than the application uses.
2. **Ground truth is treated as an opaque external document.** `src/lib/evaluation/ground-truth.ts`
   reads `evidence/ground-truth/*.json` off disk with `fs` and imports nothing from
   `src/lib/corpus/`. Reusing the generator's own loader would let a generator bug cancel itself
   out. The harness never writes to the ground-truth file.
3. **No invented thresholds.** A metric carries a `threshold` only where the project already
   fixed one with a rationale. Exactly one does: provenance completeness at 100%
   (`evaluation-spec.md` §2, "not a tunable target but a correctness requirement"). Every other
   metric reports `threshold: null` and a verdict of *measured, un-judged*. That is not a gap
   in the harness — `evaluation-spec.md` §3 forbids inventing them.
4. **Ambiguity is reported, never guessed.** Where a ground-truth mention cannot be assigned to
   exactly one entity, it is excluded from the metric and counted in `details`. Guessing would
   move the numbers in an unknown direction.

## 2. How the two sides are joined

This is the part that determines whether any number means anything.

**Mention key.** The extractor writes `provenance.location = ${recordRef}#${fieldPath}`
(`src/lib/extraction/extract.ts`). Ground truth writes mentions three different ways —
`subscriber-registry:suspect:S1`, `fir:001:accused`, `witness:W1`. `normalizeMentionToRecordRef`
optionally strips a known source key, then takes the longest leading segment run that is a real
corpus record ref. It never invents a ref the corpus does not contain; unresolvable mentions
surface as a run-level error. All 46 documented mentions currently resolve.

**Entity key assignment.** A record ref alone is not always enough: `fir:001` names two accused
and is claimed by both S1 and S3. So the record ref narrows the candidates and the observed name
string picks between them. If neither step yields exactly one candidate, the mention is
unassigned and excluded.

**Subject widening.** Ground truth identifies parties by phone number or actor key; the
corroboration stage identifies them by whichever entity it resolved the activity to — in practice
the person entity, not the phone. The evaluator therefore maps each actor key to *every* entity
that may stand for it (person, phone, account, vehicle) and accepts a match on any of them.
This was not a cosmetic choice: matching on phone entities alone scored the temporal and spatial
metrics at 0/4 and 0/3 while the pipeline was in fact finding them correctly.

## 3. Metric catalogue

Each metric below is emitted with its definition, numerator, denominator, ground-truth source,
system input, threshold and limitations — in both `evaluation-results.json` and the generated
summary. The table is the index; the generated report is the authority.

| id | Category | Numerator | Denominator | Threshold |
|---|---|---|---|---|
| `extraction.accuracy` | Extraction accuracy | — | — | `NOT IMPLEMENTABLE YET` |
| `er.pairwise.precision` | Entity resolution | mention pairs co-clustered by system **and** ground truth | mention pairs co-clustered by the system | none defined |
| `er.pairwise.recall` | Entity resolution | mention pairs co-clustered by system **and** ground truth | mention pairs co-clustered by ground truth | none defined |
| `er.pairwise.f1` | Entity resolution | 2·P·R | P+R | none defined |
| `er.cluster.exactMatch` | Entity resolution | ground-truth clusters recovered exactly | ground-truth clusters with a scored mention | none defined |
| `er.mentionCoverage` | Entity resolution | documented (entity, record) mentions the pipeline produced | documented (entity, record) mentions | none defined |
| `er.mustNotMerge` | Entity resolution | same-name traps kept apart | same-name traps with both sides scorable | none defined |
| `er.alias.attachment` | Entity resolution | aliases attached to the right entity | aliases in `aliasMap` | none defined |
| `rel.precision` | Relationship extraction | (pair, type) edges in both | distinct person edges in the graph | none defined |
| `rel.recall` | Relationship extraction | (pair, type) edges in both | edges in `expectedRelationships` | none defined |
| `rel.f1` | Relationship extraction | 2·P·R | P+R | none defined |
| `rel.classificationAgreement` | Relationship extraction | matched edges whose classification agrees | matched edges | none defined |
| `graph.integrity` | Graph integrity | structurally sound relationship rows | relationship rows | none defined |
| `graph.hiddenConnection.recovery` | Graph integrity | hidden connections with a path | hidden connections with resolved endpoints | none defined |
| `corroboration.temporal.recall` | Spatial/temporal | designed temporal correlations found | designed correlations with resolvable parties | none defined |
| `corroboration.spatial.recall` | Spatial/temporal | designed spatial correlations found | designed correlations with resolvable parties and location | none defined |
| `contradiction.recall` | Contradiction detection | designed contradictions surfaced | designed contradictions | none defined |
| `analytics.community.pairwiseF1` | Analytics | 2·P·R over actor pairs | P+R | none defined |
| `analytics.expectedSignals.top1` | Analytics | expected actor ranked first | expected signals with a system equivalent | none defined |
| `provenance.completeness` | Provenance | rows with all six provenance fields | provenance-bearing rows | **≥ 100%** (requirements §8) |
| `copilot.grounding` | Copilot grounding | — | — | `NOT IMPLEMENTABLE YET` |

### `er.mentionCoverage` — why it exists

Pairwise precision and recall are computed only over mentions **both** sides produced. A mention
the extractor never emitted contributes no pair, so it cannot lower either number. Without a
coverage metric, a pipeline that reconstructed three people perfectly and missed the other nine
would score 100% and look finished. Coverage is the denominator the pairwise metrics do not
have, and the two must be read together.

### `rel.*` — scored undirected, on purpose

Ground truth records a communication between S1 and S2 once; the graph may carry S1→S2, S2→S1 or
both, depending on who dialled. Scoring direction would measure call ordering rather than whether
the relationship was found. Direction is reported in `details` and excluded from the score.

## 4. What is NOT IMPLEMENTABLE YET, and what it would take

**`extraction.accuracy`.** The ground-truth file defines expected merges, relationships,
correlations, communities, signals and Copilot answers. It defines no expected extraction for any
evidence item, so there is nothing to compare `extracted_records` against. Extraction is a
deterministic field-read, so a hand-written expected-extraction fixture over ~20 items of each
type would make this real — the cheapest missing metric to add.

**`copilot.grounding`.** The Copilot is the only stage that calls the Claude API. The evaluator
does not run it, for two reasons: without `AI_PROVIDER_API_KEY` no answer exists, and with one, a
metric whose value moves with sampling is not comparable across runs until the response cache is
warm and its composite key is verified. There is a real split worth building: retrieval
(`src/lib/copilot/retrieval.ts`) is fully deterministic, so **retrieval recall against
`expectedCopilotAnswers` can be scored offline with no model call at all**. Only answer
correctness needs the model. Citation resolvability is deterministic once an answer exists.

**Analytics reproducibility.** Listed in `evaluation-spec.md` and not yet implemented here.
It needs two pipeline runs compared, not one run scored, so it belongs in the script rather than
in a metric function. Cheap to add next.

**Report generation traceability.** The dossier stage is not run by the evaluator.
`src/lib/dossier/verify.ts` already enforces id resolvability at write time, so the metric would
re-check an invariant the write path guarantees; it is listed here so the omission is deliberate
and visible rather than forgotten.

## 5. Known weaknesses of this harness

- **One corpus, one seed.** Every number describes Operation DarkNet Delhi at seed 20260901.
  Nothing here demonstrates generalisation, and no number should be quoted as though it did.
  See `docs/evaluation/real-world-generalisation-test.md`.
- **Recall-only where ground truth is recall-only.** The corroboration metrics have no precision,
  because ground truth enumerates the correlations that were *designed to matter*, not every
  correlation the corpus contains. An extra finding is not necessarily a false one.
- **Pair counting weights large clusters.** One over-merge inside an eight-mention cluster costs
  more pairs than one inside a two-mention cluster. `er.cluster.exactMatch` is the counterweight.
- **The evaluator can be wrong.** It has 20 unit tests over the pair-counting arithmetic and the
  mention-normalisation rules precisely because a silently broken evaluator produces confident
  numbers, which is worse than no evaluator. Three metrics read 0% on the first run because the
  harness was matching phone entities against person-entity findings. That was an evaluator bug,
  found by checking the corpus by hand before publishing the number. Treat a surprising 0% as a
  claim to verify, not a result to report.

## 6. Running it

```bash
npm run evaluate          # runs the pipeline into ./data/cipher-eval.db, then scores it
npx vitest run tests/unit/evaluation.test.ts
```

The evaluation database is separate from the development and e2e databases and is wiped at the
start of every run, so a stale row can never contribute to a score.
