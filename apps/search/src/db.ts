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

const REQUIRED_COLUMNS = {
  schema_migrations: "version checksum applied_at",
  search_requests: "seq id created_at frozen_at limits_snapshot",
  title_inputs:
    "seq id request_id position original_title search_title year work_type resolution_state unresolved_reason selected_candidate_id selected_at",
  resolution_candidates:
    "seq id input_id attempt_id ordinal provider provider_media_type provider_id title original_title work_type release_date original_language origin_countries retrieved_at eligible ineligible_reason warning_codes",
  works:
    "seq id provider provider_media_type provider_id title original_title work_type release_date original_language origin_countries identity_url retrieved_at created_at",
  request_works: "seq request_id work_id selected_candidate_id",
  sources: "seq id normalized_url source_host created_at processing_permission display_permission",
  search_records: "seq id request_id work_id source_id first_found_at",
  source_observations:
    "seq id search_record_id attempt_id provider_result_id ordinal original_url title author publisher publication_date observed_at metadata_policy_revision warning_codes",
  operations: "seq id request_id kind input_id work_id state current_attempt_id",
  operation_attempts:
    "seq id operation_id attempt_number state started_at deadline_at finished_at provider query query_context template_version provider_request_id error_code retry_at returned_count retained_count rejected_count limit_flags notice_codes",
  rejected_results: "seq id attempt_id ordinal reason_code",
};

const REQUIRED_TRIGGERS = [
  "candidate_attempt_ownership",
  "selection_eligibility",
  "membership_candidate_ownership",
  "membership_candidate_update_ownership",
  "candidates_no_update",
  "candidates_no_delete",
  "attempt_provider_ownership",
  "observation_attempt_ownership",
  "observations_no_update",
  "observations_no_delete",
];

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
  const tableColumns = db.query<{ name: string }, [string]>(
    "SELECT name FROM pragma_table_info(?)",
  );
  for (const [table, required] of Object.entries(REQUIRED_COLUMNS)) {
    const columns = new Set(tableColumns.all(table).map(({ name }) => name));
    if (required.split(" ").some((name) => !columns.has(name)))
      throw new StorageError("schema_invalid");
  }
  const triggers = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'trigger'")
      .all()
      .map(({ name }) => name),
  );
  if (
    REQUIRED_TRIGGERS.some((name) => !triggers.has(name)) ||
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
