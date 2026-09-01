# End-to-End Demo Contract

**Status**: Specification only. This document defines the minimum winning demonstration and its observable success criteria. **The Copilot, and the rest of the pipeline, are not implemented by this document.**

## 1. What the Demo Must Prove

The demo must prove that **one synthetic case — Operation DarkNet Delhi (`docs/data/synthetic-investigation-spec.md`) — can travel through the full pipeline** and produce a defensible, source-traceable result:

```text
Evidence
  → intelligence extraction
  → identity resolution
  → relationship graph
  → analytical signals
  → temporal/spatial corroboration
  → grounded Copilot
  → investigation dossier/report
```

This is the "minimum winning demonstration": the smallest scope that still exercises every stage of the core user journey (`docs/requirements.md` §4) against a single coherent case, end to end, with real (not fabricated) visual evidence at each stage per `docs/progress/visual-evidence-convention.md`.

## 2. Observable Success Criteria Per Stage

| Stage | Observable success criterion |
| --- | --- |
| Evidence upload / ingestion | All Operation DarkNet Delhi evidence items (5 FIRs, CDRs, transactions, statements, etc.) are accepted and normalized; any rejected item shows a specific reason. |
| Intelligence extraction | Structured entities/events/relationships are extracted from every evidence item, each traceable to its source location within that item. |
| Identity resolution | The 8 primary suspects and their aliases resolve correctly to stable entities, matching ground truth (`docs/data/ground-truth-spec.md`) entity merges; ambiguous mentions are surfaced, not silently guessed. |
| Relationship graph | A connected graph exists containing the designed relationships, including the deliberately hidden connection(s) from the synthetic spec, each edge carrying evidence references. |
| Analytical signals | Network analytics (centrality, community, path) run against the graph and surface the entities/communities expected by ground truth, each with an explanation. |
| Temporal/spatial corroboration | The designed temporal correlations and known contradictions are detected and reported, each with cited evidence. |
| Grounded Copilot | The canonical investigative questions (§3) are answered correctly and are grounded, per the Copilot contract (`docs/contracts/agent-contracts.md`, Agent 6). |
| Investigation dossier/report | A report is generated summarizing the case, with every claim labeled per evidence classification (`docs/requirements.md` §7) and traceable to source. |

A stage is considered demonstrated only when its observable success criterion is met **and** it has real visual evidence per `docs/progress/visual-evidence-convention.md` — no criterion may be claimed met from code review alone.

## 3. Canonical Investigative Questions

The following questions form the fixed set the eventual Copilot must be able to answer against Operation DarkNet Delhi, once implemented. Each question's correct answer (or correct "insufficient evidence" response) is defined in ground truth (`docs/data/ground-truth-spec.md` §3 "Expected Copilot answers") — this document does not itself state the answers, only the question set the demo commits to.

1. Who are the primary suspects in this case, and what aliases do they use?
2. What direct relationships exist between [suspect A] and [suspect B]? *(the specific pair is fixed once the case is generated, chosen to require graph traversal rather than a single-document lookup)*
3. Is there a financial connection between [suspect A] and [suspect C], and if so, what is the transaction path?
4. Are there any suspects whose phone activity places them at the same location at the same time as a crime event?
5. Are there any contradictions between witness statements regarding [a specific crime event]?
6. Which entity in this case has the most significant structural role in the network, and why?
7. Is there evidence connecting [an intermediary actor] to more than one principal suspect, and what is that evidence?
8. Summarize the case: what has been corroborated, what remains only an inference or lead?

Questions 2, 3, and 7 have their specific entity placeholders fixed once Operation DarkNet Delhi is generated (`docs/data/synthetic-investigation-spec.md`), since they must reference the case's actual designed suspects and intermediary. No other questions may be substituted without updating both this document and the ground-truth spec.

## 4. Explicit Non-Goals of This Document

- This document does not implement the Copilot or any pipeline stage.
- This document does not generate Operation DarkNet Delhi's data.
- This document does not define UI/presentation technology for the demo — see `docs/demo/README.md` for that boundary.
- This document does not define pass/fail evaluation metrics — see `docs/evaluation/evaluation-spec.md`.
