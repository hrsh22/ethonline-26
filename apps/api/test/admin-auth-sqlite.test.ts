import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  configureAdminAuthSqlite,
  verifyAdminAuthSqliteIntegrity,
} from "../src/admin-auth-sqlite.js";

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

describe("admin authentication SQLite hardening", () => {
  it.each(["3.51.2", "3.51.vendor"])(
    "rejects unsafe or unparseable SQLite version %s",
    (version) => {
      const database = {
        exec: vi.fn(),
        prepare: vi.fn(() => ({ get: () => ({ version }) })),
      } as unknown as DatabaseSync;

      expect(() => configureAdminAuthSqlite(database, { wal: false })).toThrow(
        `Admin auth SQLite ${version} is unsafe for WAL; version 3.51.3 or newer is required`,
      );
    },
  );

  it("configures a safe engine for durable WAL storage", () => {
    const database = new DatabaseSync(databaseFile());
    try {
      configureAdminAuthSqlite(database, { wal: true });

      expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({
        journal_mode: "wal",
      });
      expect(database.prepare("PRAGMA foreign_keys").get()).toMatchObject({
        foreign_keys: 1,
      });
      expect(database.prepare("PRAGMA synchronous").get()).toMatchObject({
        synchronous: 2,
      });
      expect(() => verifyAdminAuthSqliteIntegrity(database)).not.toThrow();
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

      expect(() => verifyAdminAuthSqliteIntegrity(database)).toThrow(
        "Admin auth SQLite foreign-key check failed",
      );
    } finally {
      database.close();
    }
  });
});
