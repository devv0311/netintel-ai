import fs from "node:fs";
import path from "node:path";

/**
 * Wipes the end-to-end SQLite database before the Playwright run so the
 * ingestion workflow starts from a genuine empty state (and the
 * "before ingestion" evidence is really the empty workspace). The dev
 * server started by playwright.config.ts is pointed at this file via
 * DATABASE_URL.
 */
async function globalSetup(): Promise<void> {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(dir, { recursive: true });
  for (const name of [
    "netintel-e2e.db",
    "netintel-e2e.db-wal",
    "netintel-e2e.db-shm",
  ]) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
}

export default globalSetup;
