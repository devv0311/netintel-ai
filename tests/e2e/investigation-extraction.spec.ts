import { test, expect, type Locator, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end evidence extraction workflow:
 *
 *   load the investigation (ingest first if not already loaded)
 *   →  Extract Evidence  →  watch the real 7-stage stream
 *   →  wait for genuine completion
 *   →  verify extracted-record counts and representative facts
 *   →  verify provenance/source references are visible
 *   →  reload — extracted state persists
 *   →  re-run extraction — deterministic/idempotent result
 *
 * No mocked network — the dev server runs the real local extraction path
 * against the same SQLite file as tests/e2e/ingestion.spec.ts (see
 * global-setup.ts). This file is named to sort alphabetically after
 * ingestion.spec.ts so it runs against an already-ingested investigation
 * in the normal full-suite run; it also ingests itself first if run in
 * isolation, so it never depends on file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.3/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.3");
const EVIDENCE_DATE = "2026-09-02";

async function captureEvidence(page: Page, kind: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `P5.3_${kind}_${EVIDENCE_DATE}.png`),
    fullPage: true,
  });
}

/**
 * Scrolls a below-the-fold element into view and captures the current
 * viewport (not a tall element screenshot, which stitches multiple
 * scroll positions and visibly duplicates the page's flex header). The
 * workspace scrolls inside <main>, not the document body, so a fullPage
 * page screenshot never reaches content below the fold on its own.
 */
async function captureScrolledEvidence(page: Page, locator: Locator, kind: string): Promise<void> {
  if (!CAPTURE) return;
  await locator.scrollIntoViewIfNeeded();
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: path.join(EVIDENCE_DIR, `P5.3_${kind}_${EVIDENCE_DATE}.png`) });
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function ensureInvestigationLoaded(page: Page): Promise<void> {
  await page.goto("/");
  const noInvestigation = page.getByTestId("no-investigation");
  if (await noInvestigation.isVisible().catch(() => false)) {
    await page.getByTestId("start-ingestion").click();
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({ timeout: 15_000 });
  }
}

test.describe.serial("evidence extraction workflow", () => {
  test("loaded investigation → Extract Evidence → extraction completed with representative facts", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before extraction — investigation loaded, extraction available
    await ensureInvestigationLoaded(page);
    const startButton = page.getByTestId("start-extraction");
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
    await expect(page.getByTestId("extraction-available")).toBeVisible();
    await captureEvidence(page, "screenshot-preextraction");

    // trigger the real extraction
    await startButton.click();

    // B. progress — the real 7-stage list appears the instant extraction
    // starts (a genuine workflow state, not a timed animation)
    await expect(page.getByRole("list", { name: "Extraction stages" })).toBeVisible({
      timeout: 15_000,
    });
    await captureEvidence(page, "screenshot-extracting");

    // C. after extraction — wait for genuine completion
    await expect(page.getByTestId("extraction-complete")).toBeVisible({ timeout: 60_000 });

    // deterministic extracted-record counts
    const entityCount = await page
      .getByTestId("extraction-count-entity_mention")
      .textContent();
    expect(Number((entityCount ?? "0").replace(/,/g, ""))).toBeGreaterThan(0);
    const eventCount = await page.getByTestId("extraction-count-event_mention").textContent();
    expect(Number((eventCount ?? "0").replace(/,/g, ""))).toBe(1150 + 560 + 4);

    // D. representative extracted facts, with source/provenance visible
    await expect(page.getByTestId("extraction-facts")).toBeVisible();
    const facts = page.getByTestId("extracted-fact");
    await expect(facts.first()).toBeVisible();
    expect(await facts.count()).toBeGreaterThan(0);

    const firstFact = facts.first();
    await expect(firstFact.getByTestId("fact-classification")).toHaveText(/observed fact/i);
    await expect(firstFact.getByTestId("fact-source")).toBeVisible();
    await expect(firstFact.getByTestId("fact-observed-value")).toBeVisible();
    // The source reference cites a concrete evidence item field, e.g.
    // "suspect:S1#name" or "fir:001#accused[0]" — never a bare id.
    await expect(firstFact.getByTestId("fact-source")).toContainText("#");

    await captureEvidence(page, "screenshot-extracted");
    await captureScrolledEvidence(page, page.getByTestId("extraction-facts"), "screenshot-facts");

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the extracted state and re-extraction is idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByTestId("extraction-complete")).toBeVisible();
    const beforeCount = await page
      .getByTestId("extraction-count-entity_mention")
      .textContent();

    await page.getByTestId("re-extract").click();
    await expect(page.getByTestId("extraction-note")).toContainText(
      /already ran|already present/i,
      { timeout: 30_000 },
    );
    const afterCount = await page.getByTestId("extraction-count-entity_mention").textContent();
    expect(afterCount).toBe(beforeCount);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
