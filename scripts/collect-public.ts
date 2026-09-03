/**
 * Bounded, read-only public-register collector.
 *
 *   npm run collect:public -- --source gleif --dry-run
 *   npm run collect:public -- --source wikidata --query indian-companies-with-lei --limit 30
 *   npm run collect:public -- --source gleif --from-file raw.json
 *
 * Run it through the npm script, not bare `node`. The script passes
 * --use-env-proxy, without which Node's fetch() ignores https_proxy /
 * no_proxy entirely and goes AROUND an environment's egress proxy rather
 * than through it. In a network-restricted environment that presents as a
 * puzzling `HTTP 403 Host not in allowlist` from the adapter while curl
 * against the identical URL returns 200 — which is exactly how this was
 * found, after the host had already been approved. The flag makes the
 * collector honour the environment's approved proxy; it is not a way past
 * one. Needs Node >= 22.13.
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
  const fromDir = arg("from-dir");
  // Cross-source scope. Reads LEIs out of an ALREADY-COLLECTED
  // public-records.json from another approved source, so the linkage set
  // is always derived from prior approved collection — never hand-typed,
  // never a URL, never a crawl.
  const leisFrom = arg("leis-from");
  const query = arg("query");

  if (source !== "gleif" && source !== "wikidata") {
    console.error(
      "usage: --source gleif|wikidata [--limit N] [--query NAME] [--leis-from PATH] [--from-file PATH] [--from-dir DIR] [--dry-run]",
    );
    console.error("No other source is collectable: the adapter set is the allowlist.");
    process.exitCode = 1;
    return;
  }
  if (!Number.isFinite(limit) || limit < 1) {
    console.error("--limit must be a positive integer");
    process.exitCode = 1;
    return;
  }

  let leis: string[] = [];
  if (leisFrom) {
    const prior = JSON.parse(fs.readFileSync(path.resolve(ROOT, leisFrom), "utf8")) as {
      identifiers?: { scheme: string; value: string }[];
    }[];
    leis = [
      ...new Set(
        prior.flatMap((record) =>
          (record.identifiers ?? []).filter((i) => i.scheme === "LEI").map((i) => i.value),
        ),
      ),
    ];
    console.log(`Linkage set: ${leis.length} distinct LEI(s) read from ${leisFrom}\n`);
  }

  const gleif = await import("@/lib/adapters/public/gleif");
  const wikidata = await import("@/lib/adapters/public/wikidata");
  type WikidataQueryName = keyof typeof wikidata.QUERIES;
  const options = { limit, fromFile, fromDir, root: ROOT };

  const plan =
    source === "gleif"
      ? gleif.planGleif({ jurisdiction: arg("jurisdiction") ?? "IN", leis }, options)
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
  console.log(`  channel          ${fromDir ? "agent-relay (stored payloads)" : fromFile ? "local file" : "direct-https"}`);
  console.log("  request:");
  for (const line of plan.request.split("\n")) console.log(`    ${line}`);

  if (flag("dry-run")) {
    console.log("\nDRY RUN — nothing was fetched, nothing was written.");
    return;
  }

  const result =
    source === "gleif"
      ? await gleif.collectGleif({ jurisdiction: arg("jurisdiction") ?? "IN", leis }, options)
      : await wikidata.collectWikidata(
          (query ?? "indian-companies-with-lei") as WikidataQueryName,
          options,
        );

  const retrievedAt = new Date().toISOString();
  const dir = path.join(ROOT, "data", "public", "raw", plan.sourceId, retrievedAt.replace(/[:.]/g, "-"));
  fs.mkdirSync(dir, { recursive: true });

  // Raw first, then derived. The raw payloads are the evidential root:
  // they are what rawSha256 hashes and what every derived record must be
  // auditable against.
  const rawDir = path.join(dir, "raw");
  fs.mkdirSync(rawDir, { recursive: true });
  for (const payload of result.rawPayloads) {
    fs.writeFileSync(path.join(rawDir, payload.file), payload.body);
  }

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
        retrievalChannel: result.retrievalChannel,
        // Stated in the manifest rather than left to be inferred: a
        // relayed hash is a hash of what we stored, and a reader who
        // assumes otherwise would be wrong in a way that matters.
        rawSha256Caveat:
          result.retrievalChannel === "agent-relay"
            ? "rawSha256 hashes the STORED payloads, not verified publisher wire bytes. Direct egress to the publisher was blocked by environment policy; re-run with --source gleif (direct-https) from an unrestricted network for a byte-exact hash."
            : "rawSha256 hashes the bytes received from the publisher.",
        rawSha256: result.rawSha256,
        rawBytes: result.rawBytes,
        sourcePayloads: result.sourcePayloads.map((p) => ({ ...p, storedAt: `raw/${p.file}` })),
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
  console.log(`  raw payloads kept: ${result.rawPayloads.length} in ${path.relative(ROOT, rawDir)}`);
  for (const warning of result.warnings) console.log(`  warning: ${warning}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
