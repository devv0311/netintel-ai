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

export function getDb() {
  if (!dbInstance) {
    const env = getEnv();
    const dbPath = env.DATABASE_URL;

    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    dbInstance = drizzle({ connection: { path: dbPath } });
    migrate(dbInstance, { migrationsFolder: "./drizzle" });
  }
  return dbInstance;
}
