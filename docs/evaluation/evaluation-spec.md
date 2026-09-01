# Evaluation Specification

**Status**: Specification only. This document defines evaluation categories and how they relate to ground truth. **No evaluator is implemented by this document, and no pass/fail threshold is invented beyond what the project's existing requirements already specify.**

## 1. Relationship to Ground Truth

Every category below is measured by comparing system output against the ground truth defined in `docs/data/ground-truth-spec.md`, for the canonical case defined in `docs/data/synthetic-investigation-spec.md`. Ground truth must remain isolated from the production pipeline per `docs/data/ground-truth-spec.md` §2; evaluation reads pipeline output and ground truth separately, after the fact.

## 2. Evaluation Categories

### Extraction accuracy
- **What is measured**: whether entities/events/relationships extracted from evidence (Agent 1 downstream extraction, per `docs/contracts/agent-contracts.md`) match what the evidence actually contains.
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Entity-resolution precision/recall
- **What is measured**: whether the system's entity merges match ground truth's expected entity merges — precision (merges made that shouldn't have been) and recall (merges that should have been made but weren't).
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Relationship extraction accuracy
- **What is measured**: whether extracted/inferred relationships match ground truth relationships, including recovery of the deliberately hidden connection(s) in the synthetic case.
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Graph integrity
- **What is measured**: structural correctness of the synthesized graph — every edge has required provenance and evidence classification; no orphaned or unlabeled edges exist; graph versioning is consistent.
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Analytics reproducibility
- **What is measured**: whether re-running the same analytics against the same graph version produces the same signals (per the reproducibility non-functional requirement, `docs/requirements.md` §6).
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Contradiction detection
- **What is measured**: whether the system detects the contradictions designed into ground truth (recall) without inventing contradictions that don't exist (precision).
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Copilot grounding
- **What is measured**: for each canonical investigative question (`docs/demo/demo-contract.md` §3), whether the Copilot's answer is correct, whether every claim cites supporting evidence, and whether evidence classification (`docs/requirements.md` §7) is applied correctly per claim.
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION`.

### Provenance completeness
- **What is measured**: whether every derived intelligence item (per `docs/requirements.md` §8) carries complete provenance — source, location/reference, method, confidence, processing history, timestamp — with no gaps.
- **Pass threshold**: 100% of derived items must carry complete provenance; this is not a tunable target but a correctness requirement already established in `docs/requirements.md` §8.

### Report generation
- **What is measured**: whether the generated dossier/report labels every claim per evidence classification and whether every claim is traceable back to source evidence.
- **Pass threshold**: 100% of report claims must be classified and traceable; this follows directly from `docs/requirements.md` §7 and §11 and is not a tunable target.

### Latency/throughput (where measurable)
- **What is measured**: end-to-end and per-stage processing time for the canonical case, once an implementation and target hardware exist.
- **Pass threshold**: `TO BE DEFINED BEFORE IMPLEMENTATION` — no numeric target is justified yet, consistent with `docs/requirements.md` §6.

## 3. Threshold Policy

Any category above marked `TO BE DEFINED BEFORE IMPLEMENTATION` must have its threshold set, with rationale, before the corresponding feature is marked "Demo Ready" in `docs/progress/implementation-ledger.md`. Thresholds must not be invented speculatively by this document or by an implementation agent without that rationale being recorded.

## 4. Explicit Non-Goals of This Document

- This document does not implement an evaluator or test harness.
- This document does not choose an evaluation framework or library.
- This document does not set numeric thresholds beyond the two correctness requirements (provenance completeness, report traceability) that are already mandated elsewhere in the project's requirements.
