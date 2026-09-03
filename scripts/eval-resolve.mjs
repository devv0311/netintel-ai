import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

/**
 * Resolve hook for running a TypeScript script in scripts/ that imports
 * modules from src/ by their `@/...` alias.
 *
 * scripts/ts-resolve.mjs already teaches Node that `./foo` may mean
 * `./foo.ts`. It deliberately does not know about the `@/*` path mapping
 * in tsconfig.json, because `npm run corpus:generate` never needed it.
 * The evaluator does: every module under src/lib imports its siblings as
 * `@/lib/...`, which bare Node cannot resolve.
 *
 * This file is additive — scripts/ts-resolve.mjs is untouched and keeps
 * working exactly as before. Vitest resolves the same alias through
 * vitest.config.ts, so the metric unit tests need none of this.
 */

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, "src");
const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

/** Appends a real file extension to an extensionless path, or returns null. */
function withExtension(absPath) {
  if (/\.[cm]?[jt]sx?$/.test(absPath)) return existsSync(absPath) ? absPath : null;
  for (const ext of EXTENSIONS) {
    if (existsSync(absPath + ext)) return absPath + ext;
  }
  const index = path.join(absPath, "index");
  for (const ext of EXTENSIONS) {
    if (existsSync(index + ext)) return index + ext;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const resolved = withExtension(path.join(SRC, specifier.slice(2)));
      if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
    }
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      try {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        const resolved = withExtension(base);
        if (resolved) return { url: pathToFileURL(resolved).href, shortCircuit: true };
      } catch {
        // fall through to default resolution
      }
    }
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      // A bare package subpath written without an extension —
      // `graphology-metrics/centrality/degree`. Bundler resolution (Next,
      // Vitest) fills the extension in; bare Node ESM does not. Retry
      // once with each known extension before giving up, so the
      // evaluator can import the same modules the app does without the
      // app being changed to suit it.
      if (!specifier.startsWith(".") && !specifier.startsWith("@/") && !/\.[cm]?[jt]sx?$/.test(specifier)) {
        for (const ext of EXTENSIONS) {
          try {
            return nextResolve(specifier + ext, context);
          } catch {
            // try the next extension
          }
        }
      }
      throw error;
    }
  },
});
