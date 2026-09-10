import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AdminCapabilityFlags } from "@orbit/config/admin-auth";

import {
  createAdminAuthService,
  type AdminAuthorityReader,
} from "../src/admin-auth.js";
import { openAdminAuthStore } from "../src/admin-auth-store.js";

const address = "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5";
const deploymentFingerprint = `0x${"11".repeat(32)}` as const;
const bindingsFingerprint = `0x${"22".repeat(32)}` as const;
const observedBlock = {
  hash: `0x${"33".repeat(32)}` as const,
  number: 12_345n,
};

const capabilities = (
  overrides: Partial<AdminCapabilityFlags> = {},
): AdminCapabilityFlags => ({
  creator: false,
  guardian: false,
  keeper: false,
  liquidityExecutor: false,
  owners: {
    converter: false,
    liquidToken: false,
    liquidity: false,
    rewards: false,
  },
  recovery: false,
  ...overrides,
});

const unusedAuthorityReader: AdminAuthorityReader = {
  observe: () => Promise.reject(new Error("Block observer was not expected")),
  read: () => Promise.reject(new Error("Authority reader was not expected")),
  verify: () =>
    Promise.reject(new Error("Signature verifier was not expected")),
};

describe("admin authentication", () => {
  it("fails closed when malformed SIWE input cannot be parsed", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader: unusedAuthorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 0xab),
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      await expect(
        service.verify({
          message: null as unknown as string,
          signature: "0x1234",
        }),
      ).resolves.toEqual({ ok: false, reason: "unauthenticated" });
    } finally {
      store.close();
    }
  });

  it("issues one exact deployment-bound EIP-4361 challenge", () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader: unusedAuthorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 0xab),
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      expect(service.issueChallenge(address)).toEqual({
        expiresAt: "2026-09-05T08:05:00.000Z",
        message: `${
          "https://admin.orbit.example wants you to sign in with your Ethereum account:\n" +
          "0x8D01188806aA960F95A3fe4A343DFC26A8a7e6B5\n\n" +
          "Authorize access to the Orbit administrator console.\n\n" +
          "URI: https://admin.orbit.example/admin/sign-in\n" +
          "Version: 1\n" +
          "Chain ID: 84532\n" +
          `Nonce: ${"ab".repeat(32)}\n` +
          "Issued At: 2026-09-05T08:00:00.000Z\n" +
          "Expiration Time: 2026-09-05T08:05:00.000Z\n" +
          `Request ID: ${deploymentFingerprint}\n` +
          "Resources:\n" +
          `- urn:orbit:deployment:${"11".repeat(32)}`
        }`,
      });
    } finally {
      store.close();
    }
  });

  it("rejects an invalid signature before reading privileged role state", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const calls: string[] = [];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader: {
        observe: async () => {
          calls.push("observe");
          return observedBlock;
        },
        read: async () => {
          calls.push("read");
          throw new Error("Role state must not be read for an invalid proof");
        },
        verify: async ({ block }) => {
          calls.push("verify");
          return block === observedBlock ? false : true;
        },
      },
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => Uint8Array.from({ length: 32 }, () => 0xab),
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      await expect(
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ).resolves.toEqual({ ok: false, reason: "unauthenticated" });
      expect(calls).toEqual(["observe", "verify"]);
    } finally {
      store.close();
    }
  });

  it("creates a short session after verification and authorization at one block", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const values = [0xab, 0xcd];
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ keeper: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async ({ block }) => block === observedBlock,
    };
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift();
        if (value === undefined) throw new Error("Random sequence exhausted");
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      await expect(
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ).resolves.toEqual({
        ok: true,
        session: {
          address,
          capabilities: capabilities({ keeper: true }),
          chainId: 84_532,
          csrfToken:
            "e905df9e476a4d74b01b6bd25a13b5ef8f57be83f7bf907ea531581101242672",
          deploymentFingerprint,
          expiresAt: "2026-09-05T08:15:00.000Z",
          issuedAt: "2026-09-05T08:00:00.000Z",
          observedBlock,
          roles: ["keeper"],
        },
        sessionHandle: "cd".repeat(32),
      });
    } finally {
      store.close();
    }
  });

  it("re-reads live authority and re-presents CSRF on session introspection", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const nextBlock = {
      hash: `0x${"44".repeat(32)}` as const,
      number: 12_346n,
    };
    const blocks = [observedBlock, nextBlock];
    const authorityReader: AdminAuthorityReader = {
      observe: async () => blocks.shift() ?? nextBlock,
      read: async (_address, block) => ({
        bindingsFingerprint,
        block,
        capabilities: capabilities({ recovery: true }),
        consoleRoles: ["recovery"],
      }),
      verify: async ({ block }) => block === observedBlock,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const verified = await service.verify({
        message: challenge.message,
        signature: "0x1234",
      });
      if (!verified.ok) throw new Error("Expected session creation to succeed");

      await expect(
        service.authorize({
          access: { type: "read" },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toMatchObject({
        ok: true,
        session: {
          csrfToken:
            "e905df9e476a4d74b01b6bd25a13b5ef8f57be83f7bf907ea531581101242672",
          observedBlock: nextBlock,
          roles: ["recovery"],
        },
      });
    } finally {
      store.close();
    }
  });

  it.each(["logout", "expiry", "replacement"] as const)(
    "fails closed when concurrent %s invalidates a session during a live role read",
    async (invalidation) => {
      const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
      let currentTime = new Date("2026-09-05T08:00:00.000Z");
      let readCount = 0;
      let signalRoleReadStarted = (): void => undefined;
      let releaseRoleRead = (): void => undefined;
      const roleReadStarted = new Promise<void>((resolve) => {
        signalRoleReadStarted = resolve;
      });
      const roleReadReleased = new Promise<void>((resolve) => {
        releaseRoleRead = resolve;
      });
      const authorityReader: AdminAuthorityReader = {
        observe: async () => observedBlock,
        read: async () => {
          readCount += 1;
          if (readCount === 2) {
            signalRoleReadStarted();
            await roleReadReleased;
          }
          return {
            bindingsFingerprint,
            block: observedBlock,
            capabilities: capabilities({ keeper: true }),
            consoleRoles: ["keeper"],
          };
        },
        verify: async () => true,
      };
      const values = [0xab, 0xcd];
      const service = createAdminAuthService({
        appOrigin: "https://admin.orbit.example",
        authorityReader,
        challengeTtlMilliseconds: 300_000,
        deploymentFingerprint,
        now: () => currentTime,
        randomBytes: () => {
          const value = values.shift() ?? 0;
          return Uint8Array.from({ length: 32 }, () => value);
        },
        sessionTtlMilliseconds: 900_000,
        store,
      });

      try {
        const challenge = service.issueChallenge(address);
        const verified = await service.verify({
          message: challenge.message,
          signature: "0x1234",
        });
        if (!verified.ok)
          throw new Error("Expected session creation to succeed");

        const authorization = service.authorize({
          access: { type: "read" },
          sessionHandle: verified.sessionHandle,
        });
        await roleReadStarted;
        const logoutResult =
          invalidation === "logout"
            ? service.logout({
                csrfToken: verified.session.csrfToken,
                sessionHandle: verified.sessionHandle,
              })
            : undefined;
        if (invalidation !== "logout") {
          currentTime = new Date(verified.session.expiresAt);
        }
        if (invalidation === "replacement") {
          const replacementNonce = "34".repeat(32);
          store.createChallenge({
            address: "0x0000000000000000000000000000000000000001",
            deploymentFingerprint,
            expiresAt: currentTime.getTime() + 300_000,
            issuedAt: currentTime.getTime(),
            nonce: replacementNonce,
          });
          expect(
            store.consumeChallengeAndCreateSession({
              address: "0x0000000000000000000000000000000000000001",
              bindingsFingerprint: `0x${"55".repeat(32)}`,
              createdAt: currentTime.getTime(),
              csrfToken: "56".repeat(32),
              expiresAt: currentTime.getTime() + 900_000,
              nonce: replacementNonce,
              now: currentTime.getTime(),
              sessionHandle: verified.sessionHandle,
            }),
          ).toBe(true);
        }
        releaseRoleRead();

        expect(logoutResult).toEqual(
          invalidation === "logout" ? { ok: true } : undefined,
        );
        await expect(authorization).resolves.toEqual({
          ok: false,
          reason: "unauthenticated",
        });
      } finally {
        releaseRoleRead();
        store.close();
      }
    },
  );

  it("requires CSRF and the exact live role for protected actions", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ keeper: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async () => true,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const verified = await service.verify({
        message: challenge.message,
        signature: "0x1234",
      });
      if (!verified.ok) throw new Error("Expected session creation to succeed");
      await expect(
        service.authorize({
          access: {
            action: { type: "open-reward-epoch" },
            csrfToken: "invalid",
            type: "action",
          },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toEqual({ ok: false, reason: "forbidden" });
      await expect(
        service.authorize({
          access: {
            action: { type: "execute-pol" },
            csrfToken: verified.session.csrfToken,
            type: "action",
          },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toEqual({ ok: false, reason: "forbidden" });
      await expect(
        service.authorize({
          access: {
            action: { type: "execute-track" },
            csrfToken: verified.session.csrfToken,
            type: "action",
          },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      store.close();
    }
  });

  it("requires CSRF to revoke a session and makes logout persistent immediately", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ guardian: true }),
        consoleRoles: ["guardian"],
      }),
      verify: async () => true,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const verified = await service.verify({
        message: challenge.message,
        signature: "0x1234",
      });
      if (!verified.ok) throw new Error("Expected session creation to succeed");
      expect(
        service.logout({
          csrfToken: "invalid",
          sessionHandle: verified.sessionHandle,
        }),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(
        service.logout({
          csrfToken: verified.session.csrfToken,
          sessionHandle: verified.sessionHandle,
        }),
      ).toEqual({ ok: true });
      await expect(
        service.authorize({
          access: { type: "read" },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toEqual({ ok: false, reason: "unauthenticated" });
    } finally {
      store.close();
    }
  });

  it("denies creator-only wallets even if an authority adapter reports an inconsistent role", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ creator: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async () => true,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      await expect(
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ).resolves.toEqual({ ok: false, reason: "forbidden" });
      await expect(
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ).resolves.toEqual({ ok: false, reason: "unauthenticated" });
    } finally {
      store.close();
    }
  });

  it("rejects every deployment-bound SIWE mutation without burning the challenge", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    let signatureValid = false;
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ keeper: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async () => signatureValid,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const mutations = [
        challenge.message.replace(
          "https://admin.orbit.example wants",
          "https://evil.example wants",
        ),
        challenge.message.replace(
          "URI: https://admin.orbit.example/admin/sign-in",
          "URI: https://admin.orbit.example/admin",
        ),
        challenge.message.replace("Chain ID: 84532", "Chain ID: 1"),
        challenge.message.replace(
          address,
          "0x0000000000000000000000000000000000000001",
        ),
        challenge.message.replace(
          "Issued At: 2026-09-05T08:00:00.000Z",
          "Issued At: 2026-09-05T08:00:01.000Z",
        ),
        challenge.message.replace(
          "Expiration Time: 2026-09-05T08:05:00.000Z",
          "Expiration Time: 2026-09-05T08:06:00.000Z",
        ),
        challenge.message.replace(
          `Nonce: ${"ab".repeat(32)}`,
          `Nonce: ${"ba".repeat(32)}`,
        ),
        challenge.message.replace(
          `Request ID: ${deploymentFingerprint}`,
          `Request ID: 0x${"99".repeat(32)}`,
        ),
        challenge.message.replace(
          `urn:orbit:deployment:${"11".repeat(32)}`,
          `urn:orbit:deployment:${"99".repeat(32)}`,
        ),
        `${challenge.message}\nunsupported trailing field`,
      ];
      for (const message of mutations) {
        await expect(
          service.verify({ message, signature: "0x1234" }),
        ).resolves.toEqual({ ok: false, reason: "unauthenticated" });
      }
      await expect(
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ).resolves.toEqual({ ok: false, reason: "unauthenticated" });

      signatureValid = true;
      await expect(
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ).resolves.toMatchObject({ ok: true });
    } finally {
      store.close();
    }
  });

  it("admits exactly one of two concurrent challenge replays", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    let verificationCount = 0;
    let releaseVerifiers = (): void => undefined;
    const bothVerifiersReady = new Promise<void>((resolve) => {
      releaseVerifiers = resolve;
    });
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ keeper: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async () => {
        verificationCount += 1;
        if (verificationCount === 2) releaseVerifiers();
        await bothVerifiersReady;
        return true;
      },
    };
    const values = [0xab, 0xcd, 0xef];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const results = await Promise.all([
        service.verify({ message: challenge.message, signature: "0x1234" }),
        service.verify({ message: challenge.message, signature: "0x1234" }),
      ]);
      expect(results.map((result) => result.ok).sort()).toEqual([false, true]);
      expect(results.find((result) => !result.ok)).toEqual({
        ok: false,
        reason: "unauthenticated",
      });
    } finally {
      store.close();
    }
  });

  it("revokes on any live role-binding rotation even when the wallet remains privileged", async () => {
    const store = openAdminAuthStore(":memory:", { deploymentFingerprint });
    let currentBindingsFingerprint = bindingsFingerprint;
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint: currentBindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ keeper: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async () => true,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const verified = await service.verify({
        message: challenge.message,
        signature: "0x1234",
      });
      if (!verified.ok) throw new Error("Expected session creation to succeed");
      currentBindingsFingerprint = `0x${"55".repeat(32)}`;
      await expect(
        service.authorize({
          access: { type: "read" },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toEqual({ ok: false, reason: "forbidden" });

      currentBindingsFingerprint = bindingsFingerprint;
      await expect(
        service.authorize({
          access: { type: "read" },
          sessionHandle: verified.sessionHandle,
        }),
      ).resolves.toEqual({ ok: false, reason: "unauthenticated" });
    } finally {
      store.close();
    }
  });

  it("never persists the raw signed message, signature, session handle, or CSRF token", async () => {
    const directory = mkdtempSync(join(tmpdir(), "orbit-admin-auth-service-"));
    const path = join(directory, "auth.sqlite");
    const store = openAdminAuthStore(path, { deploymentFingerprint });
    const authorityReader: AdminAuthorityReader = {
      observe: async () => observedBlock,
      read: async () => ({
        bindingsFingerprint,
        block: observedBlock,
        capabilities: capabilities({ keeper: true }),
        consoleRoles: ["keeper"],
      }),
      verify: async () => true,
    };
    const values = [0xab, 0xcd];
    const service = createAdminAuthService({
      appOrigin: "https://admin.orbit.example",
      authorityReader,
      challengeTtlMilliseconds: 300_000,
      deploymentFingerprint,
      now: () => new Date("2026-09-05T08:00:00.000Z"),
      randomBytes: () => {
        const value = values.shift() ?? 0;
        return Uint8Array.from({ length: 32 }, () => value);
      },
      sessionTtlMilliseconds: 900_000,
      store,
    });

    try {
      const challenge = service.issueChallenge(address);
      const signature = `0x${"de".repeat(65)}` as const;
      const verified = await service.verify({
        message: challenge.message,
        signature,
      });
      if (!verified.ok) throw new Error("Expected session creation to succeed");

      const files = [path, `${path}-wal`, `${path}-shm`]
        .filter(existsSync)
        .map((file) => readFileSync(file));
      for (const secret of [
        challenge.message,
        signature,
        verified.sessionHandle,
        verified.session.csrfToken,
      ]) {
        expect(files.some((file) => file.includes(Buffer.from(secret)))).toBe(
          false,
        );
      }
    } finally {
      store.close();
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
