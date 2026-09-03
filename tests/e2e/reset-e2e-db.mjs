import fs from "node:fs";
import path from "node:path";

/**
 * Wipes the end-to-end SQLite database so the Playwright run starts from
 * a genuine empty state (and the "before ingestion" evidence is really
 * the empty workspace). The dev server started by playwright.config.ts
 * is pointed at this file via DATABASE_URL.
 *
 * This runs as the first half of `webServer.command`, NOT as Playwright's
 * `globalSetup`, and that ordering is the whole point: Playwright starts
 * the web server BEFORE globalSetup, and the server opens (and migrates)
 * the database as soon as it serves the readiness request. By the time a
 * globalSetup hook ran, the file was already held open — which is
 * invisible on macOS, where an open file can still be unlinked, and
 * fails with EPERM on Windows, taking down the whole suite before a
 * single test runs. Deleting it here, before `next dev` is spawned, is
 * the only point at which nothing holds a handle to it.
 */
const dir = path.join(process.cwd(), "data");
fs.mkdirSync(dir, { recursive: true });

for (const name of ["netintel-e2e.db", "netintel-e2e.db-wal", "netintel-e2e.db-shm"]) {
  fs.rmSync(path.join(dir, name), { force: true });
}
