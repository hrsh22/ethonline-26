import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, parse, sep } from "node:path";

import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

import { ADMIN_AUTH_CHAIN_ID } from "@orbit/config/admin-auth";
import {
  decodeProtocolDeploymentManifest,
  deploymentManifestFingerprint,
} from "@orbit/config/deployment-manifest";

import { createAdminAuthService, type AdminAuthService } from "./admin-auth.js";
import { openAdminAuthStore } from "./admin-auth-store.js";
import {
  createAdminRoleReader,
  type AdminRoleReaderClient,
} from "./admin-role-reader.js";
import type { PublicApiConfiguration } from "./configuration.js";

export interface AdminAuthRuntime {
  readonly close: () => void;
  readonly service: AdminAuthService;
}

const readManifest = (path: string) => {
  const manifest = decodeProtocolDeploymentManifest(
    JSON.parse(readFileSync(path, "utf8")) as unknown,
  );
  if (manifest.chainId !== ADMIN_AUTH_CHAIN_ID) {
    throw new Error("Admin auth requires the canonical Base Sepolia manifest");
  }
  return manifest;
};

const assertSafeDirectoryComponents = (directory: string): void => {
  const root = parse(directory).root;
  const components = directory
    .slice(root.length)
    .split(sep)
    .filter((component) => component.length > 0);
  let current = root;
  for (const component of components) {
    current = join(current, component);
    if (!existsSync(current)) return;
    const state = lstatSync(current);
    if (state.isSymbolicLink()) {
      throw new Error("Admin auth state path must not contain a symbolic link");
    }
    if (!state.isDirectory()) {
      throw new Error("Admin auth state path components must be directories");
    }
  }
};

const secureStateDirectory = (databasePath: string): void => {
  if (databasePath === ":memory:") return;
  const directory = dirname(databasePath);
  if (!isAbsolute(databasePath) || directory === parse(databasePath).root) {
    throw new Error("Admin auth state requires a safe absolute database path");
  }
  assertSafeDirectoryComponents(directory);
  mkdirSync(directory, { mode: 0o700, recursive: true });
  assertSafeDirectoryComponents(directory);
  chmodSync(directory, 0o700);
  if (existsSync(databasePath)) {
    const databaseState = lstatSync(databasePath);
    if (databaseState.isSymbolicLink()) {
      throw new Error("Admin auth database must not be a symbolic link");
    }
    if (!databaseState.isFile()) {
      throw new Error("Admin auth database path must be a regular file");
    }
  }
};

const liveAuthorityClient = (rpcUrl: URL): AdminRoleReaderClient => {
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(rpcUrl.toString()),
  });
  return {
    getBlock: async () => {
      const block = await client.getBlock({ blockTag: "latest" });
      return { hash: block.hash, number: block.number };
    },
    getChainId: () => client.getChainId(),
    readContract: (parameters) => client.readContract(parameters as never),
    verifySiweMessage: (parameters) => client.verifySiweMessage(parameters),
  };
};

export const openAdminAuthRuntime = (
  configuration: PublicApiConfiguration["adminAuth"],
): AdminAuthRuntime => {
  const manifest = readManifest(configuration.manifestPath);
  const deploymentFingerprint = deploymentManifestFingerprint(manifest);
  secureStateDirectory(configuration.databasePath);
  const store = openAdminAuthStore(configuration.databasePath, {
    deploymentFingerprint,
  });
  try {
    const authorityReader = createAdminRoleReader({
      client: liveAuthorityClient(configuration.rpcUrl),
      manifest,
    });
    return {
      close: store.close,
      service: createAdminAuthService({
        appOrigin: configuration.appOrigin,
        authorityReader,
        challengeTtlMilliseconds: configuration.challengeTtlMilliseconds,
        deploymentFingerprint,
        now: () => new Date(),
        randomBytes,
        sessionTtlMilliseconds: configuration.sessionTtlMilliseconds,
        store,
      }),
    };
  } catch (cause) {
    store.close();
    throw cause;
  }
};
