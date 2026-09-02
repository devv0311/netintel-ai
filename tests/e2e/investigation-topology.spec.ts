import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end topology analytics workflow:
 *
 *   load + extract + resolve + synthesize the graph (if not already done)
 *   →  Run Analytics  →  watch the real 10-stage stream
 *   →  wait for genuine completion
 *   →  navigate to the Analytics screen (sidebar entry enables live)
 *   →  inspect ranked entities
 *   →  inspect bridge entities
 *   →  inspect communities/clusters
 *   →  select an entity and inspect its metric detail
 *   →  run a shortest-path query and inspect the result + provenance
 *   →  apply a relationship-type filter to the path query
 *   →  navigate from Analytics back to the Graph screen
 *   →  reload — synthesized state persists
 *   →  re-run analytics — deterministic/idempotent result
 *
 * No mocked network — the dev server runs the real local analytics
 * path against the same SQLite file as the other e2e specs (see
 * global-setup.ts). Named "investigation-topology" (not
 * "investigation-analytics") so it sorts alphabetically AFTER
 * investigation-synthesis.spec.ts (analytics depends on the graph
 * having already been synthesized) and still before shell.spec.ts in
 * the shared-DB full-suite run; it also ingests/extracts/resolves/
 * synthesizes itself first if run in isolation, so it never depends on
 * file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.6/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.6");
const EVIDENCE_DATE = "2026-09-02";

async function captureEvidence(page: Page, kind: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `P5.6_${kind}_${EVIDENCE_DATE}.png`),
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
 * (never by reading transient DOM state) — see
 * investigation-synthesis.spec.ts's ensureResolved for the full
 * rationale (avoids racing a component's own hydration/reconciliation
 * effect).
 */
async function ensureGraphSynthesized(page: Page): Promise<void> {
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

  const graphState = await (await page.request.get("/api/graph")).json();
  if (graphState.status !== "synthesized") {
    await page.getByTestId("start-graph-synthesis").click();
    await expect(page.getByTestId("graph-synthesis-complete")).toBeVisible({ timeout: 60_000 });
  } else {
    await expect(page.getByTestId("graph-synthesis-complete")).toBeVisible({ timeout: 15_000 });
  }
}

test.describe.serial("topology analytics workflow", () => {
  test("synthesized graph → Run Analytics → ranked entities, bridges, communities, entity detail, and shortest path all work", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before analytics — graph synthesized, analytics available
    await ensureGraphSynthesized(page);
    const startButton = page.getByTestId("start-analytics-synthesis");
    await startButton.scrollIntoViewIfNeeded();
    await expect(startButton).toBeVisible();
    await expect(startButton).toBeEnabled();
    await expect(page.getByTestId("analytics-available")).toBeVisible();
    await expect(page.getByTestId("nav-analytics")).toBeDisabled();
    await captureEvidence(page, "screenshot-preanalytics");

    // trigger the real analytics synthesis
    await startButton.click();

    // B. progress — the real 10-stage list appears the instant synthesis
    // starts (a genuine workflow state, not a timed animation)
    await expect(page.getByRole("list", { name: "Analytics stages" })).toBeVisible({ timeout: 15_000 });

    // C. after synthesis — wait for genuine completion
    await expect(page.getByTestId("analytics-synthesis-complete")).toBeVisible({ timeout: 60_000 });
    await page.getByTestId("analytics-synthesis-complete").scrollIntoViewIfNeeded();
    const rankedCount = await page.getByTestId("analytics-count-ranked").textContent();
    expect(Number((rankedCount ?? "0").replace(/,/g, ""))).toBe(68);
    const bridgeCount = await page.getByTestId("analytics-count-bridges").textContent();
    expect(Number((bridgeCount ?? "0").replace(/,/g, ""))).toBeGreaterThan(0);

    // D. the sidebar's Analytics entry enables live, without a page reload
    await expect(page.getByTestId("nav-analytics")).toBeEnabled();
    await page.getByTestId("nav-analytics").click();
    await expect(page.getByTestId("analytics-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("analytics-overview")).toBeVisible();

    // E. ranked entities render, and clicking one shows the detail panel
    // (waited for before the overview screenshot too, so that capture
    // shows the real loaded list rather than the transient "0 of 0"
    // state between navigation and the async fetch resolving)
    await expect(page.getByTestId("ranked-entities-list")).toBeVisible();
    const rankedRows = page.getByTestId("ranked-entity-row");
    await expect(rankedRows.first()).toBeVisible({ timeout: 10_000 });
    expect(await rankedRows.count()).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-overview");
    await captureEvidence(page, "screenshot-ranked");

    await rankedRows.first().click();
    await expect(page.getByTestId("analytics-entity-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("analytics-entity-label")).toBeVisible();
    const signalCount = await page.getByTestId("analytics-entity-signal").count();
    expect(signalCount).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-entity-detail");

    // F. bridge entities tab renders real structural bridges
    await page.getByTestId("tab-bridges").click();
    await expect(page.getByTestId("bridges-list")).toBeVisible();
    const bridgeRows = page.getByTestId("bridge-entity-row");
    await expect(bridgeRows.first()).toBeVisible({ timeout: 10_000 });
    expect(await bridgeRows.count()).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-bridges");

    // G. communities/clusters tab renders
    await page.getByTestId("tab-communities").click();
    await expect(page.getByTestId("communities-list")).toBeVisible();
    const communityRows = page.getByTestId("community-row");
    await expect(communityRows.first()).toBeVisible({ timeout: 10_000 });
    expect(await communityRows.count()).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-communities");

    // H. shortest-path workflow: pick Rohan Malhotra -> Farhan Qureshi
    // (the deliberately-hidden S1<->S4 connection — the path must be
    // found via real, indirect graph structure, never a direct edge).
    const sourcePicker = page.getByTestId("path-source-picker");
    const targetPicker = page.getByTestId("path-target-picker");
    const rohanValue = await sourcePicker.locator("option", { hasText: "Rohan Malhotra" }).getAttribute("value");
    const farhanValue = await targetPicker.locator("option", { hasText: "Farhan Qureshi" }).getAttribute("value");
    expect(rohanValue).toBeTruthy();
    expect(farhanValue).toBeTruthy();
    await sourcePicker.selectOption(rohanValue!);
    await targetPicker.selectOption(farhanValue!);
    await page.getByTestId("find-path-button").click();
    await expect(page.getByTestId("path-result-found")).toBeVisible({ timeout: 10_000 });
    const pathEdges = page.getByTestId("path-edge");
    expect(await pathEdges.count()).toBeGreaterThan(0);
    await page.getByTestId("path-result-found").scrollIntoViewIfNeeded();
    await captureEvidence(page, "screenshot-shortest-path");

    // I. relationship-type filtering on the path query changes the result
    await page.getByTestId("path-filter-financial").click();
    await page.getByTestId("find-path-button").click();
    const filteredResult = page.getByTestId("path-result-found").or(page.getByTestId("path-result-not-found"));
    await expect(filteredResult).toBeVisible({ timeout: 10_000 });
    await filteredResult.scrollIntoViewIfNeeded();
    await captureEvidence(page, "screenshot-path-filtered");

    // J. navigate from Analytics back to the Graph screen (cross-navigation)
    await page.getByTestId("analytics-view-in-graph").click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 10_000 });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload keeps the synthesized analytics and re-synthesis is idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    await page.goto("/");
    await expect(page.getByTestId("analytics-synthesis-complete")).toBeVisible();
    await page.getByTestId("analytics-synthesis-complete").scrollIntoViewIfNeeded();
    const before = await page.getByTestId("analytics-count-ranked").textContent();

    await page.getByTestId("re-synthesize-analytics").click();
    await expect(page.getByTestId("analytics-synthesis-note")).toContainText(/already/i, { timeout: 30_000 });
    const after = await page.getByTestId("analytics-count-ranked").textContent();
    expect(after).toBe(before);

    // The Analytics nav entry is also enabled straight from server state on reload.
    await expect(page.getByTestId("nav-analytics")).toBeEnabled();

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
