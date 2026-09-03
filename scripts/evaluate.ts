/**
 * Workstream K — the evaluation harness entry point.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/evaluate.ts
 *
 * What it does, in order:
 *   1. points DATABASE_URL at a dedicated evaluation database and wipes it
 *   2. runs the real pipeline stages, in the real order, through the same
 *      service functions the API routes call
 *   3. reads the persisted output back through the validated repository
 *   4. loads the ground-truth document independently and scores
 *   5. writes reports/evaluation/{evaluation-results.json,evaluation-summary.md}
 *
 * It never writes to evidence/ground-truth/, and it never adjusts a
 * metric to make a number look better. A metric that cannot be computed
 * from the ground truth that exists is reported as NOT IMPLEMENTABLE YET.
 *
 * The Copilot stage is deliberately not run: it is the only stage that
 * calls the Claude API, and an evaluation that costs money and varies
 * with sampling is not one you can run on every commit. See the
 * copilot.grounding metric for what that leaves unmeasured.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DB_PATH = process.env.EVAL_DATABASE_URL ?? "./data/netintel-eval.db";
const OUT_DIR = path.join(ROOT, "reports", "evaluation");

process.env.DATABASE_URL = DB_PATH;
process.env.APP_ENV = process.env.APP_ENV ?? "development";

function wipeDatabase(): void {
  fs.mkdirSync(path.dirname(path.resolve(ROOT, DB_PATH)), { recursive: true });
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(path.resolve(ROOT, DB_PATH + suffix), { force: true });
  }
}

function gitCommit(): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  wipeDatabase();

  const { runIngestion } = await import("@/lib/ingestion/service");
  const { runExtraction } = await import("@/lib/extraction/service");
  const { runResolution } = await import("@/lib/resolution/service");
  const { runGraphSynthesis } = await import("@/lib/graph/service");
  const { runAnalyticsSynthesis } = await import("@/lib/analytics/service");
  const { runCorroborationSynthesis } = await import("@/lib/corroboration/service");

  const stages: { stage: string; ms: number; detail: string }[] = [];
  const stage = async (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
    const began = Date.now();
    process.stdout.write(`  ${name} … `);
    const result = await fn();
    const ms = Date.now() - began;
    const status = (result as { status?: string } | undefined)?.status ?? "ok";
    stages.push({ stage: name, ms, detail: String(status) });
    process.stdout.write(`${(ms / 1000).toFixed(1)}s (${status})\n`);
    return result;
  };

  console.log("Running pipeline against the built-in corpus:");
  await stage("ingestion", () => runIngestion({ kind: "builtin-corpus" }));
  await stage("extraction", () => runExtraction());
  await stage("resolution", () => runResolution());
  await stage("graph synthesis", () => runGraphSynthesis());
  await stage("topology analytics", () => runAnalyticsSynthesis());
  await stage("spatial/temporal corroboration", () => runCorroborationSynthesis());

  const { loadSystemSnapshot } = await import("@/lib/evaluation/snapshot");
  const { evaluate } = await import("@/lib/evaluation/run");
  const { renderMarkdown } = await import("@/lib/evaluation/report");

  const snapshot = await loadSystemSnapshot();
  console.log(
    `\nSnapshot: ${snapshot.evidenceItems.length} evidence items, ${snapshot.extractedRecords.length} extracted records, ` +
      `${snapshot.entities.length} entities, ${snapshot.relationships.length} relationships, ` +
      `${snapshot.analyticalSignals.length} signals, ${snapshot.corroborationFindings.length} corroboration findings.`,
  );

  const corpusMeta = JSON.parse(
    fs.readFileSync(path.join(ROOT, "evidence/synthetic/operation-darknet-delhi.json"), "utf8"),
  ).corpus as { name: string; version: string; seed: number };

  const report = evaluate(
    snapshot,
    {
      runId: `eval-${startedAt.replace(/[:.]/g, "-")}`,
      startedAt,
      completedAt: new Date().toISOString(),
      corpusName: corpusMeta.name,
      corpusVersion: corpusMeta.version,
      corpusSeed: corpusMeta.seed,
      databasePath: DB_PATH,
      gitCommit: gitCommit(),
      nodeVersion: process.version,
      pipelineStages: stages,
    },
    { hasApiKey: Boolean(process.env.AI_PROVIDER_API_KEY), root: ROOT },
  );

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, "evaluation-results.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(OUT_DIR, "evaluation-summary.md"), renderMarkdown(report));

  console.log("\nResults:");
  for (const metric of report.metrics) {
    const value =
      metric.status === "not_implementable_yet"
        ? "NOT IMPLEMENTABLE YET"
        : metric.value === null
          ? "—"
          : `${(metric.value * 100).toFixed(1)}%`;
    const verdict = metric.passed === null ? "" : metric.passed ? "  PASS" : "  FAIL";
    console.log(`  ${metric.id.padEnd(38)} ${value}${verdict}`);
  }
  if (report.errors.length > 0) {
    console.log("\nErrors:");
    for (const error of report.errors) console.log(`  - ${error}`);
  }
  console.log(`\nWrote ${path.relative(ROOT, OUT_DIR)}/evaluation-results.json and evaluation-summary.md`);

  const { closeAllDbConnections } = await import("@/lib/db/client");
  closeAllDbConnections();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
