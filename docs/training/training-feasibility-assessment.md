# Training Feasibility Assessment

**Date:** 2026-09-03 · **Verified against commit `4493a3e`**
**Bottom line: nothing in this repository can be trained, and nothing in it should be. No ML framework was installed, and none should be.**

---

## 1. What "training" could mean, and what actually applies

The original brief assumed a trainable model. There is none. So the word has to be decomposed
before it can be answered. Seven things get called training; two apply here.

| # | Sense | Applies? | Why |
|---|---|---|---|
| 1 | **Local model training** — train weights from scratch | **No** | No model, no training code, no labelled dataset, no GPU budget, and no task where a from-scratch model would beat the deterministic code that exists. Would require adding PyTorch or equivalent to a Next.js app that runs on `npm run dev` with one secret. |
| 2 | **Fine-tuning** — adapt a pretrained model | **No** | The model is `claude-opus-5` reached over the API (`src/lib/ai/client.ts`). It cannot be fine-tuned from this project. Substituting a fine-tunable open model would violate the stack contract's Baseline row and needs a new ADR, not a data pipeline. |
| 3 | **Prompt / context optimisation** | **Yes — highest value** | The Copilot is the only AI component. Its quality is a function of prompt, retrieved context and the response contract, all of which live in `src/lib/copilot/` and are directly editable. |
| 4 | **Retrieval improvement** | **Yes — second highest** | `stack-contract.md` already frames this as the live question: `sqlite-vec` + embeddings are `Optional`, to be added "only if M8 shows paraphrase recall is insufficient". That decision is unmade because nothing measures paraphrase recall. |
| 5 | **Deterministic algorithm improvement** | **Yes — where the measured defects are** | The evaluator has just located specific, fixable defects in extraction, resolution and analytics. None needs learning. |
| 6 | **Evaluation-data construction** | **Yes — prerequisite for 3 and 4** | Ground truth exists for one corpus and covers merges, relationships and correlations but not extraction. Extending it is cheap and unblocks two currently-unmeasurable metrics. |
| 7 | **Future supervised ML components** | **Not yet** | Conceivable later; see §4. Nothing today justifies one. |

---

## 2. Where the measured defects are — none of them is a learning problem

From `reports/evaluation/evaluation-summary.md`, this commit:

| Finding | Number | Cause | Fix |
|---|---|---|---|
| Three actors never become people | `er.mentionCoverage` 39/46 | `phone_record.subscriberName` and `bank_account_record.holderName` produce no person `entity_mention` (`src/lib/extraction/extract.ts`) | Emit a person mention from those fields. ~20 lines. |
| 18 of 41 expected relationships missing | `rel.recall` 56.1% | Mostly the same cause — edges to M1/M2/M3 have no person endpoint — plus `associate` edges, which `src/lib/graph/build.ts` never emits at all (0 of 3) | Fix extraction first, then decide whether `associate` should be derived. |
| Classification never agrees | `rel.classificationAgreement` 0/23 | `graph/build.ts` classifies every derived person↔person edge `ai_inference`; ground truth calls the same relationships `observed_fact` | A definitional disagreement between two project documents. Reconcile the documents, then the code. Not a defect until that is settled. |
| No designed contradiction detected | `contradiction.recall` 0/3 | Only one detector exists (`spatiotemporal_contradiction`, impossible travel speed). Ground truth's three are `location_time`, `attribute` and `attribution` | Needs a cross-source claim comparator. Deterministic, and genuinely new work. |
| Expected top actors not ranked first | `analytics.expectedSignals.top1` 0/2 | X1 is expected highest-betweenness and ranks **9th of 9**; S1 expected highest-influence, ranks 3rd | Investigate. Likely the mixed entity/location graph dilutes person betweenness — a graph-construction question, not a model question. |

Every one of these is an edit to deterministic TypeScript. A model would not have found them and
cannot fix them.

---

## 3. What is worth doing, in order

**1. Extend ground truth to cover extraction.** `extraction.accuracy` is
`NOT IMPLEMENTABLE YET` purely because no expected-extraction fixture exists. Extraction is a
deterministic field-read, so a hand-written fixture over ~20 items per evidence type is a few
hours' work and makes a whole evaluation category real.

**2. Build offline Copilot retrieval evaluation.** `src/lib/copilot/retrieval.ts` is fully
deterministic. Retrieval recall against the 8 `expectedCopilotAnswers` can be scored **with no
model call and no API key**. This is the single highest-value unmeasured thing in the project,
and it is what would settle the `sqlite-vec` question on evidence instead of intuition.

**3. Prompt and context optimisation, measured.** Only after (2). Optimising a prompt without a
retrieval metric is guessing. Note the constraint from `stack-contract.md`: sampling parameters
return 400 on Opus 5, so determinism comes from the response cache, not `temperature: 0` — a
prompt experiment must invalidate that cache correctly (the key includes prompt version) or it
will silently replay pre-edit answers.

**4. Fix the deterministic defects in §2 and re-run the evaluator.** Every one has a number
attached now, so the fix is verifiable rather than asserted.

**5. Set thresholds.** `evaluation-spec.md` §3 requires a threshold with a rationale before a
feature is marked Demo Ready. Nineteen metrics now have real numbers on a real corpus; that is
the evidence base for setting them. This harness deliberately does not set them itself.

---

## 4. If a supervised component is ever justified

Three places could plausibly use learning, and each has a deterministic alternative that should
be exhausted first:

| Candidate | What it would learn | Try first |
|---|---|---|
| Fuzzy entity matching | Whether two name strings denote one person, under transliteration and ordering variation | Deterministic normalisation, phonetic keys, and the LLM adjudication band the stack contract already specifies but has not implemented |
| Free-text extraction | Structured records from unstructured documents | Claude structured outputs with `strict: true` tools — already the specified Baseline, also unimplemented |
| Paraphrase retrieval | Semantic match beyond FTS5 | `sqlite-vec` with a hosted embedding call — already the specified `Optional` fallback |

In all three cases the project already chose a non-training answer and has not yet built it.
Adding a trained component before building the chosen one would be solving a harder problem than
the one in front of us.

**Preconditions before any of this is reconsidered:** the evaluation harness has thresholds set;
the deterministic defects in §2 are fixed and re-measured; a labelled dataset exists that is
legally clear for the project's commercial posture (see `docs/data-research/source-registry.md`
§4.1); and the schema decision in `docs/architecture/public-data-schema-options.md` is made.

---

## 5. Explicit statement

No ML framework was installed. No model was trained, fine-tuned or downloaded. No dependency was
added to `package.json` except one npm script (`evaluate`). The evaluation harness uses only
TypeScript and the packages already present.
