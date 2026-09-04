/**
 * M10.2 visual-evidence capture — runs the REAL app (no AI provider key)
 * against the shared e2e database, in the committed dark operational
 * theme, and captures the command-centre shell + the shared
 * classification / provenance primitives.
 *
 *   node docs/progress/evidence/P5.10.2/capture.mjs after
 *   node docs/progress/evidence/P5.10.2/capture.mjs before   # run under `git stash`
 *
 * "before" captures only the shell chrome, for the side-by-side
 * comparison. Nothing here mocks the app: the primitives are screenshotted
 * from a throwaway preview route that renders the real components, created
 * and removed by this script.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, renameSync, existsSync, readdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { chromium } from "@playwright/test";

const MODE = process.argv[2] === "before" ? "before" : "after";
const DATE = "2026-09-03";
const PORT = 3123;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../../..");
const PREVIEW_DIR = path.join(ROOT, "src/app/m10-2-preview");
const PREVIEW_FILE = path.join(PREVIEW_DIR, "page.tsx");
const VIDEO_DIR = path.join(HERE, ".video");

const shot = (name) =>
  path.join(HERE, MODE === "before" ? `.before_${name}.png` : `P5.10.2_${name}_${DATE}.png`);

const PREVIEW_SOURCE = `"use client";

import { ClassificationChip } from "@/components/ui/classification-chip";
import { ProvenanceBlock } from "@/components/ui/provenance-block";
import { EmptyState, LoadingState, ErrorState } from "@/components/ui/states";
import { Panel } from "@/components/ui/panel";
import { FolderOpen } from "lucide-react";

const CLASSES = [
  "observed_fact",
  "corroborated_fact",
  "algorithmic_signal",
  "ai_inference",
  "investigative_lead",
] as const;

const SAMPLE_PROVENANCE = {
  source: "evidence_item:FIR ODD/SYN/2025/001",
  location: "section 2, paragraph 4",
  method: "corroboration.temporal_co_occurrence",
  confidence: 0.82,
  processingHistory: ["ingestion", "extraction", "resolution", "graph:synthesize", "corroboration:build"],
  timestamp: "2026-09-03T08:14:59.000Z",
};

export default function M10Preview() {
  return (
    <div className="flex min-h-dvh flex-col gap-6 bg-bg p-8 text-fg">
      <h1 className="text-sm font-semibold">M10.2 primitives — component preview</h1>
      <section className="flex flex-col gap-2" data-testid="preview-classification">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">
          ClassificationChip — five distinct treatments
        </span>
        <div className="flex flex-wrap gap-2">
          {CLASSES.map((c) => (
            <ClassificationChip key={c} classification={c} confidence={0.9} showConfidence />
          ))}
        </div>
      </section>
      <section className="flex max-w-md flex-col gap-2" data-testid="preview-provenance">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-fg-faint">ProvenanceBlock</span>
        <Panel weight="inset">
          <ProvenanceBlock provenance={SAMPLE_PROVENANCE} />
        </Panel>
      </section>
      <section className="grid max-w-3xl gap-3 md:grid-cols-3" data-testid="preview-states">
        <EmptyState icon={FolderOpen} title="No investigation loaded" detail="Run the pipeline to begin." />
        <LoadingState label="Loading node detail…" />
        <ErrorState code="GRAPH_UNAVAILABLE" message="Synthesize the graph first." onRetry={() => {}} />
      </section>
    </div>
  );
}
`;

async function waitForServer(url, timeoutMs = 120_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(1000);
  }
  throw new Error("dev server did not become ready");
}

async function main() {
  if (MODE === "after") {
    mkdirSync(PREVIEW_DIR, { recursive: true });
    writeFileSync(PREVIEW_FILE, PREVIEW_SOURCE);
  }
  rmSync(VIDEO_DIR, { recursive: true, force: true });

  const dev = spawn("npx", ["next", "dev", "-p", String(PORT)], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: "./data/cipher-e2e.db", NODE_ENV: "development" },
    stdio: "ignore",
  });

  const base = `http://localhost:${PORT}`;
  let browser;
  let context;
  try {
    await waitForServer(base);
    browser = await chromium.launch();
    context = await browser.newContext({
      colorScheme: "dark",
      viewport: { width: 1440, height: 900 },
      recordVideo: MODE === "after" ? { dir: VIDEO_DIR, size: { width: 1440, height: 900 } } : undefined,
    });
    const page = await context.newPage();

    await page.goto(base, { waitUntil: "networkidle" });
    await page.getByText("CIPHER").first().waitFor();

    await page.locator("header").screenshot({ path: shot("screenshot-command-bar") });
    const nav = page.locator("nav[aria-label='Investigation navigation']");
    await nav.screenshot({ path: shot("screenshot-nav-rail-expanded") });

    if (MODE === "after") {
      await page.getByTestId("nav-collapse-toggle").click();
      await sleep(400);
      await nav.screenshot({ path: shot("screenshot-nav-rail-collapsed") });
      await page.getByTestId("nav-collapse-toggle").click();
      await sleep(400);
    }

    await page.screenshot({ path: shot("screenshot-shell") });

    if (MODE === "after") {
      // Primitives, rendered in isolation from the real component code.
      await page.goto(`${base}/m10-2-preview`, { waitUntil: "networkidle" });
      await page.getByTestId("preview-classification").waitFor({ timeout: 30_000 });
      await page.getByTestId("preview-classification").screenshot({
        path: shot("screenshot-classification-treatments"),
      });
      await page.getByTestId("preview-provenance").screenshot({ path: shot("screenshot-provenance-block") });
      await page.getByTestId("preview-states").screenshot({ path: shot("screenshot-states") });

      // Real screens: Dossier + Copilot integrations.
      await page.goto(base, { waitUntil: "networkidle" });
      if (await page.getByTestId("nav-dossier").isEnabled()) {
        await page.getByTestId("nav-dossier").click();
        await page.getByTestId("dossier-report").waitFor({ timeout: 30_000 });
        await page.getByTestId("dossier-census").scrollIntoViewIfNeeded();
        await page.getByTestId("dossier-census").screenshot({ path: shot("screenshot-dossier-census") });
        const finding = page.getByTestId("dossier-finding-toggle").first();
        await finding.scrollIntoViewIfNeeded();
        await finding.click();
        await sleep(200);
        await page.getByTestId("dossier-finding-detail").first().scrollIntoViewIfNeeded();
        await page
          .getByTestId("dossier-finding-detail")
          .first()
          .screenshot({ path: shot("screenshot-dossier-classification-provenance") });
      }

      if (await page.getByTestId("nav-copilot").isEnabled()) {
        await page.getByTestId("nav-copilot").click();
        await page.getByTestId("copilot-screen").waitFor({ timeout: 30_000 });
        await page.getByTestId("copilot-suggestion").first().click();
        await page.getByTestId("copilot-answer").waitFor({ timeout: 90_000 });
        await page.getByTestId("copilot-provenance-toggle").click();
        await sleep(400);
        await page.screenshot({ path: shot("screenshot-copilot-classification-provenance"), fullPage: true });
      }
    }
  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    dev.kill("SIGTERM");
    await sleep(1500);
    dev.kill("SIGKILL");
    if (MODE === "after") {
      if (existsSync(VIDEO_DIR)) {
        const webm = readdirSync(VIDEO_DIR).find((f) => f.endsWith(".webm"));
        if (webm) {
          renameSync(path.join(VIDEO_DIR, webm), path.join(HERE, `P5.10.2_recording-shell_${DATE}.webm`));
        }
      }
      rmSync(VIDEO_DIR, { recursive: true, force: true });
      rmSync(PREVIEW_DIR, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
