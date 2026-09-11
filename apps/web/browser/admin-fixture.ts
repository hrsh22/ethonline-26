import { createServer, type Server } from "node:http";
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  multicall3Abi,
  toHex,
  type Hex,
} from "viem";

import { deploymentManifestFingerprint } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";

import { protocolDeploymentManifests } from "../src/generated/deployment-manifests.ts";
import { decodeAdminSessionResponse } from "../src/lib/admin-session-contract.ts";

const manifest = protocolDeploymentManifests["development-sepolia"];
const hook = createProtocolContracts(manifest).canonicalFeeHook;
export const ADMIN_FIXTURE_COOKIE = `orbit_admin_session=${"b".repeat(64)}`;
const block = {
  hash: `0x${"a".repeat(64)}`,
  number: toHex(manifest.launch.blockNumber + 100),
  timestamp: toHex(Math.floor(Date.now() / 1_000)),
  transactions: [],
};
const session = decodeAdminSessionResponse(
  {
    apiVersion: 1,
    session: {
      address: "0x2000000000000000000000000000000000000002",
      chainId: manifest.chainId,
      csrfToken: "browser-matrix-only",
      deploymentFingerprint: deploymentManifestFingerprint(manifest),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      observedBlock: {
        hash: block.hash,
        number: String(manifest.launch.blockNumber + 100),
      },
      roles: ["keeper", "creator"],
    },
  },
  deploymentManifestFingerprint(manifest),
);

/** Only creatorPot is observed. Missing reads remain failed, not fabricated zeroes. */
export const adminRpcResponse = (call: {
  readonly id: number;
  readonly method: string;
  readonly params?: readonly { readonly to?: Hex; readonly data?: Hex }[];
}) => {
  const envelope = { id: call.id, jsonrpc: "2.0" };
  if (call.method === "eth_chainId")
    return { ...envelope, result: toHex(manifest.chainId) };
  if (call.method === "eth_getBlockByNumber")
    return { ...envelope, result: block };
  const data = call.params?.[0]?.data;
  if (call.method === "eth_call" && data !== undefined) {
    try {
      const decoded = decodeFunctionData({ abi: multicall3Abi, data });
      if (decoded.functionName === "aggregate3") {
        const creatorCall = encodeFunctionData({
          abi: hook.abi,
          functionName: "creatorPot",
        });
        const result = decoded.args[0].map((entry) => {
          const success =
            entry.target.toLowerCase() === hook.address.toLowerCase() &&
            entry.callData === creatorCall;
          return {
            success,
            returnData: success
              ? encodeFunctionResult({
                  abi: hook.abi,
                  functionName: "creatorPot",
                  result: 2n * 10n ** 18n,
                })
              : ("0x" as const),
          };
        });
        return {
          ...envelope,
          result: encodeFunctionResult({
            abi: multicall3Abi,
            functionName: "aggregate3",
            result,
          }),
        };
      }
    } catch {
      /* Unsupported calls stay explicit failures. */
    }
  }
  return {
    ...envelope,
    error: {
      code: -32000,
      message: "Read unavailable in partial admin fixture",
    },
  };
};

/** Test-only HTTP boundary; no signing, challenge verification or action can succeed. */
export const startAdminFixtureServer = async (
  port = 8_800,
): Promise<Server> => {
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/rpc" && request.method === "POST") {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      const calls = JSON.parse(body) as
        | Parameters<typeof adminRpcResponse>[0]
        | Parameters<typeof adminRpcResponse>[0][];
      response.end(
        JSON.stringify(
          Array.isArray(calls)
            ? calls.map(adminRpcResponse)
            : adminRpcResponse(calls),
        ),
      );
      return;
    }
    if (request.method !== "GET") {
      response.statusCode = 403;
      response.end(
        JSON.stringify({ apiVersion: 1, error: "action_not_allowed" }),
      );
      return;
    }
    // Missing diagnostics are unavailable, not a revoked session. A 401/403
    // read would correctly make the real client tear down authenticated UI.
    if (request.url !== "/v1/admin/auth/session") {
      response.statusCode = 503;
      response.end(
        JSON.stringify({ apiVersion: 1, error: "service_unavailable" }),
      );
      return;
    }
    const authenticated = request.headers.cookie === ADMIN_FIXTURE_COOKIE;
    response.statusCode = authenticated ? 200 : 401;
    response.end(
      JSON.stringify(
        authenticated ? session : { apiVersion: 1, error: "session_required" },
      ),
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  return server;
};
