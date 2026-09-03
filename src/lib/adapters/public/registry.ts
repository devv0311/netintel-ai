import fs from "node:fs";
import path from "node:path";

/**
 * The collector's gate: a source is reachable only if the research
 * registry says so.
 *
 * This is what makes governance rule 1.1 ("no indiscriminate scraping")
 * enforceable in code rather than by convention. There is deliberately
 * NO free-URL parameter anywhere in this module or its callers — an
 * adapter is addressed by `source_id`, the endpoint is a constant inside
 * the adapter, and a source whose registry `status` is not APPROVED or
 * APPROVED_WITH_RESTRICTIONS is refused before a socket is opened.
 *
 * The registry is read from disk at call time, not compiled in, so
 * revoking a source is a CSV edit rather than a code change.
 */

export const SOURCE_REGISTRY_PATH = "docs/data-research/source-registry.csv";

const ALLOWED_STATUSES = new Set(["APPROVED", "APPROVED_WITH_RESTRICTIONS"]);

export interface RegistryEntry {
  sourceId: string;
  sourceName: string;
  license: string;
  licenseUrl: string;
  status: string;
  rateLimit: string;
  trainingUse: string;
  redistribution: string;
}

/** Minimal RFC4180 reader — the registry is quoted CSV with embedded commas and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.length > 0));
}

export function loadRegistry(root = process.cwd()): Map<string, RegistryEntry> {
  const rows = parseCsv(fs.readFileSync(path.join(root, SOURCE_REGISTRY_PATH), "utf8"));
  const header = rows[0] ?? [];
  const col = (name: string) => header.indexOf(name);
  const idx = {
    sourceId: col("source_id"),
    sourceName: col("source_name"),
    license: col("license"),
    licenseUrl: col("license_url"),
    status: col("status"),
    rateLimit: col("rate_limit"),
    trainingUse: col("training_use"),
    redistribution: col("redistribution"),
  };
  const out = new Map<string, RegistryEntry>();
  for (const row of rows.slice(1)) {
    const entry: RegistryEntry = {
      sourceId: row[idx.sourceId] ?? "",
      sourceName: row[idx.sourceName] ?? "",
      license: row[idx.license] ?? "",
      licenseUrl: row[idx.licenseUrl] ?? "",
      status: row[idx.status] ?? "",
      rateLimit: row[idx.rateLimit] ?? "",
      trainingUse: row[idx.trainingUse] ?? "",
      redistribution: row[idx.redistribution] ?? "",
    };
    if (entry.sourceId) out.set(entry.sourceId, entry);
  }
  return out;
}

export class SourceNotApprovedError extends Error {
  constructor(sourceId: string, reason: string) {
    super(`Source ${sourceId} refused: ${reason}`);
    this.name = "SourceNotApprovedError";
  }
}

/**
 * Returns the registry entry for `sourceId`, or throws. Throwing rather
 * than returning null is deliberate: a caller cannot accidentally
 * proceed on a falsy value.
 */
export function requireApprovedSource(sourceId: string, root = process.cwd()): RegistryEntry {
  const entry = loadRegistry(root).get(sourceId);
  if (!entry) {
    throw new SourceNotApprovedError(sourceId, `not present in ${SOURCE_REGISTRY_PATH}`);
  }
  if (!ALLOWED_STATUSES.has(entry.status)) {
    throw new SourceNotApprovedError(
      sourceId,
      `registry status is ${entry.status || "(empty)"}; only APPROVED or APPROVED_WITH_RESTRICTIONS may be collected`,
    );
  }
  return entry;
}
