import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end graph synthesis workflow:
 *
 *   load + extract + resolve the investigation (if not already done)
 *   →  Synthesize Graph  →  watch the real 10-stage stream
 *   →  wait for genuine completion
 *   →  navigate to the Graph screen (sidebar entry enables live)
 *   →  select a high-value entity and inspect its neighborhood
 *   →  inspect a relationship and its source-evidence trail
 *   →  apply a filter / focus view
 *   →  reload — synthesized state persists
 *   →  re-run graph synthesis — deterministic/idempotent result
 *
 * No mocked network — the dev server runs the real local graph
 * synthesis path against the same SQLite file as the other e2e specs
 * (see global-setup.ts). Named "investigation-synthesis" (not
 * "investigation-graph") so it sorts alphabetically AFTER
 * investigation-resolution.spec.ts (graph synthesis depends on
 * resolution having already run) and still before shell.spec.ts in the
 * shared-DB full-suite run; it also ingests/extracts/resolves itself
 * first if run in isolation, so it never depends on file execution
 * order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.5/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.5");
const EVIDENCE_DATE = "2026-09-02";

async function captureEvidence(page: Page, kind: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `P5.5_${kind}_${EVIDENCE_DATE}.png`),
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

/**
 * Determines what's already done via the authoritative server APIs
 * (never by reading transient DOM state) before deciding which UI
 * actions to drive — a component's client-rendered "idle" phase can
 * briefly precede its own reconciliation effect flipping to "done" even
 * when the server already has the real state, and branching on that
 * transient DOM readout races the effect that removes it (Playwright's
 * "element was detached from the DOM" failure). Querying the same
 * *-summary/state endpoints the UI itself reconciles against sidesteps
 * that hydration timing entirely.
 */
async function ensureResolved(page: Page): Promise<void> {
  await page.goto("/");

  const ingestionState = await (await page.request.get("/api/ingestion")).json();
  if (ingestionState.status !== "loaded") {
    await page.getByTestId("start-ingestion").click();
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("investigation-loaded")).toBeVisible({ timeout: 15_000 });
  }

  const extractionState = await (await page.request.get("/api/extraction")).json();
  if (extractionState.status !== "extracted") {
    await page.getByTestId("start-extraction").click();
    await expect(page.getByTestId("extraction-complete")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("extraction-complete")).toBeVisible({ timeout: 15_000 });
  }

  const resolutionState = await (await page.request.get("/api/resolution")).json();
  if (resolutionState.status !== "resolved") {
    await page.getByTestId("start-resolution").click();
    await expect(page.getByTestId("resolution-complete")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("resolution-complete")).toBeVisible({ timeout: 15_000 });
  }
}

test.describe.serial("graph synthesis workflow", () => {
  test("resolved investigation → Synthesize Graph → graph rendered with node/edge selection and evidence trace", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before graph synthesis — resolution done, synthesis available
    await ensureResolved(page);
    const startButton = page.getByTestId("start-graph-synthesis");
    await startButton.scrollIntoViewIfNeeded();
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
    await expect(page.getByTestId("graph-synthesis-available")).toBeVisible();
    await expect(page.getByTestId("nav-graph")).toBeDisabled();
    await captureEvidence(page, "screenshot-pregraph");

    // trigger the real graph synthesis
    await startButton.click();

    // B. progress — the real 10-stage list appears the instant synthesis
    // starts (a genuine workflow state, not a timed animation)
    await expect(page.getByRole("list", { name: "Graph synthesis stages" })).toBeVisible({
      timeout: 15_000,
    });
    await captureEvidence(page, "screenshot-synthesizing");

    // C. after synthesis — wait for genuine completion
    await expect(page.getByTestId("graph-synthesis-complete")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("graph-synthesis-complete").scrollIntoViewIfNeeded();

    const personCount = await page.getByTestId("graph-count-person").textContent();
    expect(Number((personCount ?? "0").replace(/,/g, ""))).toBe(10);
    const locationCount = await page.getByTestId("graph-count-location").textContent();
    expect(Number((locationCount ?? "0").replace(/,/g, ""))).toBe(14);
    const ownershipCount = await page.getByTestId("graph-edge-count-ownership").textContent();
    expect(Number((ownershipCount ?? "0").replace(/,/g, ""))).toBeGreaterThan(0);

    // D. the sidebar's Graph entry enables live, without a page reload
    await expect(page.getByTestId("nav-graph")).toBeEnabled();
    await page.getByTestId("nav-graph").click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("graph-canvas")).toBeVisible();
    await captureEvidence(page, "screenshot-overview");

    // E. select a high-value entity via the deterministic node picker
    // (canvas-coordinate clicks are inherently flaky in headless CI; the
    // picker is a real UI affordance, not a test-only hook) and inspect
    // its neighborhood.
    const picker = page.getByTestId("graph-node-picker");
    const rohanOption = await picker.locator("option", { hasText: "Rohan Malhotra" }).getAttribute("value");
    expect(rohanOption).toBeTruthy();
    await picker.selectOption(rohanOption!);
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("graph-node-label")).toHaveText("Rohan Malhotra");
    const connectionCount = await page.getByTestId("graph-node-connection").count();
    expect(connectionCount).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-entity-neighborhood");

    // F. inspect a relationship's evidence trail via the "inspect" affordance
    await page.getByTestId("graph-node-connection-inspect").first().click();
    await expect(page.getByTestId("graph-edge-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("graph-edge-type")).toBeVisible();
    await expect(page.getByTestId("graph-edge-classification")).toBeVisible();
    const evidenceItemCount = await page.getByTestId("graph-edge-evidence-item").count();
    expect(evidenceItemCount).toBeGreaterThan(0);
    await page.getByTestId("graph-edge-detail").scrollIntoViewIfNeeded();
    await captureEvidence(page, "screenshot-relationship-provenance");

    // G. a filtered/focused view — hide phone nodes and enable focus mode
    await page.getByTestId("graph-filter-kind-phone").click();
    await page.getByTestId("toggle-focus-mode").click();
    await expect(page.getByTestId("toggle-focus-mode")).toHaveText(/Show full graph/);
    await captureEvidence(page, "screenshot-filtered-focused");

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the synthesized graph and re-synthesis is idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByTestId("graph-synthesis-complete")).toBeVisible();
    await page.getByTestId("graph-synthesis-complete").scrollIntoViewIfNeeded();
    const before = await page.getByTestId("graph-count-person").textContent();

    await page.getByTestId("re-synthesize-graph").click();
    await expect(page.getByTestId("graph-synthesis-note")).toContainText(/already/i, {
      timeout: 30_000,
    });
    const after = await page.getByTestId("graph-count-person").textContent();
    expect(after).toBe(before);

    // The Graph nav entry is also enabled straight from server state on reload.
    await expect(page.getByTestId("nav-graph")).toBeEnabled();

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
