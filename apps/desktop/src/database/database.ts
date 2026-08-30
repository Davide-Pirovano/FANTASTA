import { DatabaseSync } from "node:sqlite";
import { MIGRATIONS, type Migration } from "./migrations.js";

export type LocalDatabase = DatabaseSync;

export function withImmediateTransaction<T>(database: LocalDatabase, operation: () => T): T {
  database.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    database.exec("COMMIT");
    return result;
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}

function applyMigration(database: LocalDatabase, migration: Migration) {
  const applied = database
    .prepare("SELECT 1 FROM schema_migrations WHERE version = ?")
    .get(migration.version);
  if (applied) return;

  withImmediateTransaction(database, () => {
    database.exec(migration.sql);
    database
      .prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)")
      .run(migration.version, migration.name);
  });
}

export function openLocalDatabase(path: string): LocalDatabase {
  const database = new DatabaseSync(path, {
    enableForeignKeyConstraints: true,
    enableDoubleQuotedStringLiterals: false,
    timeout: 5_000,
  });

  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = NORMAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA trusted_schema = OFF");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `);

  for (const migration of MIGRATIONS) applyMigration(database, migration);
  return database;
}
