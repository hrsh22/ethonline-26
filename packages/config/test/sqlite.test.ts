import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { configureSqlite, verifySqliteIntegrity } from "../src/sqlite.js";

const temporaryDirectories: string[] = [];

const databaseFile = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-admin-auth-sqlite-"));
  temporaryDirectories.push(directory);
  return join(directory, "auth.sqlite");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("shared SQLite hardening", () => {
  it.each(["3.51.2", "3.51.vendor"])(
    "rejects unsafe or unparseable SQLite version %s",
    (version) => {
      const database = new DatabaseSync(":memory:");
      try {
        database.function("sqlite_version", () => version);
        expect(() => configureSqlite(database, "Test", { wal: false })).toThrow(
          `Test SQLite ${version} is unsafe for WAL; version 3.51.3 or newer is required`,
        );
      } finally {
        database.close();
      }
    },
  );

  it("configures a safe engine for durable WAL storage", () => {
    const database = new DatabaseSync(databaseFile());
    try {
      configureSqlite(database, "Test");

      expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({
        journal_mode: "wal",
      });
      expect(database.prepare("PRAGMA foreign_keys").get()).toMatchObject({
        foreign_keys: 1,
      });
      expect(database.prepare("PRAGMA synchronous").get()).toMatchObject({
        synchronous: 2,
      });
      expect(() => verifySqliteIntegrity(database, "Test")).not.toThrow();
    } finally {
      database.close();
    }
  });

  it("fails integrity verification when persisted foreign keys are corrupt", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        PRAGMA foreign_keys = OFF;
        CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
        CREATE TABLE child (
          parent_id INTEGER NOT NULL REFERENCES parent(id)
        ) STRICT;
        INSERT INTO child (parent_id) VALUES (1);
        PRAGMA foreign_keys = ON;
      `);

      expect(() => verifySqliteIntegrity(database, "Test")).toThrow(
        "Test SQLite foreign-key check failed",
      );
    } finally {
      database.close();
    }
  });
});
