import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * The LLM response cache, implementing the strengthened cache contract
 * in docs/architecture/technology-stack.md §3 ("LLM Response Cache —
 * determinism and offline replay").
 *
 * The key is deliberately NOT a hash of the input alone. An input-only
 * key would happily serve a response generated under a prompt, schema,
 * or model that has since changed — which defeats the reproducibility
 * requirement (docs/requirements.md §6) the cache exists to satisfy.
 * The composite key covers every input that can change what the model
 * returns:
 *
 *   - model id / version        (a model swap must MISS)
 *   - prompt version            (editing a prompt template must MISS)
 *   - tool / output schema version (tightening the schema must MISS)
 *   - normalized input          (whitespace/ordering-stable, so
 *                                semantically identical input HITS)
 *   - generation configuration  (max_tokens, temperature, effort, …)
 *
 * A lookup is a hit only when ALL of those match. Every stored entry
 * carries the full metadata table the contract mandates (`model`,
 * `modelVersion`, `promptVersion`, `schemaVersion`, `inputHash`,
 * `response`, `createdAt`) so a record is self-describing on disk and a
 * manual invalidation sweep can be done by reading the files alone.
 *
 * Entries live on disk (not in SQLite) so the cache survives a database
 * wipe and can be inspected/pruned with ordinary file tools. The
 * directory is `${LLM_CACHE_DIR}` when set, else `./data/llm-cache`.
 * Nothing here reaches the network, and nothing here ever reads
 * `evidence/ground-truth/`.
 */

/** The generation configuration that materially affects a model's output. */
export interface GenerationConfig {
  maxTokens: number;
  temperature: number;
  /** Any additional, output-affecting knob (e.g. `effort`), sorted before hashing. */
  extra?: Record<string, string | number | boolean>;
}

export interface CacheIdentity {
  /** Logical model name, e.g. "claude-opus-5". */
  model: string;
  /** The exact model id string sent to the API. */
  modelVersion: string;
  /** Version identifier of the prompt template used. */
  promptVersion: string;
  /** Version identifier of the tool/output schema that constrained the response. */
  schemaVersion: string;
  /** The raw (un-normalized) input content — normalized here before hashing. */
  input: string;
  generationConfig: GenerationConfig;
}

export interface CacheEntry<T = unknown> {
  /** The composite cache key this entry is stored under. */
  key: string;
  model: string;
  modelVersion: string;
  promptVersion: string;
  schemaVersion: string;
  /** Hash of the normalized input, for lookup and for detecting an input change independently. */
  inputHash: string;
  generationConfig: GenerationConfig;
  /** The full response payload, in the shape the calling stage expects. */
  response: T;
  /** Creation timestamp, for audit and manual cache-invalidation sweeps. */
  createdAt: string;
}

export type CacheOutcome = "hit" | "miss" | "bypass";

/**
 * Whitespace- and ordering-stable normalization, so two semantically
 * identical inputs hash to the same entry: CRLF → LF, runs of spaces
 * and tabs collapsed, trailing whitespace per line removed, blank lines
 * collapsed, and the whole string trimmed.
 */
export function normalizeInput(input: string): string {
  return input
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** A stable, key-sorted JSON encoding so property order never changes a key. */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function hashInput(input: string): string {
  return sha256(normalizeInput(input));
}

/**
 * The composite cache key. Changing ANY component — model, prompt
 * version, schema version, normalized input, or generation config —
 * yields a different key, and therefore a miss.
 */
export function buildCacheKey(identity: CacheIdentity): string {
  const inputHash = hashInput(identity.input);
  const composite = canonicalJson({
    model: identity.model,
    modelVersion: identity.modelVersion,
    promptVersion: identity.promptVersion,
    schemaVersion: identity.schemaVersion,
    inputHash,
    generationConfig: identity.generationConfig,
  });
  return sha256(composite);
}

export function cacheDir(): string {
  return process.env.LLM_CACHE_DIR ?? path.join(process.cwd(), "data", "llm-cache");
}

/** Entries are bucketed by prompt version so a prompt edit's entries can be swept by directory. */
function entryPath(promptVersion: string, key: string): string {
  const bucket = promptVersion.replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(cacheDir(), bucket, `${key}.json`);
}

/**
 * Reads a cached response. Returns null on a miss, on an unreadable or
 * malformed file, or when the stored entry's own metadata disagrees
 * with the identity being looked up (a corrupted/hand-edited entry must
 * never be served as if it matched).
 */
export function readCache<T>(identity: CacheIdentity): CacheEntry<T> | null {
  const key = buildCacheKey(identity);
  const file = entryPath(identity.promptVersion, key);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    const matches =
      parsed &&
      typeof parsed === "object" &&
      parsed.key === key &&
      parsed.model === identity.model &&
      parsed.modelVersion === identity.modelVersion &&
      parsed.promptVersion === identity.promptVersion &&
      parsed.schemaVersion === identity.schemaVersion &&
      parsed.inputHash === hashInput(identity.input);
    return matches ? parsed : null;
  } catch {
    return null;
  }
}

/** Writes a cached response, creating the bucket directory as needed. */
export function writeCache<T>(identity: CacheIdentity, response: T): CacheEntry<T> {
  const key = buildCacheKey(identity);
  const entry: CacheEntry<T> = {
    key,
    model: identity.model,
    modelVersion: identity.modelVersion,
    promptVersion: identity.promptVersion,
    schemaVersion: identity.schemaVersion,
    inputHash: hashInput(identity.input),
    generationConfig: identity.generationConfig,
    response,
    createdAt: new Date().toISOString(),
  };
  const file = entryPath(identity.promptVersion, key);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`, "utf-8");
  return entry;
}
