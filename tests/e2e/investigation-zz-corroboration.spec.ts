import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end spatial/temporal corroboration workflow:
 *
 *   load + extract + resolve + synthesize the graph + run analytics (if
 *     not already done)
 *   →  Run Corroboration  →  watch the real 10-stage stream
 *   →  wait for genuine completion
 *   →  navigate to the Corroboration screen (sidebar entry enables live)
 *   →  inspect the entity-pair overlap roll-up
 *   →  inspect spatial findings + a finding's detail + full provenance
 *   →  inspect the temporal timeline
 *   →  inspect the side-by-side contradiction view
 *   →  apply a corroborated-fact / algorithmic-signal filter
 *   →  navigate from Corroboration back to the Graph screen
 *   →  reload — synthesized state persists
 *   →  re-run corroboration — deterministic/idempotent result
 *
 * No mocked network — the dev server runs the real local corroboration
 * path against the same SQLite file as the other e2e specs (see
 * global-setup.ts). Named "investigation-zz-corroboration" so it sorts
 * alphabetically AFTER every other "investigation-*" spec in the
 * shared-DB full-suite run: corroboration is the last implemented
 * pipeline stage and depends on ingestion → extraction → resolution →
 * graph → analytics having all run, and running it early would leave
 * those earlier specs' "before" assertions (e.g. "the Analytics nav
 * entry is still disabled") false. It also ingests/extracts/resolves/
 * synthesizes/analyzes itself first if run in isolation, so it never
 * depends on file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.7/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.7");
const EVIDENCE_DATE = "2026-09-03";

async function captureEvidence(page: Page, kind: string, testId?: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const target = path.join(EVIDENCE_DIR, `P5.7_${kind}_${EVIDENCE_DATE}.png`);
  if (testId) {
    await page.getByTestId(testId).screenshot({ path: target });
  } else {
    await page.screenshot({ path: target, fullPage: true });
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

/**
 * Advances the pipeline through analytics using the authoritative server
 * APIs — the same streaming endpoints the UI buttons drive — so the
 * setup phase never races a panel's own hydration/reconciliation
 * effect. The corroboration workflow itself (Run Corroboration → stages
 * → completion → nav enable → screen) is still exercised entirely
 * through the real UI in the test body.
 */
async function stateOf(page: Page, url: string): Promise<string> {
  const res = await page.request.get(url);
  if (!res.ok()) return "unknown";
  return ((await res.json()) as { status?: string }).status ?? "unknown";
}

/** POST the streaming endpoint, consume it to completion, then poll GET until the stage reports `want`. */
async function advance(page: Page, url: string, want: string, data?: unknown): Promise<void> {
  if ((await stateOf(page, url)) === want) return;
  const res = await page.request.post(url, { ...(data ? { data } : {}), timeout: 90_000 });
  expect(res.ok(), `${url} -> ${res.status()}`).toBeTruthy();
  await res.body();
  await expect
    .poll(() => stateOf(page, url), { timeout: 30_000, intervals: [250, 500, 1000] })
    .toBe(want);
}

async function ensureAnalyticsSynthesized(page: Page): Promise<void> {
  await advance(page, "/api/ingestion", "loaded", { source: { kind: "builtin-corpus" } });
  await advance(page, "/api/extraction", "extracted");
  await advance(page, "/api/resolution", "resolved");
  await advance(page, "/api/graph", "synthesized");
  await advance(page, "/api/analytics", "synthesized");
  await page.goto("/");
  await expect(page.getByTestId("analytics-synthesis-complete")).toBeVisible({ timeout: 15_000 });
}

test.describe.serial("spatial/temporal corroboration workflow", () => {
  test("analytics synthesized → Run Corroboration → pairs, spatial detail + provenance, timeline, contradictions, filtering all work", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before corroboration — analytics synthesized, corroboration available
    await ensureAnalyticsSynthesized(page);
    const startButton = page.getByTestId("start-corroboration-synthesis");
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
    await expect(page.getByTestId("corroboration-available")).toBeVisible();
    await expect(page.getByTestId("nav-corroboration")).toBeDisabled();
    await captureEvidence(page, "screenshot-precorroboration", "corroboration-idle");

    // trigger the real corroboration synthesis
    await startButton.click();

    // B. progress — the real 10-stage list appears the instant synthesis starts
    await expect(page.getByRole("list", { name: "Corroboration stages" })).toBeVisible({ timeout: 15_000 });
    await captureEvidence(page, "screenshot-running");

    // C. after synthesis — wait for genuine completion
    await expect(page.getByTestId("corroboration-synthesis-complete")).toBeVisible({ timeout: 60_000 });
    const corroboratedCount = await page.getByTestId("corroboration-count-corroborated").textContent();
    expect(Number((corroboratedCount ?? "0").replace(/,/g, ""))).toBeGreaterThan(0);
    const contradictionCount = await page.getByTestId("corroboration-count-contradictions").textContent();
    expect(Number((contradictionCount ?? "0").replace(/,/g, ""))).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-completed-summary", "corroboration-summary");

    // D. the sidebar's Corroboration entry enables live, without a page reload
    await expect(page.getByTestId("nav-corroboration")).toBeEnabled();
    await page.getByTestId("nav-corroboration").click();
    await expect(page.getByTestId("corroboration-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("corroboration-overview")).toBeVisible();

    // E. entity-pair overlap roll-up (the default tab) renders real pairs
    await expect(page.getByTestId("corroboration-pairs-list")).toBeVisible();
    const pairRows = page.getByTestId("corroboration-pair-row");
    await expect(pairRows.first()).toBeVisible({ timeout: 10_000 });
    expect(await pairRows.count()).toBeGreaterThan(0);

    // F. spatial findings render, and selecting one shows the detail panel with full provenance
    await page.getByTestId("tab-spatial").click();
    await expect(page.getByTestId("corroboration-findings-list")).toBeVisible();
    const findingRows = page.getByTestId("corroboration-finding-row");
    await expect(findingRows.first()).toBeVisible({ timeout: 10_000 });
    const allSpatialCount = await findingRows.count();
    expect(allSpatialCount).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-spatial");

    await findingRows.first().click();
    await expect(page.getByTestId("corroboration-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("corroboration-detail-classification")).toBeVisible();
    await expect(page.getByTestId("corroboration-detail-provenance")).toBeVisible();
    await expect(page.getByTestId("corroboration-detail-evidence")).toBeVisible();
    await captureEvidence(page, "screenshot-detail-provenance", "corroboration-detail");

    // G. temporal tab renders the deterministic timeline
    await page.getByTestId("tab-temporal").click();
    await expect(page.getByTestId("corroboration-timeline")).toBeVisible({ timeout: 10_000 });
    expect(await page.getByTestId("timeline-lane").count()).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-temporal");

    // H. contradictions tab renders both conflicting placements side by side
    await page.getByTestId("tab-contradictions").click();
    const contradictionCards = page.getByTestId("contradiction-card");
    await expect(contradictionCards.first()).toBeVisible({ timeout: 10_000 });
    expect(await contradictionCards.count()).toBeGreaterThan(0);

    // I. the corroborated-fact / algorithmic-signal filter narrows the result
    await page.getByTestId("tab-spatial").click();
    await expect(findingRows.first()).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("class-filter-algorithmic_signal").click();
    await expect(async () => {
      expect(await findingRows.count()).toBeLessThan(allSpatialCount);
    }).toPass({ timeout: 10_000 });
    await captureEvidence(page, "screenshot-filtered");
    await page.getByTestId("class-filter-all").click();

    // J. navigate from Corroboration back to the Graph screen (cross-navigation)
    await page.getByTestId("class-filter-all").click();
    await findingRows.first().click();
    await expect(page.getByTestId("corroboration-view-in-graph")).toBeVisible({ timeout: 10_000 });
    await page.getByTestId("corroboration-view-in-graph").click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 10_000 });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the synthesized corroboration and re-synthesis is idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByTestId("corroboration-synthesis-complete")).toBeVisible();
    const before = await page.getByTestId("corroboration-count-corroborated").textContent();

    await page.getByTestId("re-synthesize-corroboration").click();
    await expect(page.getByTestId("corroboration-synthesis-note")).toContainText(/already/i, { timeout: 30_000 });
    const after = await page.getByTestId("corroboration-count-corroborated").textContent();
    expect(after).toBe(before);

    // The Corroboration nav entry is also enabled straight from server state on reload.
    await expect(page.getByTestId("nav-corroboration")).toBeEnabled();
    await captureEvidence(page, "screenshot-rerun-idempotency", "corroboration-summary");

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
