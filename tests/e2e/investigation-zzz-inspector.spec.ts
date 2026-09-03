import { test, expect, type Page } from "@playwright/test";

/**
 * The shared investigation Inspector + persistent focused entity (M10.3).
 *
 *   full pipeline (advanced via the authoritative APIs if not already done)
 *   →  Analytics: select the top ranked entity  →  the Entity Profile opens
 *   →  navigate to Graph (sidebar, no cross-nav button)  →  the SAME entity
 *      profile is already open there  →  proves the focus survived
 *      navigation and the profile is one shared component
 *   →  from the profile, cross-navigate Analytics → Graph via its own button
 *   →  in Graph, drill a connected entity's relationship → Relationship mode
 *   →  drill a source-evidence row → Evidence Reference mode → back
 *   →  clear the Inspector → empty state, focus chip gone
 *   →  Corroboration: select a finding → Finding mode → drill an evidence
 *      chip → Evidence Reference mode
 *
 * Named "investigation-zzz-inspector" so it sorts after every other
 * "investigation-*" spec in the shared-DB run; it also advances the
 * pipeline itself, so it never depends on execution order.
 *
 * No mocked network. Runs the real local pipeline against the same SQLite
 * file as the other e2e specs, with no AI provider key.
 */

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

async function advance(page: Page, url: string, want: string, data?: unknown): Promise<void> {
  if ((await stateOf(page, url)) === want) return;
  const res = await page.request.post(url, { ...(data ? { data } : {}), timeout: 120_000 });
  expect(res.ok(), `${url} -> ${res.status()}`).toBeTruthy();
  await res.body();
  await expect
    .poll(() => stateOf(page, url), { timeout: 60_000, intervals: [250, 500, 1000] })
    .toBe(want);
}

async function ensurePipeline(page: Page): Promise<void> {
  await advance(page, "/api/ingestion", "loaded", { source: { kind: "builtin-corpus" } });
  await advance(page, "/api/extraction", "extracted");
  await advance(page, "/api/resolution", "resolved");
  await advance(page, "/api/graph", "synthesized");
  await advance(page, "/api/analytics", "synthesized");
  await advance(page, "/api/corroboration", "synthesized");
  await page.goto("/");
  await expect(page.getByTestId("nav-analytics")).toBeEnabled({ timeout: 20_000 });
}

test.describe.serial("shared inspector + persistent focus", () => {
  test("one Entity Profile across Analytics and Graph, persistent focus, and every Inspector mode", async ({
    page,
  }) => {
    const errors = collectConsoleErrors(page);
    await ensurePipeline(page);

    // A. Analytics — open the top ranked entity's profile.
    await page.getByTestId("nav-analytics").click();
    await expect(page.getByTestId("analytics-screen")).toBeVisible({ timeout: 15_000 });
    const firstRanked = page.getByTestId("ranked-entity-row").first();
    await expect(firstRanked).toBeVisible({ timeout: 10_000 });
    await firstRanked.click();

    const analyticsProfile = page.getByTestId("analytics-entity-detail");
    await expect(analyticsProfile).toBeVisible({ timeout: 10_000 });
    await expect(analyticsProfile).toHaveAttribute("data-slot", "entity-profile");
    const label = (await page.getByTestId("analytics-entity-label").innerText()).trim();
    expect(label.length).toBeGreaterThan(0);
    // The merged profile carries the analytics metrics too.
    await expect(page.getByTestId("entity-profile-metrics")).toBeVisible();

    // Selecting it made it the shell's focused entity.
    await expect(page.getByTestId("command-focus-chip")).toBeVisible();

    // B. Navigate to Graph via the SIDEBAR (not a cross-nav button) — the
    //    same entity's profile is already open, proving the focus
    //    survived navigation and the profile is one shared component.
    await page.getByTestId("nav-graph").click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 15_000 });
    const graphProfile = page.getByTestId("graph-node-detail");
    await expect(graphProfile).toBeVisible({ timeout: 10_000 });
    await expect(graphProfile).toHaveAttribute("data-slot", "entity-profile");
    await expect(page.getByTestId("graph-node-label")).toHaveText(label);

    // C. Cross-navigate from the profile itself: Graph → Analytics → Graph.
    await page.getByTestId("entity-profile-view-in-analytics").click();
    await expect(page.getByTestId("analytics-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("analytics-entity-label")).toHaveText(label);
    await page.getByTestId("analytics-view-in-graph").click();
    await expect(page.getByTestId("graph-screen")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("graph-node-detail")).toBeVisible({ timeout: 10_000 });

    // D. Relationship mode — drill a connected entity's relationship.
    await page.getByTestId("graph-node-connection-inspect").first().click();
    await expect(page.getByTestId("graph-edge-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("graph-edge-classification")).toBeVisible();

    // E. Evidence Reference mode — drill a source-evidence row, then back.
    await page.getByTestId("graph-edge-evidence-item").first().click();
    await expect(page.getByTestId("evidence-reference")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("evidence-reference-id")).not.toBeEmpty();
    await page.getByTestId("evidence-reference-back").click();
    await expect(page.getByTestId("graph-edge-detail")).toBeVisible();

    // F. Explicit clear — Inspector empties and the focus chip disappears.
    await page.getByTestId("inspector-clear").click();
    await expect(page.getByTestId("inspector-empty")).toBeVisible();
    await expect(page.getByTestId("command-focus-chip")).toHaveCount(0);

    // G. Finding mode + Evidence Reference from Corroboration.
    await page.getByTestId("nav-corroboration").click();
    await expect(page.getByTestId("corroboration-screen")).toBeVisible({ timeout: 15_000 });
    await page.getByTestId("tab-spatial").click();
    const findingRow = page.getByTestId("corroboration-finding-row").first();
    await expect(findingRow).toBeVisible({ timeout: 10_000 });
    await findingRow.click();
    await expect(page.getByTestId("corroboration-detail")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("corroboration-detail-classification")).toBeVisible();
    await expect(page.getByTestId("corroboration-detail-provenance")).toBeVisible();
    await page.getByTestId("corroboration-evidence-chip").first().click();
    await expect(page.getByTestId("evidence-reference")).toBeVisible({ timeout: 10_000 });

    expect(errors, `console errors: ${errors.join(" | ")}`).toEqual([]);
  });
});
