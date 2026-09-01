import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

/**
 * Minimal placeholder schema proving the SQLite + Drizzle + node:sqlite
 * wiring end to end. This is intentionally NOT the investigation schema
 * (evidence, entities, relationships, provenance tables) — that belongs
 * to Workstream B/C/D per docs/implementation-blueprint.md and is built
 * in a later milestone once those pipeline stages are implemented.
 */
export const appMeta = sqliteTable("app_meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .$defaultFn(() => new Date()),
});
