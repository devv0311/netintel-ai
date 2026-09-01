import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * A minimal, dependency-free resolve hook so `node` can run a TypeScript
 * script in scripts/ that imports the extensionless relative paths the
 * rest of src/ uses (Next.js / Vitest resolve those with bundler
 * resolution; bare Node does not). Node 26 strips the type annotations
 * itself — this only teaches it that `./foo` may mean `./foo.ts`.
 *
 * Used by `npm run corpus:generate` (see package.json).
 */

const EXTENSIONS = [".ts", ".tsx", ".mts", ".js", ".mjs"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    const isRelative =
      specifier.startsWith("./") || specifier.startsWith("../");
    const hasExtension = /\.[cm]?[jt]sx?$/.test(specifier);
    if (isRelative && !hasExtension) {
      try {
        const base = fileURLToPath(new URL(specifier, context.parentURL));
        for (const ext of EXTENSIONS) {
          if (existsSync(base + ext)) {
            return nextResolve(specifier + ext, context);
          }
        }
      } catch {
        // fall through to default resolution
      }
    }
    return nextResolve(specifier, context);
  },
});
