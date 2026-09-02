import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end entity resolution workflow:
 *
 *   load + extract the investigation (if not already done)
 *   →  Resolve Entities  →  watch the real 8-stage stream
 *   →  wait for genuine completion
 *   →  verify canonical entity counts
 *   →  verify a merged entity's decision chain and provenance are visible
 *   →  verify a non-merge (isolated-mention) case is visible
 *   →  reload — resolved state persists
 *   →  re-run resolution — deterministic/idempotent result
 *
 * No mocked network — the dev server runs the real local resolution path
 * against the same SQLite file as ingestion.spec.ts and
 * investigation-extraction.spec.ts (see global-setup.ts). This file is
 * named to sort alphabetically after investigation-extraction.spec.ts so
 * it runs against an already-extracted investigation in the normal
 * full-suite run; it also ingests/extracts itself first if run in
 * isolation, so it never depends on file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.4/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.4");
const EVIDENCE_DATE = "2026-09-02";

async function captureEvidence(page: Page, kind: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `P5.4_${kind}_${EVIDENCE_DATE}.png`),
    fullPage: true,
  });
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));
  return errors;
}

async function ensureExtracted(page: Page): Promise<void> {
  await page.goto("/");
  const noInvestigation = page.getByTestId("no-investigation");
  if (await noInvestigation.isVisible().catch(() => false)) {
    await page.getByTestId("start-ingestion").click();
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({ timeout: 15_000 });
  }
  const startExtraction = page.getByTestId("start-extraction");
  if (await startExtraction.isVisible().catch(() => false)) {
    await startExtraction.click();
    await expect(page.getByTestId("extraction-complete")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("extraction-complete")).toBeVisible({ timeout: 15_000 });
  }
}

test.describe.serial("entity resolution workflow", () => {
  test("extracted investigation → Resolve Entities → resolution completed with merge/non-merge evidence", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before resolution — extraction done, resolution available
    await ensureExtracted(page);
    const startButton = page.getByTestId("start-resolution");
    await startButton.scrollIntoViewIfNeeded();
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
    await expect(page.getByTestId("resolution-available")).toBeVisible();
    await captureEvidence(page, "screenshot-preresolution");

    // trigger the real resolution
    await startButton.click();

    // B. progress — the real 8-stage list appears the instant resolution
    // starts (a genuine workflow state, not a timed animation)
    await expect(page.getByRole("list", { name: "Resolution stages" })).toBeVisible({
      timeout: 15_000,
    });
    await captureEvidence(page, "screenshot-resolving");

    // C. after resolution — wait for genuine completion
    await expect(page.getByTestId("resolution-complete")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("resolution-complete").scrollIntoViewIfNeeded();

    const personCount = await page.getByTestId("resolution-count-person").textContent();
    expect(Number((personCount ?? "0").replace(/,/g, ""))).toBe(10);
    const phoneCount = await page.getByTestId("resolution-count-phone").textContent();
    expect(Number((phoneCount ?? "0").replace(/,/g, ""))).toBe(14);

    await expect(page.getByTestId("resolution-entities")).toBeVisible();
    await captureEvidence(page, "screenshot-resolved");

    // D. a real non-merge case: expand an isolated, unmerged mention
    // (no corroborating identifier or matching cluster) and verify the
    // resolution type / reasoning is visible, not force-merged into
    // anything else.
    const cards = page.getByTestId("resolved-entity");
    const count = await cards.count();
    let foundNonMerge = false;
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const label = await card.getByTestId("entity-label").textContent();
      if (label?.trim() === "Rahul Mehta") {
        await card.scrollIntoViewIfNeeded();
        await card.getByTestId("entity-toggle").click();
        await expect(card.getByTestId("resolution-decision").first()).toBeVisible({ timeout: 10_000 });
        await expect(card.getByTestId("decision-type")).toContainText("new entity");
        await captureEvidence(page, "screenshot-nonmerge");
        foundNonMerge = true;
        break;
      }
    }
    expect(foundNonMerge, "expected the Rahul Mehta isolated-mention (non-merge) entity to be present").toBe(true);

    // E. a detail view showing a real merge's full evidence/provenance chain.
    let foundMergeDetail = false;
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const label = await card.getByTestId("entity-label").textContent();
      if (label?.trim() === "Kabir Sharma") {
        await card.scrollIntoViewIfNeeded();
        await card.getByTestId("entity-toggle").click();
        await expect(card.getByTestId("resolution-decision").first()).toBeVisible({ timeout: 10_000 });
        await expect(card.getByTestId("entity-aliases")).toContainText("Kabir Sharman");
        await expect(card.getByTestId("decision-source").first()).toContainText("extracted_record_");
        await captureEvidence(page, "screenshot-detail");
        foundMergeDetail = true;
        break;
      }
    }
    expect(foundMergeDetail, "expected the Kabir Sharma merged entity to be present").toBe(true);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the resolved state and re-resolution is idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByTestId("resolution-complete")).toBeVisible();
    await page.getByTestId("resolution-complete").scrollIntoViewIfNeeded();
    const before = await page.getByTestId("resolution-count-person").textContent();

    await page.getByTestId("re-resolve").click();
    await expect(page.getByTestId("resolution-note")).toContainText(/already ran|already present/i, {
      timeout: 30_000,
    });
    const after = await page.getByTestId("resolution-count-person").textContent();
    expect(after).toBe(before);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
