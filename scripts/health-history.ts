import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import type { IdentityConfiguration } from "@orbit/config/identity";
import { createIndexedHistoryReaders } from "@orbit/protocol/history";
import {
  createProtocolReader,
  type ProtocolReadTransport,
} from "@orbit/protocol/reader";

export interface BaseSepoliaHealthReaderOptions {
  readonly fetcher?: typeof fetch;
  readonly historyReadApiToken: string | undefined;
  readonly historyIndexUrl: string;
  readonly identity: IdentityConfiguration;
  readonly manifest: ProtocolDeploymentManifest;
  readonly transport: ProtocolReadTransport;
}

const authenticatedHistoryFetcher = (
  fetcher: typeof fetch,
  token: string | undefined,
): typeof fetch => {
  if (token === undefined) return fetcher;
  return (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetcher(input, { ...init, headers });
  };
};

export const createBaseSepoliaHealthReader = ({
  fetcher = fetch,
  historyReadApiToken,
  historyIndexUrl,
  identity,
  manifest,
  transport,
}: BaseSepoliaHealthReaderOptions) => {
  const indexedHistory = createIndexedHistoryReaders({
    fetcher: authenticatedHistoryFetcher(fetcher, historyReadApiToken),
    identity,
    manifest,
    basePath: `${historyIndexUrl.replace(/\/+$/u, "")}/v1`,
  });
  return createProtocolReader({
    manifest,
    identity,
    transport,
    history: indexedHistory.protocol,
  });
};
