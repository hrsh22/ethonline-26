import { describe, expect, it } from "vitest";

import { createProductionServerEnvironment } from "./production-server-environment";

describe("production browser server environment", () => {
  it("preserves the deployment identity used to build the application", () => {
    expect(
      createProductionServerEnvironment(
        { NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "development-sepolia" },
        "http://127.0.0.1:18800",
      ),
    ).toMatchObject({
      NEXT_PUBLIC_API_URL: "http://127.0.0.1:18800",
      NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT: "development-sepolia",
    });
  });

  it("fails clearly without a build deployment identity", () => {
    expect(() =>
      createProductionServerEnvironment({}, "http://127.0.0.1:18800"),
    ).toThrow(
      "NEXT_PUBLIC_DEPLOYMENT_ENVIRONMENT is required by the production browser harness",
    );
  });
});
