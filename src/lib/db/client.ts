import path from "node:path";
import fs from "node:fs";
import { drizzle } from "drizzle-orm/node-sqlite";
import { migrate } from "drizzle-orm/node-sqlite/migrator";

import { getEnv } from "@/lib/env";

/**
 * Centralized database initialization. SQLite via Node's built-in
 * node:sqlite module (drizzle-orm/node-sqlite dialect), per
 * docs/architecture/stack-contract.md. A single module-level singleton;
 * every other module imports `db` from here rather than opening its
 * own connection.
 *
 * No `schema` is passed to `drizzle()` here because nothing yet uses
 * Drizzle's relational query API (`db.query.*`), only the core query
 * builder (`db.select()/.insert()` against tables imported directly
 * from `./schema`). Drizzle 1.0's relational config additionally
 * requires a `defineRelations` call once real relationships exist
 * between tables — add it when the investigation schema (Workstream D)
 * introduces them, not before.
 */
let dbInstance: ReturnType<typeof drizzle> | undefined;

/**
 * Every `node:sqlite` handle this process has opened, tracked on a
 * `globalThis` symbol rather than in module scope.
 *
 * The module-scope `dbInstance` singleton above is unreachable after a
 * `vi.resetModules()` — the new module graph gets a fresh `undefined`
 * while the old graph's handle stays open on the file. On macOS that is
 * invisible (an open file can still be unlinked); on Windows the next
 * `fs.rmSync` of that database fails with EPERM. Registering handles
 * globally lets `closeAllDbConnections()` reach the ones opened by
 * earlier module graphs too, so test teardown can actually release the
 * file. Application code never needs this — the connection is meant to
 * live as long as the process.
 */
const OPEN_CONNECTIONS = Symbol.for("cipher.db.openConnections");

interface ClosableConnection {
  close(): void;
}

function openConnections(): Set<ClosableConnection> {
  const globals = globalThis as typeof globalThis & {
    [OPEN_CONNECTIONS]?: Set<ClosableConnection>;
  };
  globals[OPEN_CONNECTIONS] ??= new Set<ClosableConnection>();
  return globals[OPEN_CONNECTIONS];
}

export function getDb() {
  if (!dbInstance) {
    const env = getEnv();
    const dbPath = env.DATABASE_URL;

    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    dbInstance = drizzle({ connection: { path: dbPath } });
    migrate(dbInstance, { migrationsFolder: "./drizzle" });
    openConnections().add(dbInstance.$client as ClosableConnection);
  }
  return dbInstance;
}

/**
 * Closes every SQLite handle opened by `getDb()` in this process and
 * clears the singleton, so the underlying file can be deleted.
 *
 * Intended for test teardown (and any other caller that must release
 * the database file before removing it). Already-closed handles are
 * ignored — closing twice is a no-op, not an error.
 */
export function closeAllDbConnections(): void {
  const connections = openConnections();
  for (const connection of connections) {
    try {
      connection.close();
    } catch {
      // Already closed, or closed by another module graph — either way
      // the handle is no longer holding the file open.
    }
  }
  connections.clear();
  dbInstance = undefined;
}
