import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end Investigation Copilot workflow:
 *
 *   load + extract + resolve + synthesize the graph + analytics +
 *     corroborate (if not already done)
 *   →  the "Ask a Question" nav entry enables
 *   →  the command bar, the case's own eight canonical lines of enquiry,
 *      and the model / prompt / schema identity the answers carry
 *   →  ask one of them  →  watch the real nine-stage stream
 *   →  a grounded answer: classification, confidence, per-claim
 *      classification, the exact cited record ids, the provenance /
 *      derivation panel
 *   →  cross-navigate into the Graph screen from a citation
 *   →  an ambiguous reference is reported as ambiguous, not guessed
 *   →  an entity the case does not contain returns insufficient
 *      evidence, not an invented answer
 *   →  contradictions are reported with both sources and resolved by
 *      nobody
 *   →  three canonical questions in one session, each classified on its
 *      own evidence (this is the recorded Q&A session the milestone asks
 *      for under CAPTURE_EVIDENCE)
 *   →  the same question twice yields the same answer
 *   →  an invalid question is refused with a structured, user-safe error
 *
 * No mocked network — the dev server runs the real local Copilot path
 * against the same SQLite file as the other e2e specs (see
 * playwright.config.ts). No AI_PROVIDER_API_KEY is configured in the e2e
 * environment, so the run also proves the documented degraded path: the
 * grounding is unchanged and only the wording falls back to the
 * deterministic narration, disclosed in the UI.
 *
 * Named "investigation-zzz-copilot" so it sorts alphabetically AFTER
 * every other "investigation-*" spec (including
 * investigation-zz-corroboration and investigation-zzz-dossier) in the
 * shared-DB full-suite run: the Copilot grounds on every earlier stage.
 * It also advances the pipeline itself if run in isolation, so it never
 * depends on file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.8/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.8");
const EVIDENCE_DATE = "2026-09-03";

const AMBIGUOUS_QUESTION = "What do we know about account 000001?";
const UNKNOWN_ENTITY_QUESTION = "What is the relationship between Sanjay Gupta and Priya Desai?";
const CONTRADICTION_QUESTION = "Are there any contradictions between witness statements in this case?";

/**
 * `testId` captures that element alone (right for a panel that fits on
 * screen); `scrollTo` brings that element into view and captures the
 * VIEWPORT instead — the workspace scrolls inside its own container, so
 * a full-page capture of a long answer would photograph the top of the
 * page rather than the part being evidenced.
 */
async function captureEvidence(
  page: Page,
  kind: string,
  target?: { testId: string } | { scrollTo: string },
): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const file = path.join(EVIDENCE_DIR, `P5.8_${kind}_${EVIDENCE_DATE}.png`);
  if (target && "scrollTo" in target) {
    await page.getByTestId(target.scrollTo).first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: file });
  } else if (target) {
    await page.getByTestId(target.testId).screenshot({ path: file });
  } else {
    await page.screenshot({ path: file, fullPage: true });
  }
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function stateOf(page: Page, url: string): Promise<string> {
  const res = await page.request.get(url);
  if (!res.ok()) return "unknown";
  return ((await res.json()) as { status?: string }).status ?? "unknown";
}

/** POST the streaming endpoint, consume it to completion, then poll GET until the stage reports `want`. */
async function advance(page: Page, url: string, want: string, data?: unknown): Promise<void> {
  if ((await stateOf(page, url)) === want) return;
  const res = await page.request.post(url, { ...(data ? { data } : {}), timeout: 120_000 });
  expect(res.ok(), `${url} -> ${res.status()}`).toBeTruthy();
  await res.body();
  await expect
    .poll(() => stateOf(page, url), { timeout: 60_000, intervals: [250, 500, 1000] })
    .toBe(want);
}

/**
 * Advances the pipeline through corroboration using the authoritative
 * server APIs — the same streaming endpoints the UI buttons drive — so
 * the setup phase never races a panel's own hydration/reconciliation
 * effect. The Copilot workflow itself (nav enable → command bar → ask →
 * stages → answer) is still exercised entirely through the real UI.
 */
async function ensureCorroborationSynthesized(page: Page): Promise<void> {
  await advance(page, "/api/ingestion", "loaded", { source: { kind: "builtin-corpus" } });
  await advance(page, "/api/extraction", "extracted");
  await advance(page, "/api/resolution", "resolved");
  await advance(page, "/api/graph", "synthesized");
  await advance(page, "/api/analytics", "synthesized");
  await advance(page, "/api/corroboration", "synthesized");
  await page.goto("/");
  await expect(page.getByTestId("corroboration-synthesis-complete")).toBeVisible({ timeout: 20_000 });
}

/** Opens the Copilot screen from the sidebar and waits for the command bar. */
async function openCopilot(page: Page): Promise<void> {
  await expect(page.getByTestId("nav-copilot")).toBeEnabled();
  await page.getByTestId("nav-copilot").click();
  await expect(page.getByTestId("copilot-screen")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("copilot-input")).toBeVisible();
}

/**
 * Types a question into the command bar and waits for the answer to
 * THIS question — matching on the rendered question text rather than
 * the answer card alone, so a previous answer still on screen can never
 * be mistaken for the new one.
 */
async function ask(page: Page, question: string): Promise<void> {
  await page.getByTestId("copilot-input").fill(question);
  await page.getByTestId("copilot-ask").click();
  await expect(page.getByTestId("copilot-answer")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId("copilot-question")).toHaveText(question, { timeout: 60_000 });
}

test.describe.serial("investigation copilot workflow", () => {
  test("corroboration complete → ask a canonical question → cited, classified answer with provenance and cross-navigation", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before the Copilot — every upstream stage has run, so the
    //    "Ask a Question" entry is live (it is disabled until then).
    await ensureCorroborationSynthesized(page);
    await openCopilot(page);
    await expect(page.getByTestId("copilot-idle")).toBeVisible();

    // The case's own canonical lines of enquiry, bound from persisted data.
    const suggestions = page.getByTestId("copilot-suggestion");
    await expect(suggestions.first()).toBeVisible();
    expect(await suggestions.count()).toBe(8);
    // The three placeholder-bearing questions carry real entity names.
    for (const id of ["q2", "q3", "q7"]) {
      const text = await page.locator(`[data-suggestion-id="${id}"]`).innerText();
      expect(text, id).not.toContain("[");
      expect(text, id).toMatch(/[A-Z][a-z]+ [A-Z][a-z]+/);
    }
    // No AI key is configured in the e2e environment — the UI says so
    // rather than silently degrading.
    await expect(page.getByTestId("copilot-model-configured")).toContainText(/deterministic narration/i);
    await captureEvidence(page, "screenshot-initial", { testId: "copilot-screen" });

    // B. ask the first canonical question through the real command bar
    await suggestions.first().click();

    // The nine-stage list appears the instant the stream opens.
    await expect(page.getByRole("list", { name: "Copilot stages" })).toBeVisible({ timeout: 15_000 });

    // C. a grounded answer, in the order the milestone fixes
    await expect(page.getByTestId("copilot-answer")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("copilot-question")).not.toBeEmpty();
    await expect(page.getByTestId("copilot-answer-text")).not.toBeEmpty();
    await expect(page.getByTestId("copilot-classification")).toBeVisible();
    await expect(page.getByTestId("copilot-confidence")).toContainText(/confidence \d\.\d\d/);
    await expect(page.getByTestId("copilot-grounding")).toBeVisible();
    // The model is unavailable, so the wording — and only the wording — degrades.
    await expect(page.getByTestId("copilot-derivation")).toContainText(/deterministic/i);
    await expect(page.getByTestId("copilot-model-notice")).toBeVisible();

    // Every one of the nine stages reported a real, non-failed status.
    const stageItems = page.getByRole("list", { name: "Copilot stages" }).first().getByRole("listitem");
    expect(await stageItems.count()).toBe(9);
    expect(await page.getByTestId("copilot-completed-stages").locator('[data-status="failed"]').count()).toBe(0);
    await captureEvidence(page, "screenshot-answer", { scrollTo: "copilot-classification" });
    await captureEvidence(page, "screenshot-stages", { scrollTo: "copilot-completed-stages" });

    // D. supporting evidence — each claim carries its OWN classification,
    //    and expands to the exact persisted record ids it rests on.
    await expect(page.getByTestId("copilot-claims")).toBeVisible();
    const claims = page.getByTestId("copilot-claim");
    expect(await claims.count()).toBeGreaterThan(0);
    await page.getByTestId("copilot-claim-toggle").first().click();
    await expect(page.getByTestId("copilot-claim-detail").first()).toBeVisible();
    await expect(page.getByTestId("copilot-claim-citations").first()).toBeVisible();
    await expect(page.getByTestId("copilot-claim-citations").first()).not.toBeEmpty();
    await captureEvidence(page, "screenshot-citations", { scrollTo: "copilot-claim-detail" });

    // E. provenance / derivation — model, prompt version, schema version,
    //    cache outcome and the processing history behind the answer.
    await page.getByTestId("copilot-provenance-toggle").click();
    const provenance = page.getByTestId("copilot-provenance-detail");
    await expect(provenance).toBeVisible();
    await expect(provenance).toContainText("prompt version");
    await expect(provenance).toContainText("schema version");
    await expect(provenance).toContainText("history");
    await captureEvidence(page, "screenshot-provenance", { testId: "copilot-provenance" });

    // F. cross-navigation — a citation routes into the Graph screen,
    //    focused on the entity the answer was actually about.
    await expect(page.getByTestId("copilot-related")).toBeVisible();
    await page.getByTestId("copilot-view-in-graph").click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 10_000 });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("ambiguity, insufficient evidence and contradictions are surfaced rather than guessed, resolved or invented", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await openCopilot(page);

    // A. an identifier matching more than one entity is reported as
    //    ambiguous, with the candidates — never silently picked.
    await ask(page, AMBIGUOUS_QUESTION);
    await expect(page.getByTestId("copilot-ambiguity")).toBeVisible();
    expect(await page.getByTestId("copilot-ambiguity-candidate").count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId("copilot-claims")).toHaveCount(0);
    await captureEvidence(page, "screenshot-ambiguity", { testId: "copilot-answer" });

    // B. a person the case does not contain yields insufficient
    //    evidence, naming the unmatched reference back to the user.
    await ask(page, UNKNOWN_ENTITY_QUESTION);
    await expect(page.getByTestId("copilot-insufficient")).toBeVisible();
    await expect(page.getByTestId("copilot-answer-text")).toContainText("Insufficient evidence");
    await expect(page.getByTestId("copilot-answer-text")).toContainText("Sanjay Gupta");
    await expect(page.getByTestId("copilot-claims")).toHaveCount(0);
    await captureEvidence(page, "screenshot-insufficient", { testId: "copilot-answer" });

    // C. contradictions are reported with both sources and resolved by
    //    nobody.
    await ask(page, CONTRADICTION_QUESTION);
    await expect(page.getByTestId("copilot-conflicts")).toBeVisible();
    await expect(page.getByTestId("copilot-conflicts")).toContainText(/never resolved/i);
    await expect(page.getByTestId("copilot-answer-text")).toContainText("not resolved");
    await captureEvidence(page, "screenshot-contradiction", { scrollTo: "copilot-conflicts" });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  /**
   * One session, three of the case's own canonical lines of enquiry —
   * a suspects question, a spatial/temporal one, and a structural one —
   * so an answer is proven to be replaced cleanly by the next and each
   * question is labelled on its own evidence rather than inheriting the
   * previous answer's classification. Under CAPTURE_EVIDENCE this is
   * also the recorded live Q&A session the milestone asks for.
   */
  test("answers three canonical lines of enquiry in one session, each classified on its own evidence", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await openCopilot(page);

    const seen: string[] = [];
    for (const index of [0, 3, 5]) {
      const question = (await page.getByTestId("copilot-suggestion").nth(index).innerText()).split("\n")[0] ?? "";
      expect(question.length).toBeGreaterThan(0);
      await page.getByTestId("copilot-suggestion").nth(index).click();
      await expect(page.getByTestId("copilot-answer")).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId("copilot-question")).toHaveText(question, { timeout: 60_000 });

      // Answered on its own evidence: claims, citations, a classification.
      expect(await page.getByTestId("copilot-claim").count(), question).toBeGreaterThan(0);
      await expect(page.getByTestId("copilot-classification")).toBeVisible();
      await expect(page.getByTestId("copilot-confidence")).toContainText(/confidence \d\.\d\d/);
      seen.push(await page.getByTestId("copilot-classification").innerText());
      await captureEvidence(page, `screenshot-session-${index}`, { scrollTo: "copilot-classification" });

      // The previous answer is gone, not appended to.
      expect(await page.getByTestId("copilot-answer").count()).toBe(1);
    }

    // These three questions rest on different kinds of record, so they
    // must not all carry the same label.
    expect(new Set(seen).size).toBeGreaterThan(1);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the Copilot available, the same question answers identically, and an invalid question is refused safely", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // The Copilot entry is enabled straight from server state on reload.
    await page.goto("/");
    await openCopilot(page);

    // The same question, asked again in a fresh page session — same
    // grounded answer, same claims, same classification.
    await ask(page, CONTRADICTION_QUESTION);
    const first = await page.getByTestId("copilot-answer-text").innerText();
    const firstClaims = await page.getByTestId("copilot-claim").allInnerTexts();
    const firstClassification = await page.getByTestId("copilot-classification").innerText();

    await page.goto("/");
    await openCopilot(page);
    await ask(page, CONTRADICTION_QUESTION);
    expect(await page.getByTestId("copilot-answer-text").innerText()).toBe(first);
    expect(await page.getByTestId("copilot-claim").allInnerTexts()).toEqual(firstClaims);
    expect(await page.getByTestId("copilot-classification").innerText()).toBe(firstClassification);

    // An over-long question is refused at the contract boundary with a
    // structured, user-safe error — no answer, no stack trace, no
    // filesystem path, no provider error text.
    const res = await page.request.post("/api/copilot", { data: { question: "x".repeat(501) } });
    expect(res.ok()).toBeTruthy();
    const lines = (await res.text()).trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1] as string) as {
      type: string;
      result: { status: string; response: unknown; error?: { code?: string; message?: string } };
    };
    expect(last.type).toBe("result");
    expect(last.result.status).toBe("failed");
    expect(last.result.response).toBeNull();
    expect(last.result.error?.code).toBe("INVALID_QUESTION");
    expect(last.result.error?.message ?? "").not.toMatch(/\/(Users|home|root|var|tmp|private)\//);
    expect(last.result.error?.message ?? "").not.toMatch(/\.[cm]?tsx?:\d+/);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
