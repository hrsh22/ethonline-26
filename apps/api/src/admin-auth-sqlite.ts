import type { DatabaseSync, SQLOutputValue } from "node:sqlite";

const MINIMUM_SAFE_WAL_VERSION = [3, 51, 3] as const;

const text = (value: SQLOutputValue | undefined, label: string): string => {
  if (typeof value !== "string") throw new TypeError(`${label} is not text`);
  return value;
};

const versionSupportsSafeWal = (version: string): boolean => {
  const parts = version.split(".").map(Number);
  if (
    parts.length !== MINIMUM_SAFE_WAL_VERSION.length ||
    parts.some((part) => !Number.isSafeInteger(part) || part < 0)
  ) {
    return false;
  }
  for (const [index, minimum] of MINIMUM_SAFE_WAL_VERSION.entries()) {
    const actual = parts[index] ?? 0;
    if (actual > minimum) return true;
    if (actual < minimum) return false;
  }
  return true;
};

export const configureAdminAuthSqlite = (
  database: DatabaseSync,
  { wal }: { readonly wal: boolean },
): void => {
  database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  const version = text(
    database.prepare("SELECT sqlite_version() AS version").get()?.version,
    "sqlite_version",
  );
  if (!versionSupportsSafeWal(version)) {
    throw new Error(
      `Admin auth SQLite ${version} is unsafe for WAL; version 3.51.3 or newer is required`,
    );
  }
  if (wal) {
    const journal = text(
      database.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode,
      "journal_mode",
    );
    if (journal.toLowerCase() !== "wal") {
      throw new Error("Admin auth SQLite did not enter WAL journal mode");
    }
  }
  database.exec("PRAGMA synchronous = FULL;");
};

export const verifyAdminAuthSqliteIntegrity = (
  database: DatabaseSync,
): void => {
  const checks = database
    .prepare("PRAGMA quick_check")
    .all()
    .map((value) => text(value?.quick_check, "quick_check"));
  if (checks.length !== 1 || checks[0] !== "ok") {
    throw new Error(
      `Admin auth SQLite quick_check failed: ${checks.join(", ")}`,
    );
  }
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("Admin auth SQLite foreign-key check failed");
  }
};
