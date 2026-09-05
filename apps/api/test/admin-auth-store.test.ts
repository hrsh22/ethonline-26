import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import { openAdminAuthStore } from "../src/admin-auth-store.js";

const deploymentFingerprint = `0x${"11".repeat(32)}` as const;
const address = "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5";
const temporaryDirectories: string[] = [];

const temporaryDatabasePath = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "orbit-admin-auth-"));
  temporaryDirectories.push(directory);
  return join(directory, "auth.sqlite");
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("admin authentication store", () => {
  it("refuses to serve auth state from a database with failed integrity", () => {
    const path = temporaryDatabasePath();
    const corrupt = new DatabaseSync(path);
    corrupt.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT;
      CREATE TABLE child (
        parent_id INTEGER NOT NULL REFERENCES parent(id)
      ) STRICT;
      INSERT INTO child (parent_id) VALUES (1);
    `);
    corrupt.close();

    expect(() => {
      const store = openAdminAuthStore(path, { deploymentFingerprint });
      store.close();
    }).toThrow("Admin auth SQLite foreign-key check failed");
    for (const file of [path, `${path}-wal`, `${path}-shm`].filter(
      existsSync,
    )) {
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
  });

  it("persists an active challenge across restart and expires it at its deadline", () => {
    const path = temporaryDatabasePath();
    let store = openAdminAuthStore(path, { deploymentFingerprint });
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 1_500,
      issuedAt: 1_000,
      nonce: "ab".repeat(32),
    });
    store.close();

    store = openAdminAuthStore(path, { deploymentFingerprint });
    expect(store.readChallenge("ab".repeat(32), 1_499)).toEqual({
      address,
      deploymentFingerprint,
      expiresAt: 1_500,
      issuedAt: 1_000,
    });
    expect(store.readChallenge("ab".repeat(32), 1_500)).toBeUndefined();
    store.close();
  });

  it("stores only a challenge hash in owner-only database files", () => {
    const path = temporaryDatabasePath();
    const nonce = "raw-challenge-nonce-that-must-not-reach-sqlite";
    const store = openAdminAuthStore(path, { deploymentFingerprint });
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 1_500,
      issuedAt: 1_000,
      nonce,
    });
    store.close();

    expect(readFileSync(path).includes(Buffer.from(nonce))).toBe(false);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("atomically consumes one challenge into exactly one active session", () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 2_000,
      issuedAt: 1_000,
      nonce: "ab".repeat(32),
    });
    const session = {
      address,
      bindingsFingerprint: `0x${"22".repeat(32)}` as const,
      createdAt: 1_100,
      csrfToken: "cd".repeat(32),
      expiresAt: 1_900,
      sessionHandle: "ef".repeat(32),
    } as const;

    expect(
      store.consumeChallengeAndCreateSession({
        ...session,
        nonce: "ab".repeat(32),
        now: 1_100,
      }),
    ).toBe(true);
    expect(
      store.consumeChallengeAndCreateSession({
        ...session,
        nonce: "ab".repeat(32),
        now: 1_100,
        sessionHandle: "01".repeat(32),
      }),
    ).toBe(false);
    expect(store.readSession("ef".repeat(32), 1_899)).toEqual({
      address,
      bindingsFingerprint: `0x${"22".repeat(32)}`,
      createdAt: 1_100,
      deploymentFingerprint,
      expiresAt: 1_900,
    });
    expect(store.readSession("01".repeat(32), 1_899)).toBeUndefined();
    expect(store.readSession("ef".repeat(32), 1_900)).toBeUndefined();
    store.close();
  });

  it("reclaims expired terminal records without weakening their replay barrier", () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const nonce = "ab".repeat(32);
    const sessionHandle = "ef".repeat(32);
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 2_000,
      issuedAt: 1_000,
      nonce,
    });
    expect(
      store.consumeChallengeAndCreateSession({
        address,
        bindingsFingerprint: `0x${"22".repeat(32)}`,
        createdAt: 1_100,
        csrfToken: "cd".repeat(32),
        expiresAt: 1_900,
        nonce,
        now: 1_100,
        sessionHandle,
      }),
    ).toBe(true);
    expect(() =>
      store.createChallenge({
        address,
        deploymentFingerprint,
        expiresAt: 3_000,
        issuedAt: 1_999,
        nonce,
      }),
    ).toThrow();
    expect(store.revokeSession(sessionHandle, 1_200)).toBe(true);

    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 3_000,
      issuedAt: 2_000,
      nonce: "01".repeat(32),
    });
    expect(() =>
      store.createChallenge({
        address,
        deploymentFingerprint,
        expiresAt: 3_000,
        issuedAt: 2_000,
        nonce,
      }),
    ).not.toThrow();
    expect(
      store.consumeChallengeAndCreateSession({
        address,
        bindingsFingerprint: `0x${"22".repeat(32)}`,
        createdAt: 2_001,
        csrfToken: "23".repeat(32),
        expiresAt: 2_900,
        nonce,
        now: 2_001,
        sessionHandle,
      }),
    ).toBe(true);
    store.close();
  });

  it("persists CSRF-protected revocation across restart", () => {
    const path = temporaryDatabasePath();
    const nonce = "ab".repeat(32);
    const sessionHandle = "ef".repeat(32);
    const csrfToken = "cd".repeat(32);
    let store = openAdminAuthStore(path, { deploymentFingerprint });
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 2_000,
      issuedAt: 1_000,
      nonce,
    });
    expect(
      store.consumeChallengeAndCreateSession({
        address,
        bindingsFingerprint: `0x${"22".repeat(32)}`,
        createdAt: 1_100,
        csrfToken,
        expiresAt: 1_900,
        nonce,
        now: 1_100,
        sessionHandle,
      }),
    ).toBe(true);
    store.close();

    store = openAdminAuthStore(path, { deploymentFingerprint });
    expect(store.matchesCsrf(sessionHandle, csrfToken, 1_200)).toBe(true);
    expect(store.matchesCsrf(sessionHandle, "bad-token", 1_200)).toBe(false);
    expect(store.revokeSession(sessionHandle, 1_200)).toBe(true);
    expect(store.readSession(sessionHandle, 1_201)).toBeUndefined();
    store.close();

    store = openAdminAuthStore(path, { deploymentFingerprint });
    expect(store.readSession(sessionHandle, 1_201)).toBeUndefined();
    store.close();
  });

  it("permanently revokes sessions and challenges when the deployment fingerprint drifts", () => {
    const path = temporaryDatabasePath();
    const nonce = "ab".repeat(32);
    const sessionHandle = "ef".repeat(32);
    let store = openAdminAuthStore(path, { deploymentFingerprint });
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 2_000,
      issuedAt: 1_000,
      nonce,
    });
    expect(
      store.consumeChallengeAndCreateSession({
        address,
        bindingsFingerprint: `0x${"22".repeat(32)}`,
        createdAt: 1_100,
        csrfToken: "cd".repeat(32),
        expiresAt: 1_900,
        nonce,
        now: 1_100,
        sessionHandle,
      }),
    ).toBe(true);
    store.close();

    const replacementFingerprint = `0x${"33".repeat(32)}` as const;
    store = openAdminAuthStore(path, {
      deploymentFingerprint: replacementFingerprint,
    });
    expect(store.readSession(sessionHandle, 1_200)).toBeUndefined();
    expect(store.readChallenge(nonce, 1_200)).toBeUndefined();
    store.close();

    store = openAdminAuthStore(path, { deploymentFingerprint });
    expect(store.readSession(sessionHandle, 1_200)).toBeUndefined();
    store.close();
  });

  it("keeps every raw bearer secret out of hardened WAL storage", () => {
    const path = temporaryDatabasePath();
    const secrets = {
      csrfToken: "raw-csrf-token-that-must-not-reach-sqlite",
      nonce: "raw-nonce-that-must-not-reach-sqlite",
      sessionHandle: "raw-session-handle-that-must-not-reach-sqlite",
    };
    const store = openAdminAuthStore(path, { deploymentFingerprint });
    store.createChallenge({
      address,
      deploymentFingerprint,
      expiresAt: 2_000,
      issuedAt: 1_000,
      nonce: secrets.nonce,
    });
    expect(
      store.consumeChallengeAndCreateSession({
        address,
        bindingsFingerprint: `0x${"22".repeat(32)}`,
        createdAt: 1_100,
        csrfToken: secrets.csrfToken,
        expiresAt: 1_900,
        nonce: secrets.nonce,
        now: 1_100,
        sessionHandle: secrets.sessionHandle,
      }),
    ).toBe(true);

    const files = [path, `${path}-wal`, `${path}-shm`];
    expect(existsSync(`${path}-wal`)).toBe(true);
    for (const file of files.filter(existsSync)) {
      const contents = readFileSync(file);
      for (const secret of Object.values(secrets)) {
        expect(contents.includes(Buffer.from(secret))).toBe(false);
      }
      expect(statSync(file).mode & 0o777).toBe(0o600);
    }
    store.close();
  });
});
