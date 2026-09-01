# Synthetic Investigation Specification — Operation DarkNet Delhi

**Status**: Specification only. This document defines what the eventual synthetic data generator must produce. **No synthetic data has been generated yet.** Generation is a separate, later phase.

This is the canonical demonstration case for NetIntel AI. All demo materials, ground truth, and evaluation reference this same case by name: **Operation DarkNet Delhi**. It is entirely fictional; see the synthetic-only rule in `docs/requirements.md` §9 and §10.

## 1. Purpose of This Case

Operation DarkNet Delhi must be designed to exercise every stage of the core user journey (`docs/requirements.md` §4) and every functional requirement (§5): ingestion of heterogeneous evidence, extraction, entity resolution across ambiguous identities, relationship/graph synthesis, network analytics, spatial/temporal corroboration, grounded Copilot Q&A, and report generation. The case must not be trivially resolvable by inspection — it must require the pipeline's capabilities to unravel.

## 2. Required Entity/Data Categories

The eventual generator must produce synthetic instances of each of the following categories, all internally consistent with each other (e.g. a phone number appearing in a CDR must also appear correctly on the suspect entity that owns it, where the case design intends that link to be discoverable):

- FIRs (First Information Reports)
- Suspects
- Aliases
- Phones
- IMEIs
- Vehicles
- Bank accounts
- Locations
- CDR (Call Detail Record) events
- Financial transactions
- Witness statements
- Crime events

## 3. Required Volumes

The following volumes are carried over from the authoritative project requirements and must be preserved by the eventual generator:

| Category | Required volume |
| --- | --- |
| FIR documents | 5 |
| Primary suspects | 8 |
| Synthetic CDR records | 1,000+ |
| Synthetic financial transactions | 500+ |

No other numeric volume is prescribed at this stage; additional categories (aliases, vehicles, bank accounts, locations, witness statements, crime events) must be generated in whatever quantity is necessary to support the structural requirements in §4, and that quantity is left to the generation phase to determine and document.

## 4. Required Structural Properties of the Synthetic Universe

The generator must intentionally construct the case so that it contains, at minimum:

- **Aliases** — suspects and other entities referred to by more than one name/identifier across evidence.
- **Duplicate/ambiguous identities** — mentions that superficially look like different entities but must be resolved to the same one, and/or mentions that look similar but are genuinely different entities (to test against over-merging).
- **Conflicting statements** — witness statements or records that contradict one another, requiring contradiction detection rather than silent resolution.
- **Indirect relationships** — connections between entities that are not stated explicitly anywhere but are only discoverable through graph traversal or correlation (e.g. shared intermediary, shared account).
- **Temporal correlations** — event timing that corroborates or contradicts claims when analyzed (e.g. two suspects' phones active in the same cell tower window).
- **Intermediary actors** — entities whose primary narrative role is to connect otherwise-unconnected principal suspects.
- **Money-mule patterns** — financial transaction chains where funds move through intermediate accounts to obscure origin/destination, discoverable through transaction-path analysis.
- **Misleading low-value relationships** — connections that exist in the data but are not materially relevant to the case (noise), to test that analytics and the Copilot do not over-weight incidental connections.
- **Known hidden relationships** — at least one relationship that is deliberately not stated anywhere explicitly and is only recoverable by combining multiple evidence types/stages, forming the basis of the "hero" finding the demo is built to surface.

## 5. Internal Consistency Requirement

Every synthetic entity must have a **stable synthetic identity** (per `docs/requirements.md` §9): a consistent identifier and attribute set that does not change across regenerations of the canonical dataset. This is required so that:

- ground truth (`docs/data/ground-truth-spec.md`) remains valid against the dataset it was written for;
- evaluation results are comparable across implementation iterations;
- the demo (`docs/demo/demo-contract.md`) is repeatable.

## 6. Explicit Non-Goals of This Document

- This document does not generate any data.
- This document does not choose a data format, storage technology, or generation tool.
- This document does not fabricate any resemblance to a real case, real FIR numbers, real locations tied to real incidents, real phone number ranges, or real financial identifiers — the eventual generator must ensure fictional entities are clearly non-real (see `docs/requirements.md` §10).

## 7. Downstream Consumers of This Spec

- `docs/data/ground-truth-spec.md` defines the expected-correct answers this case must support once generated.
- `docs/demo/demo-contract.md` defines the canonical investigative questions the Copilot must be able to answer against this case.
- `docs/evaluation/evaluation-spec.md` defines how system output will be measured against this case's ground truth.
