import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end evidence ingestion workflow:
 *
 *   open the app  →  see the empty workspace
 *   →  Start ingestion  →  watch the real stage stream
 *   →  wait for actual completion
 *   →  verify the loaded investigation summary and deterministic counts
 *   →  reload / re-run: state persists and re-ingestion is idempotent
 *
 * No mocked network — the dev server runs the real local ingestion path
 * against a wiped SQLite file (see tests/e2e/global-setup.ts).
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.2/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.2");
const EVIDENCE_DATE = "2026-09-02";

async function captureEvidence(page: Page, kind: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `P5.2_${kind}_${EVIDENCE_DATE}.png`),
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

test.describe.serial("evidence ingestion workflow", () => {
  test("empty workspace → ingest the synthetic corpus → investigation loaded", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");

    // A. before ingestion — the empty workspace
    await expect(page.getByTestId("no-investigation")).toBeVisible();
    await expect(
      page.getByText("Synthetic data only", { exact: false }).first(),
    ).toBeVisible();
    const startButton = page.getByTestId("start-ingestion");
    await expect(startButton).toBeEnabled();
    await captureEvidence(page, "screenshot-empty");

    // trigger the real ingestion
    await startButton.click();

    // C. progress — the real stage list appears the instant ingestion
    // starts (this is a genuine workflow state, not a timed animation)
    await expect(page.getByRole("list", { name: "Ingestion stages" })).toBeVisible({
      timeout: 15_000,
    });
    await captureEvidence(page, "screenshot-progress");

    // B. after ingestion — wait for genuine completion
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({
      timeout: 60_000,
    });

    // deterministic evidence summary
    await expect(page.getByTestId("count-evidenceSources")).toHaveText("6");
    await expect(page.getByTestId("count-evidenceItems")).toHaveText("1,820");
    await expect(page.getByTestId("count-communications")).toHaveText("1,150");
    await expect(page.getByTestId("count-financialTransactions")).toHaveText("560");
    await expect(page.getByTestId("count-locations")).toHaveText("14");
    await expect(page.getByTestId("count-type-fir")).toHaveText("5");
    await expect(page.getByTestId("count-type-cdr_event")).toHaveText("1,150");

    // the pipeline strip reflects the two really-complete stages
    await expect(
      page.getByLabel("Investigation pipeline status").getByText("Ingestion"),
    ).toBeVisible();

    await captureEvidence(page, "screenshot-loaded");

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the investigation loaded and re-ingestion is idempotent", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByTestId("investigation-loaded")).toBeVisible();
    await expect(page.getByTestId("count-evidenceItems")).toHaveText("1,820");

    await page.getByTestId("reingest").click();
    await expect(page.getByTestId("ingest-note")).toContainText("already ingested", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("count-evidenceItems")).toHaveText("1,820");
    await expect(page.getByTestId("count-communications")).toHaveText("1,150");

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
