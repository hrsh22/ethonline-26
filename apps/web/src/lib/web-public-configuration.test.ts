import { describe, expect, it } from "vitest";

import {
  parseWebPublicConfiguration,
  requireProductionWebPublicConfiguration,
} from "./web-public-configuration";

describe("web public configuration", () => {
  it("normalizes the reviewed browser-public bindings", () => {
    expect(
      parseWebPublicConfiguration({
        NEXT_PUBLIC_API_URL: " https://api.orbit.example/ ",
        NEXT_PUBLIC_APP_URL: " https://orbit.example/ ",
        NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: " https://fallback.example ",
        NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: " staging ",
        NEXT_PUBLIC_PRIVY_APP_ID: " privy-project ",
        NEXT_PUBLIC_RPC_URL: " https://rpc.example ",
      }),
    ).toMatchObject({
      applicationUrl: "https://orbit.example",
      deploymentEnvironment: "staging",
      privyAppId: "privy-project",
      publicApiBaseUrl: "https://api.orbit.example",
      rpcUrl: "https://rpc.example",
    });
  });

  it("uses the legacy Base Sepolia RPC only as the staging fallback", () => {
    const defaultConfiguration = parseWebPublicConfiguration({
      NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: " https://fallback.example ",
    });
    expect(defaultConfiguration.deploymentEnvironment).toBe("staging");
    expect(defaultConfiguration.rpcUrl).toBe("https://fallback.example");
    expect(
      parseWebPublicConfiguration({
        NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://fallback.example",
        NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "development",
      }).rpcUrl,
    ).toBeUndefined();
    expect(
      parseWebPublicConfiguration({
        NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "https://fallback.example",
        NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "production",
      }).rpcUrl,
    ).toBeUndefined();
  });

  it("keeps optional bindings absent and production protocol selection unconfigured", () => {
    const configuration = parseWebPublicConfiguration({
      NEXT_PUBLIC_API_URL: " ",
      NEXT_PUBLIC_APP_URL: " ",
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "production",
      NEXT_PUBLIC_PRIVY_APP_ID: " ",
      NEXT_PUBLIC_RPC_URL: " ",
    });

    expect(configuration).toMatchObject({
      applicationUrl: undefined,
      deploymentEnvironment: "production",
      privyAppId: undefined,
      publicApiBaseUrl: undefined,
      rpcUrl: undefined,
    });
  });

  it("rejects an unknown protocol deployment selector", () => {
    expect(() =>
      parseWebPublicConfiguration({
        NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "preview",
      }),
    ).toThrow();
  });

  it("rejects invalid configured API and application origins", () => {
    expect(() =>
      parseWebPublicConfiguration({
        NEXT_PUBLIC_API_URL: "http://api.orbit.example",
      }),
    ).toThrow(/NEXT_PUBLIC_API_URL.*HTTPS origin/u);

    for (const applicationUrl of [
      "not-a-url",
      "http://orbit.example",
      "https://orbit.example/path",
      "https://user:password@orbit.example",
    ]) {
      expect(() =>
        parseWebPublicConfiguration({
          NEXT_PUBLIC_APP_URL: applicationUrl,
        }),
      ).toThrow(
        /NEXT_PUBLIC_APP_URL must be an HTTPS origin or local HTTP origin/u,
      );
    }
  });

  it("accepts a local HTTP application origin for development tooling", () => {
    expect(
      parseWebPublicConfiguration({
        NEXT_PUBLIC_APP_URL: "http://127.0.0.1:3001/",
      }).applicationUrl,
    ).toBe("http://127.0.0.1:3001");
  });

  it("rejects malformed, non-HTTP, and credential-bearing public RPC URLs", () => {
    for (const rpcUrl of [
      "not-a-url",
      "file:///tmp/anvil.ipc",
      "https://user:password@rpc.example",
      "https://rpc.example/#fragment",
    ]) {
      expect(() =>
        parseWebPublicConfiguration({ NEXT_PUBLIC_RPC_URL: rpcUrl }),
      ).toThrow(
        /NEXT_PUBLIC_RPC_URL must be an absolute HTTP\(S\) URL without credentials or a fragment/u,
      );
    }
    expect(() =>
      parseWebPublicConfiguration({
        NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL: "websocket://rpc.example",
        NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "development",
      }),
    ).toThrow(/NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL.*absolute HTTP\(S\) URL/u);
  });

  it("requires API and app origins for production builds but not Privy", () => {
    expect(() =>
      requireProductionWebPublicConfiguration(
        parseWebPublicConfiguration({
          NEXT_PUBLIC_APP_URL: "https://orbit.example",
        }),
      ),
    ).toThrow(/NEXT_PUBLIC_API_URL is required for a production web build/u);
    expect(() =>
      requireProductionWebPublicConfiguration(
        parseWebPublicConfiguration({
          NEXT_PUBLIC_API_URL: "https://api.orbit.example",
        }),
      ),
    ).toThrow(/NEXT_PUBLIC_APP_URL is required for a production web build/u);

    expect(
      requireProductionWebPublicConfiguration(
        parseWebPublicConfiguration({
          NEXT_PUBLIC_API_URL: "https://api.orbit.example",
          NEXT_PUBLIC_APP_URL: "https://orbit.example",
        }),
      ),
    ).toMatchObject({
      applicationUrl: "https://orbit.example",
      privyAppId: undefined,
      publicApiBaseUrl: "https://api.orbit.example",
    });
  });
});
