import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { db } from "./index";
import * as schema from "./schema";

type Database = PostgresJsDatabase<typeof schema>;

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const drizzleDir = resolve(__dirname, "..", "..", "..", "drizzle");

/**
 * Run all pending SQL migrations from the drizzle/ directory.
 * Migrations are tracked in a `_migrations` table and applied in alphabetical order.
 * Each migration runs inside its own transaction.
 */
export async function runMigrations(
  database: Database,
): Promise<void> {
  // 1. Ensure migrations tracking table exists
  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  // 2. Fetch already-applied migration names
  const result = await database.execute(
    sql`SELECT name FROM _migrations ORDER BY name`,
  );
  const appliedSet = new Set<string>(
    (result as unknown as Array<{ name: string }>).map((r) => r.name),
  );

  // 3. Read .sql files from drizzle/ in alphabetical order
  const files = await readdir(drizzleDir);
  const sqlFiles = files.filter((f) => f.endsWith(".sql")).sort();

  // 4. Apply each unapplied migration inside its own transaction
  let applied = 0;
  for (const file of sqlFiles) {
    if (appliedSet.has(file)) continue;

    const content = await readFile(join(drizzleDir, file), "utf-8");

    await database.transaction(async (tx) => {
      await tx.execute(sql.raw(content));
      await tx.execute(sql`INSERT INTO _migrations (name) VALUES (${file})`);
    });

    applied++;
    console.log(`Applied migration: ${file}`);
  }

  if (applied === 0) {
    console.log("No pending migrations.");
  } else {
    console.log(`Applied ${applied} migration(s).`);
  }
}

/**
 * CLI entry point — run with: npx tsx src/backend/db/migrate.ts
 */
export async function runMigrationsFromCli(): Promise<void> {
  console.log("Running migrations...");
  await runMigrations(db);
  process.exit(0);
}

// Only execute when run directly (not when imported)
const isCli =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isCli) {
  runMigrationsFromCli().catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  });
}
