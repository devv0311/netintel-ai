/**
 * Bounded, read-only public-register collector.
 *
 *   node --import ./scripts/eval-resolve.mjs scripts/collect-public.ts --source gleif --dry-run
 *   node --import ./scripts/eval-resolve.mjs scripts/collect-public.ts --source wikidata --limit 200
 *   node --import ./scripts/eval-resolve.mjs scripts/collect-public.ts --source gleif --from-file raw.json
 *
 * There is no URL flag, and there is no "all" flag. A source is named by
 * its registry id; the endpoint and the query are constants inside the
 * adapter; `--limit` is capped by the adapter's own MAX_LIMIT. Starting a
 * large-scale collection with this tool is not a matter of restraint —
 * it is not expressible.
 *
 * --dry-run prints exactly what would be requested and exits before any
 * socket is opened. Run it first; it is the Phase 3A gate.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const source = arg("source");
  const limit = Number(arg("limit") ?? 100);
  const fromFile = arg("from-file");
  const query = arg("query");

  if (source !== "gleif" && source !== "wikidata") {
    console.error("usage: --source gleif|wikidata [--limit N] [--query NAME] [--from-file PATH] [--dry-run]");
    console.error("No other source is collectable: the adapter set is the allowlist.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(limit) || limit < 1) {
    console.error("--limit must be a positive integer");
    process.exitCode = 1;
    return;
  }

  const gleif = await import("@/lib/adapters/public/gleif");
  const wikidata = await import("@/lib/adapters/public/wikidata");
  type WikidataQueryName = keyof typeof wikidata.QUERIES;
  const options = { limit, fromFile, root: ROOT };

  const plan =
    source === "gleif"
      ? gleif.planGleif({ jurisdiction: arg("jurisdiction") ?? "IN" }, options)
      : wikidata.planWikidata(
          (query ?? "indian-companies-with-lei") as WikidataQueryName,
          options,
        );

  console.log("PLAN");
  console.log(`  source           ${plan.sourceId} — ${plan.sourceName}`);
  console.log(`  endpoint         ${plan.endpoint}`);
  console.log(`  licence          ${plan.license}  (${plan.licenseUrl})`);
  console.log(`  rate limit       ${plan.rateLimit}`);
  console.log(`  bounded limit    ${plan.limit}`);
  console.log(`  requests         ${plan.estimatedRequests}`);
  console.log(`  estimated size   ${(plan.estimatedBytes / 1024).toFixed(0)} KiB`);
  console.log(`  destination      ${plan.destination}`);
  console.log("  request:");
  for (const line of plan.request.split("\n")) console.log(`    ${line}`);

  if (flag("dry-run")) {
    console.log("\nDRY RUN — nothing was fetched, nothing was written.");
    return;
  }

  const result =
    source === "gleif"
      ? await gleif.collectGleif({ jurisdiction: arg("jurisdiction") ?? "IN" }, options)
      : await wikidata.collectWikidata(
          (query ?? "indian-companies-with-lei") as WikidataQueryName,
          options,
        );

  const retrievedAt = new Date().toISOString();
  const dir = path.join(ROOT, "data", "public", "raw", plan.sourceId, retrievedAt.replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });

  const recordsPath = path.join(dir, "public-records.json");
  fs.writeFileSync(recordsPath, JSON.stringify(result.records, null, 2) + "\n");
  fs.writeFileSync(
    path.join(dir, "manifest.json"),
    JSON.stringify(
      {
        sourceId: plan.sourceId,
        endpoint: plan.endpoint,
        request: plan.request,
        license: plan.license,
        licenseUrl: plan.licenseUrl,
        retrievedAt,
        rawSha256: result.rawSha256,
        rawBytes: result.rawBytes,
        recordCount: result.records.length,
        recordsSha256: crypto
          .createHash("sha256")
          .update(fs.readFileSync(recordsPath))
          .digest("hex"),
        warnings: result.warnings,
      },
      null,
      2,
    ) + "\n",
  );

  console.log(`\nCollected ${result.records.length} records → ${path.relative(ROOT, dir)}`);
  for (const warning of result.warnings) console.log(`  warning: ${warning}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
