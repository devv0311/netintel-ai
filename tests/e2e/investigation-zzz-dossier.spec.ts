import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * The real end-to-end dossier / report workflow:
 *
 *   load + extract + resolve + synthesize + analyze + corroborate (if
 *     not already done)
 *   →  open the Dossier screen (sidebar entry enables live)
 *   →  Generate dossier  →  watch the real 11-stage stream
 *   →  wait for genuine completion
 *   →  verify every major section is present and populated
 *   →  verify the classification distinctions are rendered, not flattened
 *   →  expand a finding and inspect its references and full provenance
 *   →  verify a contradiction stays an Algorithmic Signal
 *   →  verify the human-verification and synthetic-data notices
 *   →  navigate from the Dossier into the Graph screen
 *   →  reload — the generated dossier persists
 *   →  regenerate — deterministic and idempotent, same report version
 *
 * No mocked network — the dev server runs the real local dossier path
 * against the same SQLite file as the other e2e specs. Named
 * "investigation-zzz-dossier" so it sorts alphabetically AFTER every
 * other "investigation-*" spec in the shared-DB full-suite run: the
 * dossier is the last pipeline stage and reports on all of them. It
 * also advances the pipeline itself if run in isolation, so it never
 * depends on file execution order to pass.
 *
 * Set CAPTURE_EVIDENCE=1 to also write the committed visual-evidence
 * screenshots under docs/progress/evidence/P5.9/.
 */

const CAPTURE = process.env.CAPTURE_EVIDENCE === "1";
const EVIDENCE_DIR = path.join(process.cwd(), "docs/progress/evidence/P5.9");
const EVIDENCE_DATE = "2026-09-03";
/** The commit the evidence corresponds to, per docs/progress/visual-evidence-convention.md. */
const EVIDENCE_SHA = process.env.EVIDENCE_SHA ?? "f9984f2";

async function captureEvidence(page: Page, kind: string, testId?: string): Promise<void> {
  if (!CAPTURE) return;
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
  const target = path.join(EVIDENCE_DIR, `P5.9_${kind}_${EVIDENCE_DATE}_${EVIDENCE_SHA}.png`);
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
 * the setup phase never races a panel's own hydration effect. The
 * dossier workflow itself is exercised entirely through the real UI in
 * the test body.
 */
async function ensureCorroborated(page: Page): Promise<void> {
  await advance(page, "/api/ingestion", "loaded", { source: { kind: "builtin-corpus" } });
  await advance(page, "/api/extraction", "extracted");
  await advance(page, "/api/resolution", "resolved");
  await advance(page, "/api/graph", "synthesized");
  await advance(page, "/api/analytics", "synthesized");
  await advance(page, "/api/corroboration", "synthesized");
  await page.goto("/");
  await expect(page.getByTestId("corroboration-synthesis-complete")).toBeVisible({ timeout: 20_000 });
}

/** Every section the dossier must show an investigator. */
const REQUIRED_SECTIONS = [
  "case_summary",
  "evidence_inventory",
  "key_entities",
  "key_relationships",
  "analytical_signals",
  "corroboration",
  "contradictions",
  "investigative_leads",
  "copilot_material",
  "provenance_index",
  "classification_confidence",
  "limitations",
] as const;

test.describe.serial("dossier / report workflow", () => {
  test("corroborated → Generate dossier → all sections, classifications, provenance and cross-navigation work", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);

    // A. before generation — everything upstream is done, no report yet
    await ensureCorroborated(page);
    await expect(page.getByTestId("nav-dossier")).toBeEnabled();
    await page.getByTestId("nav-dossier").click();
    await expect(page.getByTestId("dossier-idle")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("dossier-available")).toBeVisible();
    await captureEvidence(page, "screenshot-initial-state", "dossier-idle");

    // trigger the real generation
    await page.getByTestId("start-dossier-generation").click();

    // B. progress — the real 11-stage list appears the instant generation starts
    await expect(page.getByRole("list", { name: "Dossier stages" })).toBeVisible({ timeout: 15_000 });
    await captureEvidence(page, "screenshot-generating");

    // C. after generation — wait for genuine completion
    await expect(page.getByTestId("dossier-report")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("dossier-report-header")).toBeVisible();
    await captureEvidence(page, "screenshot-completed-dossier");

    // D. every required section is present
    for (const kind of REQUIRED_SECTIONS) {
      await expect(
        page.locator(`[data-testid="dossier-section"][data-section-kind="${kind}"]`),
        `section ${kind} is missing from the report`,
      ).toBeVisible();
    }
    const findings = page.getByTestId("dossier-finding");
    expect(await findings.count()).toBeGreaterThan(0);

    // E. classification distinctions are RENDERED, not flattened away.
    // A fact and an inference must not read alike (docs/requirements.md §7).
    for (const classification of [
      "observed_fact",
      "corroborated_fact",
      "algorithmic_signal",
      "ai_inference",
      "investigative_lead",
    ]) {
      await expect(
        page.getByTestId(`dossier-census-${classification}`),
        `the census does not report ${classification}`,
      ).toBeVisible();
      expect(
        await page.locator(`[data-testid="dossier-finding"][data-classification="${classification}"]`).count(),
        `no finding carries ${classification}`,
      ).toBeGreaterThan(0);
    }
    await captureEvidence(page, "screenshot-classifications", "dossier-census");

    // the synthetic-data indicator and the human-verification disclaimer
    await expect(page.getByTestId("dossier-synthetic-notice")).toBeVisible();
    await expect(page.getByTestId("dossier-verification-notice")).toBeVisible();

    // F. a finding expands to its references and full provenance
    const keyEntity = page
      .locator('[data-section-kind="key_entities"] [data-testid="dossier-finding-toggle"]')
      .first();
    await keyEntity.click();
    const detail = page.getByTestId("dossier-finding-detail").first();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("dossier-finding-references").first()).toBeVisible();
    const provenance = page.getByTestId("dossier-finding-provenance").first();
    await expect(provenance).toBeVisible();
    // The provenance chain must end at this stage, visibly.
    await expect(provenance).toContainText("dossier:assemble");
    await captureEvidence(page, "screenshot-finding-detail", "dossier-section");
    await captureEvidence(page, "screenshot-provenance");

    // G. contradictions are preserved as contradictions
    const contradictions = page.locator('[data-section-kind="contradictions"]');
    await expect(contradictions).toBeVisible();
    const contradictionFindings = contradictions.locator('[data-testid="dossier-finding"]');
    const contradictionCount = await contradictionFindings.count();
    expect(contradictionCount).toBeGreaterThan(0);
    // Every one of them stays an Algorithmic Signal — never a fact.
    expect(
      await contradictions.locator('[data-testid="dossier-finding"][data-classification="algorithmic_signal"]').count(),
    ).toBe(contradictionCount);
    await captureEvidence(page, "screenshot-contradictions");

    // leads are present and stay leads
    const leads = page.locator('[data-section-kind="investigative_leads"]');
    await expect(leads).toBeVisible();
    const leadCount = await leads.locator('[data-testid="dossier-finding"]').count();
    expect(leadCount).toBeGreaterThan(0);
    expect(
      await leads.locator('[data-testid="dossier-finding"][data-classification="investigative_lead"]').count(),
    ).toBe(leadCount);
    await captureEvidence(page, "screenshot-verification-leads");

    // H. cross-navigation from a dossier finding into the Graph screen
    const contradictionToggle = contradictions.locator('[data-testid="dossier-finding-toggle"]').first();
    await contradictionToggle.click();
    const viewInGraph = page.getByTestId("dossier-view-in-graph").first();
    await expect(viewInGraph).toBeVisible({ timeout: 10_000 });
    await captureEvidence(page, "screenshot-cross-navigation");
    await viewInGraph.click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 15_000 });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });

  test("reload preserves the generated dossier and regeneration is deterministic and idempotent", async ({ page }) => {
    const errors = collectConsoleErrors(page);

    // A. reload — the report comes back from persisted state, not memory
    await page.goto("/");
    await expect(page.getByTestId("nav-dossier")).toBeEnabled();
    await page.getByTestId("nav-dossier").click();
    await expect(page.getByTestId("dossier-report")).toBeVisible({ timeout: 30_000 });

    const versionBefore = await page.getByTestId("dossier-report-version").textContent();
    const generatedBefore = await page.getByTestId("dossier-generated-at").textContent();
    const findingsBefore = await page.getByTestId("dossier-finding").count();
    expect(versionBefore).toBeTruthy();
    expect(findingsBefore).toBeGreaterThan(0);
    await captureEvidence(page, "screenshot-reload-persisted", "dossier-report-header");

    // B. regenerate — identical case state must produce the identical report
    await page.getByTestId("regenerate-dossier").click();
    await expect(page.getByTestId("dossier-generation-note")).toBeVisible({ timeout: 180_000 });
    await expect(page.getByTestId("dossier-generation-note")).toContainText(/idempotent/i);

    const versionAfter = await page.getByTestId("dossier-report-version").textContent();
    const generatedAfter = await page.getByTestId("dossier-generated-at").textContent();
    const findingsAfter = await page.getByTestId("dossier-finding").count();

    expect(versionAfter, "report version changed for unchanged case state").toBe(versionBefore);
    expect(findingsAfter).toBe(findingsBefore);
    // The report was reused, not rewritten, so its generation time stands.
    expect(generatedAfter).toBe(generatedBefore);
    await captureEvidence(page, "screenshot-regeneration-idempotent");

    // C. the report is not stale — it describes the current graph version
    await expect(page.getByTestId("dossier-stale-notice")).toHaveCount(0);

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
