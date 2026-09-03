import fs from "node:fs";
import path from "node:path";

/**
 * Test-database lifecycle helpers.
 *
 * A `node:sqlite` handle keeps the database file open until it is
 * explicitly closed. Deleting a still-open file is legal on macOS and
 * Linux but fails with `EPERM` on Windows, so every teardown that
 * removes a test database must release the handle first — otherwise the
 * suite passes on one platform and fails on another for reasons that
 * have nothing to do with the code under test.
 *
 * `closeAllDbConnections()` reaches handles opened by earlier module
 * graphs too (it tracks them on a `globalThis` symbol), which matters
 * because these suites call `vi.resetModules()` between fixtures.
 */

/** Releases every open SQLite handle, then removes `dbPath` and its WAL/SHM siblings. */
export async function releaseAndRemoveDb(dbPath: string): Promise<void> {
  const { closeAllDbConnections } = await import("@/lib/db/client");
  closeAllDbConnections();
  for (const suffix of ["", "-wal", "-shm"]) {
    fs.rmSync(dbPath + suffix, { force: true });
  }
}

/** `releaseAndRemoveDb`, plus recreating the parent directory — the shape every `beforeAll` needs. */
export async function prepareFreshDb(dbPath: string): Promise<void> {
  await releaseAndRemoveDb(dbPath);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
