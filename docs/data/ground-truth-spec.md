# Ground-Truth Specification — Operation DarkNet Delhi

**Status**: Specification only. This document defines what the eventual ground-truth artifact must contain and how it must be created and used. **No ground truth has been created yet**, because the synthetic dataset it depends on (`docs/data/synthetic-investigation-spec.md`) has not been generated yet.

## 1. Purpose

Ground truth is the independently authored, known-correct answer key for Operation DarkNet Delhi. It exists so that system output (entity merges, graph structure, analytics, corroboration findings, Copilot answers) can be objectively evaluated (`docs/evaluation/evaluation-spec.md`) rather than judged subjectively.

## 2. Separation from Production Evidence

**Ground truth must be created and stored separately from the synthetic evidence fed to the production inference pipeline.** Concretely:

- Ground truth lives under `evidence/ground-truth/`; synthetic case evidence intended for the pipeline lives under `evidence/synthetic/`.
- **Ground truth must never be exposed to, ingested by, or otherwise accessible to the production inference pipeline (ingestion, extraction, entity resolution, graph synthesis, analytics, corroboration, or Copilot).** It is a held-out answer key, not an input.
- Any evaluation harness that needs to read both the pipeline's output and ground truth must do so only after the pipeline has finished producing its output, and must not feed ground truth back into any stage.

## 3. Required Ground-Truth Content

The ground-truth artifact for Operation DarkNet Delhi must cover:

- **Expected entity merges** — the correct set of source mentions that should resolve into each single entity (i.e. the correct answer to entity resolution).
- **Aliases** — the correct mapping of every alias to its true underlying entity.
- **Key actors** — which entities are the case's principal suspects/intermediaries, as designed into the synthetic case.
- **Expected communities** — the correct grouping(s) of entities into meaningfully connected clusters, as designed into the case.
- **Transaction paths** — the correct money-mule/fund-flow paths that a financial-path analysis should recover.
- **Temporal overlaps** — the correct set of time-window correlations (e.g. co-active phones, overlapping presence) that a temporal analysis should recover.
- **Contradictions** — the correct set of conflicting statements/records that a contradiction-detection stage should surface, including which sources conflict and why.
- **Known hidden connections** — the deliberately non-explicit relationship(s) described in `docs/data/synthetic-investigation-spec.md` §4, and the evidence chain that should lead a correctly functioning pipeline to surface them.
- **Expected analytics signals** — the correct/expected output of network analytics (e.g. which entities should score highest on centrality, which communities should be detected) given the designed graph structure.
- **Expected Copilot answers** — for each canonical investigative question defined in `docs/demo/demo-contract.md`, the correct answer (or correct "insufficient evidence" response) and the evidence it should cite.

## 4. Authoring Requirement

Ground truth must be authored **from the case design**, independently of any system implementation — i.e. it encodes what the synthetic case generator intended to be true, not what any particular pipeline implementation happens to output. This ordering (design → ground truth → generation → implementation → evaluation) prevents ground truth from being unconsciously fitted to a specific implementation's behavior.

## 5. How Future Evaluation Will Compare Output Against Ground Truth

At a conceptual level (no evaluator is implemented by this document):

- **Entity resolution**: compare the pipeline's resolved-entity merge sets against the ground-truth merge sets (e.g. using standard clustering-comparison measures such as precision/recall over merge pairs) — see `docs/evaluation/evaluation-spec.md`.
- **Relationships/graph**: compare the pipeline's graph edges against ground-truth relationships, including the deliberately hidden connection(s).
- **Analytics**: compare computed signals (centrality, community membership) against the expected signals for the designed graph structure.
- **Temporal/spatial corroboration**: compare detected corroborations/contradictions against the ground-truth list, checking both recall (were the designed ones found) and precision (were spurious ones invented).
- **Copilot**: compare generated answers against expected answers/evidence citations for the canonical questions, checking both correctness and whether the evidence classification (`docs/requirements.md` §7) was applied correctly.
- **Reports**: check that every claim in a generated report traces to evidence, and that classification labels match what ground truth would expect for each claim type.

The evaluator itself, its metrics, and any pass/fail thresholds are defined in `docs/evaluation/evaluation-spec.md` and are **not implemented by this document**.

## 6. Explicit Non-Goals of This Document

- This document does not create the ground-truth data itself.
- This document does not implement an evaluator.
- This document does not choose a storage format or comparison algorithm implementation.
