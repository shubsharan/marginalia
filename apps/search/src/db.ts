import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { APP_DIRECTORY, loadConfig } from "./config.ts";

export type Migration = { version: number; sql: string };

type StorageCode =
  | "storage_unavailable"
  | "schema_migrations_invalid"
  | "schema_migration_required"
  | "schema_checksum_mismatch"
  | "schema_newer_than_runtime"
  | "schema_invalid";

export class StorageError extends Error {
  constructor(readonly code: StorageCode) {
    super(code);
    this.name = "StorageError";
  }
}

function storageError(error: unknown): StorageError {
  return error instanceof StorageError ? error : new StorageError("storage_unavailable");
}

export function loadMigrations(): Migration[] {
  try {
    const directory = join(APP_DIRECTORY, "migrations");
    return readdirSync(directory)
      .filter((name) => name.endsWith(".sql"))
      .sort()
      .map((name) => {
        const match = /^(\d{3,})_[a-z0-9_]+\.sql$/.exec(name);
        if (!match) throw new StorageError("schema_migrations_invalid");
        return { version: Number(match[1]), sql: readFileSync(join(directory, name), "utf8") };
      });
  } catch (error) {
    throw storageError(error);
  }
}

function validateMigrations(migrations: readonly Migration[]) {
  if (
    migrations.length === 0 ||
    migrations.some(
      (migration, index) => migration.version !== index + 1 || migration.sql.trim().length === 0,
    )
  ) {
    throw new StorageError("schema_migrations_invalid");
  }
}

function checksum(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

function configure(db: Database) {
  db.run("PRAGMA foreign_keys = ON");
  db.run("PRAGMA journal_mode = WAL");
  db.run("PRAGMA synchronous = FULL");
  if (
    db.query<{ foreign_keys: number }, []>("PRAGMA foreign_keys").get()?.foreign_keys !== 1 ||
    db.query<{ journal_mode: string }, []>("PRAGMA journal_mode").get()?.journal_mode !== "wal" ||
    db.query<{ synchronous: number }, []>("PRAGMA synchronous").get()?.synchronous !== 2
  ) {
    throw new StorageError("storage_unavailable");
  }
}

function appliedVersion(db: Database, migrations: readonly Migration[]) {
  const tables = db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all();
  if (!tables.some(({ name }) => name === "schema_migrations")) {
    if (tables.length > 0) throw new StorageError("schema_invalid");
    return 0;
  }
  const applied = db
    .query<{ version: number; checksum: string }, []>(
      "SELECT version, checksum FROM schema_migrations ORDER BY version",
    )
    .all();
  if (applied.some(({ version }) => version > migrations.length))
    throw new StorageError("schema_newer_than_runtime");
  for (const [index, record] of applied.entries()) {
    const migration = migrations[index];
    if (!migration || record.version !== index + 1) throw new StorageError("schema_invalid");
    if (record.checksum !== checksum(migration.sql))
      throw new StorageError("schema_checksum_mismatch");
  }
  return applied.length;
}

function verifySchema(db: Database, migrations: readonly Migration[]) {
  if (appliedVersion(db, migrations) !== migrations.length)
    throw new StorageError("schema_migration_required");
  if (
    db.query("PRAGMA foreign_key_check").all().length > 0 ||
    db.query<{ quick_check: string }, []>("PRAGMA quick_check").get()?.quick_check !== "ok"
  ) {
    throw new StorageError("schema_invalid");
  }
}

export function migrateDatabase(
  path: string,
  migrations: readonly Migration[] = loadMigrations(),
): void {
  validateMigrations(migrations);
  let db: Database | undefined;
  try {
    mkdirSync(dirname(path), { recursive: true });
    db = new Database(path, { create: true, strict: true });
    configure(db);
    const connection = db;
    connection
      .transaction(() => {
        const version = appliedVersion(connection, migrations);
        for (const migration of migrations.slice(version)) {
          connection.run(migration.sql);
          connection.run("INSERT INTO schema_migrations (version, checksum) VALUES (?, ?)", [
            migration.version,
            checksum(migration.sql),
          ]);
        }
        verifySchema(connection, migrations);
      })
      .immediate();
  } catch (error) {
    throw storageError(error);
  } finally {
    db?.close();
  }
}

export function openDatabase(
  path: string,
  migrations: readonly Migration[] = loadMigrations(),
): Database {
  validateMigrations(migrations);
  let db: Database | undefined;
  try {
    db = new Database(path, { readwrite: true, create: false, strict: true });
    configure(db);
    verifySchema(db, migrations);
    return db;
  } catch (error) {
    db?.close();
    throw storageError(error);
  }
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 3 || process.argv[2] !== "--migrate") {
      process.stderr.write("Usage: bun src/db.ts --migrate\n");
      process.exitCode = 1;
    } else {
      migrateDatabase(loadConfig().databasePath);
      process.stdout.write('{"migrated":true}\n');
    }
  } catch (error) {
    process.stderr.write(
      JSON.stringify({
        error: {
          code: storageError(error).code,
          message: "Storage initialization failed; existing data was preserved.",
        },
      }) + "\n",
    );
    process.exitCode = 1;
  }
}
