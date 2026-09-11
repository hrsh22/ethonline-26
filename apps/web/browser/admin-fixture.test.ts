import { afterEach, expect, it } from "vitest";
import { createPublicClient, http, type Chain } from "viem";
import { baseSepolia } from "viem/chains";

import { deploymentManifestFingerprint } from "@orbit/config/deployment-manifest";
import { selectIdentityConfiguration } from "@orbit/config/identity";
import { createProtocolReader } from "@orbit/protocol/reader";
import { makeViemProtocolTransport } from "@orbit/protocol/viem-transport";

import { protocolDeploymentManifests } from "../src/generated/deployment-manifests";
import { decodeAdminSessionResponse } from "../src/lib/admin-session-contract";
import { ADMIN_FIXTURE_COOKIE, startAdminFixtureServer } from "./admin-fixture";

let server: Awaited<ReturnType<typeof startAdminFixtureServer>> | undefined;
afterEach(async () => server?.[Symbol.asyncDispose]());

it("validates the fixture session through HTTP and denies every action", async () => {
  server = await startAdminFixtureServer(0);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port");
  const origin = `http://127.0.0.1:${address.port}`;
  const headers = { cookie: ADMIN_FIXTURE_COOKIE };
  expect((await fetch(`${origin}/v1/admin/auth/session`)).status).toBe(401);
  const response = await fetch(`${origin}/v1/admin/auth/session`, { headers });
  expect(response.status).toBe(200);
  expect(
    decodeAdminSessionResponse(
      await response.json(),
      deploymentManifestFingerprint(
        protocolDeploymentManifests["development-sepolia"],
      ),
    ).session.roles,
  ).toEqual(["keeper", "creator"]);
  expect(
    (await fetch(`${origin}/v1/admin/diagnostics/health`, { headers })).status,
  ).toBe(503);
  for (const path of [
    "/v1/admin/actions/authorize",
    "/v1/admin/auth/verify",
    "/v1/operator/control/command",
  ]) {
    expect(
      (await fetch(`${origin}${path}`, { method: "POST", headers })).status,
    ).toBe(403);
  }
});

it("renders only the observed creator balance from a real partial health read", async () => {
  server = await startAdminFixtureServer(0);
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("No port");
  const manifest = protocolDeploymentManifests["development-sepolia"];
  const identity = selectIdentityConfiguration("orbit-4444");
  const client = createPublicClient({
    chain: baseSepolia as Chain,
    transport: http(`http://127.0.0.1:${address.port}/rpc`),
  });
  const reader = createProtocolReader({
    manifest,
    identity,
    transport: makeViemProtocolTransport(client, manifest, identity),
  });
  const health = await reader.readHealth(undefined, undefined, undefined, {
    includeOperationalHistory: false,
    includeRewardHistory: false,
  });
  expect(health.market.creatorPotWeth).toBe(2n * 10n ** 18n);
  expect(health.market.rewardPotWeth).toBeUndefined();
  expect(health.operations.trackQueues).toHaveLength(4);
  expect(
    health.operations.trackQueues.every((queue) => queue.status === "unknown"),
  ).toBe(true);
});
