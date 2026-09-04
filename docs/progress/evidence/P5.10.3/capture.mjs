/**
 * M10.3 visual-evidence capture — drives the REAL app (no AI provider
 * key) in the committed dark operational theme and captures the shared
 * Inspector and persistent focused entity.
 *
 *   # against an already-running dev server on :3000 with the full
 *   # Operation DarkNet Delhi pipeline in ./data/cipher-e2e.db
 *   node docs/progress/evidence/P5.10.3/capture.mjs
 *
 *   # or start one first:
 *   DATABASE_URL=./data/cipher-e2e.db npx next dev -p 3000
 *
 * Nothing here mocks the app: every screenshot is the real Graph /
 * Analytics / Corroboration screen with the shared Inspector, driven the
 * same way `tests/e2e/investigation-zzz-inspector.spec.ts` drives it.
 */
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { chromium } from "@playwright/test";

const DATE = "2026-09-03";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const VIDEO_DIR = path.join(HERE, ".video");

const shot = (name) => path.join(HERE, `P5.10.3_${name}_${DATE}.png`);

async function main() {
  const probe = await fetch(BASE).catch(() => null);
  if (!probe || !probe.ok) {
    throw new Error(`no dev server at ${BASE} — start one with DATABASE_URL=./data/cipher-e2e.db npx next dev -p 3000`);
  }
  rmSync(VIDEO_DIR, { recursive: true, force: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    colorScheme: "dark",
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: VIDEO_DIR, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByTestId("nav-analytics").waitFor();

    // 1. Entity Profile from Analytics.
    await page.getByTestId("nav-analytics").click();
    await page.getByTestId("analytics-screen").waitFor({ timeout: 20_000 });
    await page.getByTestId("ranked-entity-row").first().waitFor({ timeout: 15_000 });
    await page.getByTestId("ranked-entity-row").first().click();
    await page.getByTestId("analytics-entity-detail").waitFor({ timeout: 15_000 });
    const label = (await page.getByTestId("analytics-entity-label").innerText()).trim();
    await page.getByTestId("analytics-entity-detail").screenshot({ path: shot("screenshot-entity-profile-analytics") });
    await page.screenshot({ path: shot("screenshot-analytics-with-inspector") });

    // 2. Focus persistence + same profile from Graph (via the sidebar).
    await page.getByTestId("nav-graph").click();
    await page.getByTestId("graph-screen").waitFor({ timeout: 20_000 });
    await page.getByTestId("graph-node-detail").waitFor({ timeout: 15_000 });
    await page.getByTestId("graph-canvas").waitFor({ timeout: 20_000 });
    await sleep(1500);
    await page.getByTestId("graph-node-detail").screenshot({ path: shot("screenshot-entity-profile-graph") });
    await page.screenshot({ path: shot("screenshot-focus-persists-graph") });

    // 3. Relationship mode.
    await page.getByTestId("graph-node-connection-inspect").first().click();
    await page.getByTestId("graph-edge-detail").waitFor({ timeout: 15_000 });
    await page.getByTestId("graph-edge-detail").screenshot({ path: shot("screenshot-relationship-detail") });

    // 4. Evidence Reference mode (drilled from the relationship).
    await page.getByTestId("graph-edge-evidence-item").first().click();
    await page.getByTestId("evidence-reference").waitFor({ timeout: 15_000 });
    await page.getByTestId("evidence-reference").screenshot({ path: shot("screenshot-evidence-reference") });
    await page.getByTestId("evidence-reference-back").click();
    await page.getByTestId("graph-edge-detail").waitFor();

    // 5. Cleared Inspector.
    await page.getByTestId("inspector-clear").click();
    await page.getByTestId("inspector-empty").waitFor({ timeout: 10_000 });
    await page.getByTestId("inspector").screenshot({ path: shot("screenshot-inspector-cleared") });

    // 6. Finding mode from Corroboration.
    await page.getByTestId("nav-corroboration").click();
    await page.getByTestId("corroboration-screen").waitFor({ timeout: 20_000 });
    await page.getByTestId("tab-spatial").click();
    await page.getByTestId("corroboration-finding-row").first().waitFor({ timeout: 15_000 });
    await page.getByTestId("corroboration-finding-row").first().click();
    await page.getByTestId("corroboration-detail").waitFor({ timeout: 15_000 });
    await page.getByTestId("corroboration-detail").screenshot({ path: shot("screenshot-finding-detail") });

    // 7. Cross-navigation recording: Analytics → select → profile
    //    "Corroboration" → Graph via the sidebar (focus carried) →
    //    inspect a relationship → drill a source-evidence row.
    await page.getByTestId("nav-analytics").click();
    await page.getByTestId("ranked-entity-row").first().waitFor({ timeout: 15_000 });
    await page.getByTestId("ranked-entity-row").nth(1).click();
    await page.getByTestId("analytics-entity-detail").waitFor({ timeout: 15_000 });
    await sleep(600);
    await page.getByTestId("entity-profile-view-in-corroboration").click();
    await page.getByTestId("corroboration-screen").waitFor({ timeout: 20_000 });
    await sleep(600);
    await page.getByTestId("nav-graph").click();
    await page.getByTestId("graph-node-detail").waitFor({ timeout: 15_000 });
    await sleep(600);
    await page.getByTestId("graph-node-connection-inspect").first().click();
    await page.getByTestId("graph-edge-detail").waitFor({ timeout: 15_000 });
    await sleep(800);

    console.log(`captured profile for entity: ${label}`);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
    if (existsSync(VIDEO_DIR)) {
      const webm = readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
      if (webm) renameSync(path.join(VIDEO_DIR, webm), path.join(HERE, `P5.10.3_recording-cross-nav_${DATE}.webm`));
    }
    rmSync(VIDEO_DIR, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
