/**
 * M10.4 visual-evidence capture — drives the REAL app (no AI provider
 * key) in the committed dark operational theme and captures the
 * redesigned Graph surface: deterministic spatialized layout, kind/
 * relationship-type encodings, selection dimming, the dashed
 * AI-inference treatment, hover tooltip, legend, and the shared
 * Inspector integration.
 *
 *   # against an already-running dev server on :3000 with the full
 *   # Operation DarkNet Delhi pipeline in ./data/netintel-e2e.db
 *   node docs/progress/evidence/P5.10.4/capture.mjs
 *
 *   # or start one first:
 *   DATABASE_URL=./data/netintel-e2e.db npx next dev -p 3000
 *
 * Nothing here mocks the app: every screenshot is the real Graph screen,
 * driven the same way tests/e2e/investigation-synthesis.spec.ts drives
 * it (the deterministic node picker, never a raw canvas-coordinate
 * click). The pre/post comparison reuses the already-committed
 * docs/progress/evidence/P5.5 overview screenshot (the old circular
 * layout) as "pre" — no need to check out the old code to re-capture it.
 */
import { existsSync, mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { chromium } from "@playwright/test";
import sharp from "sharp";

const DATE = "2026-09-03";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRE_IMAGE = path.join(HERE, "../P5.5/P5.5_screenshot-overview_2026-09-02_9a5fa41.png");

const shot = (name) => path.join(HERE, `P5.10.4_${name}_${DATE}.png`);

/** Hovers a small grid over the canvas until a node's tooltip appears (screen positions from the deterministic layout aren't known in advance without duplicating the layout math here). */
async function hoverUntilTooltip(page, canvas) {
  const box = await canvas.boundingBox();
  for (let fx = 0.2; fx <= 0.8; fx += 0.03) {
    for (let fy = 0.15; fy <= 0.85; fy += 0.03) {
      await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(40);
      if (await page.getByTestId("graph-hover-tooltip").count()) return true;
    }
  }
  return false;
}

async function main() {
  mkdirSync(HERE, { recursive: true });
  const probe = await fetch(BASE).catch(() => null);
  if (!probe || !probe.ok) {
    throw new Error(`no dev server at ${BASE} — start one with DATABASE_URL=./data/netintel-e2e.db npx next dev -p 3000`);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({ colorScheme: "dark", viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  page.on("pageerror", (err) => errors.push(err.message));

  try {
    await page.goto(BASE, { waitUntil: "networkidle" });
    await page.getByTestId("nav-graph").waitFor({ timeout: 20_000 });
    await page.getByTestId("nav-graph").click();
    await page.getByTestId("graph-screen").waitFor({ timeout: 20_000 });
    const canvas = page.getByTestId("graph-canvas");
    await canvas.waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);

    // 1. Full graph overview — deterministic spatialized layout, 68/196 corpus intact.
    await page.screenshot({ path: shot("screenshot-overview") });

    // 2. Legend.
    await page.getByTestId("graph-legend").screenshot({ path: shot("screenshot-legend") });

    // 3. Hover state — tooltip with label/kind/degree.
    const hovered = await hoverUntilTooltip(page, canvas);
    if (!hovered) throw new Error("no node hover tooltip appeared during the sweep");
    await page.screenshot({ path: shot("screenshot-hover") });
    // Clear the hover state before the rest of the walkthrough — move to
    // empty canvas space (not outside the container) so sigma's own
    // `leaveNode` fires reliably for a single synthetic jump.
    const emptyCorner = await canvas.boundingBox();
    await page.mouse.move(emptyCorner.x + 8, emptyCorner.y + 8, { steps: 5 });
    await page.waitForTimeout(150);

    // 4. Focused entity + neighborhood — full opacity neighbors, ~12% opacity elsewhere.
    const picker = page.getByTestId("graph-node-picker");
    const rohanValue = await picker.locator("option", { hasText: "Rohan Malhotra" }).getAttribute("value");
    await picker.selectOption(rohanValue);
    await page.getByTestId("graph-node-detail").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: shot("screenshot-focused-neighborhood") });

    // 5. Selected edge + Inspector — relationship detail, accent-highlighted edge.
    await page.getByTestId("graph-node-connection-inspect").first().click();
    await page.getByTestId("graph-edge-detail").waitFor({ timeout: 10_000 });
    await page.waitForTimeout(400);
    await page.screenshot({ path: shot("screenshot-selected-edge") });

    // 6. Filtered graph.
    await page.getByTestId("inspector-clear").click();
    await page.getByTestId("inspector-empty").waitFor({ timeout: 10_000 });
    await page.getByTestId("graph-filter-kind-phone").click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: shot("screenshot-filtered") });
    await page.getByTestId("graph-filter-kind-phone").click(); // restore
    await page.waitForTimeout(200);

    // 7. Repeated-load determinism check — reload (state resets to Evidence,
    // navigate back to Graph) and re-screenshot the overview.
    await page.reload({ waitUntil: "networkidle" });
    await page.getByTestId("nav-graph").waitFor({ timeout: 20_000 });
    await page.getByTestId("nav-graph").click();
    await page.getByTestId("graph-canvas").waitFor({ timeout: 20_000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: shot("screenshot-overview-reloaded") });

    console.log("console/page errors:", JSON.stringify(errors));
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }

  // 8. Pre/post comparison — the committed P5.5 old circular layout vs the new one, side by side.
  if (existsSync(PRE_IMAGE)) {
    const post = shot("screenshot-overview");
    const preMeta = await sharp(PRE_IMAGE).metadata();
    const postMeta = await sharp(post).metadata();
    const height = Math.max(preMeta.height, postMeta.height);
    const labelHeight = 36;
    const preResized = await sharp(PRE_IMAGE)
      .resize({ height: height - labelHeight, fit: "contain", background: "#15171c" })
      .toBuffer();
    const postResized = await sharp(post)
      .resize({ height: height - labelHeight, fit: "contain", background: "#15171c" })
      .toBuffer();
    const preResizedMeta = await sharp(preResized).metadata();
    const postResizedMeta = await sharp(postResized).metadata();
    const totalWidth = preResizedMeta.width + postResizedMeta.width;

    const svgLabels = Buffer.from(
      `<svg width="${totalWidth}" height="${labelHeight}">
        <rect width="100%" height="100%" fill="#15171c" />
        <text x="16" y="24" font-family="sans-serif" font-size="16" fill="#e8e8ea">Pre — P5.5 circular positioning</text>
        <text x="${preResizedMeta.width + 16}" y="24" font-family="sans-serif" font-size="16" fill="#e8e8ea">Post — M10.4 deterministic spatialization</text>
      </svg>`,
    );

    await sharp({
      create: { width: totalWidth, height, channels: 3, background: "#15171c" },
    })
      .composite([
        { input: svgLabels, left: 0, top: 0 },
        { input: preResized, left: 0, top: labelHeight },
        { input: postResized, left: preResizedMeta.width, top: labelHeight },
      ])
      .png()
      .toFile(shot("comparison"));
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
