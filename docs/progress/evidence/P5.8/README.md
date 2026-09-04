# P5.8 — Investigation Copilot: visual evidence

Evidence for ledger row **P5.8**, per [`docs/progress/visual-evidence-convention.md`](../../visual-evidence-convention.md).

| Field | Value |
| --- | --- |
| **Ledger ID** | P5.8 |
| **Implementation status at capture** | Completed |
| **Associated Git commit** | The P5.8 verification commit (`test(P5.8): complete Investigation Copilot verification`). |
| **Capture date** | 2026-09-03 |
| **Captured by** | `tests/e2e/investigation-zzz-copilot.spec.ts`, run with `CAPTURE_EVIDENCE=1 npx playwright test tests/e2e/investigation-zzz-copilot.spec.ts` |
| **Application state** | The real app (`next dev`) against `./data/cipher-e2e.db`, the full Operation DarkNet Delhi corpus ingested → extracted → resolved → graph-synthesized → analyzed → corroborated, then questions asked through the real command bar. No mocking, no fixtures, no stubbed network. |
| **AI provider key** | Not configured. Every artifact below therefore shows the no-key path: deterministic Copilot narration, explicitly labelled in the UI. The grounding, citations, classifications and confidences are identical to the with-model path. |

Every artifact is a real capture of the running system. Nothing here is a mock, a placeholder, or a design comp.

## Artifacts

| File | What it shows |
| --- | --- |
| `P5.8_screenshot-initial_…png` | The Copilot screen once corroboration is complete: the eight canonical lines of enquiry bound from persisted data (q2 / q3 / q7 carrying real entity names, no `[placeholder]`), and the "No AI provider key configured — answers use the deterministic narration" notice. |
| `P5.8_screenshot-answer_…png` | A grounded answer to the suspects question: **Observed Fact**, fully grounded, confidence 0.95, "deterministic wording", "cache bypass", the "AI narration unavailable" panel, and the supporting-evidence list where every claim carries its own classification badge. |
| `P5.8_screenshot-stages_…png` | The real nine-stage stream from `POST /api/copilot`, each stage advancing only when the server reports it — not a timed animation. |
| `P5.8_screenshot-citations_…png` | A claim expanded to its own classification, confidence, explanation, and the exact persisted record ids it cites. |
| `P5.8_screenshot-provenance_…png` | The provenance / derivation panel: model, prompt version (`copilot.system.v1`), schema version (`copilot.answer.v1`), cache outcome, graph version, and the processing history behind the answer. |
| `P5.8_screenshot-ambiguity_…png` | "What do we know about account 000001?" — the identifier tail matches three accounts, so the Copilot lists all three candidates and composes **no** answer. Classified Investigative Lead, confidence 0.00. |
| `P5.8_screenshot-insufficient_…png` | A question about a person the case does not contain — **Insufficient evidence**, naming the unmatched reference back to the user, zero claims. |
| `P5.8_screenshot-contradiction_…png` | A contradictions question — the unresolved conflicts panel, both sources cited, "reported, never resolved". |
| `P5.8_screenshot-session-0_…png`, `…-session-3_…png`, `…-session-5_…png` | Three canonical lines of enquiry asked in one session (a suspects question, a spatial/temporal one, a structural one), each answered on its own evidence with its own classification — proof that an answer is replaced cleanly and not appended, and that classification is per-question, not inherited. Together these are the recorded Q&A session the milestone asks for. |

## Known gap

No interaction **recording** (`mp4` / `gif`) is included. Playwright
records `webm`, the convention specifies `mp4`/`gif`, and no `ffmpeg` is
available on this machine to convert. The multi-question session is
instead evidenced by the ordered `session-*` stills above, and the flow
itself — nav enable → command bar → stream → grounded answer, three
times in one session — is asserted end to end in the spec. The G3
multi-turn follow-up recording is not applicable: G3 is not implemented
(see `docs/data/copilot.md` §16).
