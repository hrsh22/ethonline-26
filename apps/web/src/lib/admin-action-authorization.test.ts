import { describe, expect, it } from "vitest";

import { adminAuthorizationAction } from "./admin-action-authorization";

describe("admin action authorization projection", () => {
  it("projects operator actions to the minimum server authorization shape", () => {
    expect(
      adminAuthorizationAction({
        type: "execute-track",
        track: 3,
        minimumStockOutput: 99n,
        deadline: 123n,
      }),
    ).toEqual({ type: "execute-track" });
    expect(
      adminAuthorizationAction({
        type: "set-pause",
        module: "rewards",
        paused: true,
      }),
    ).toEqual({ type: "set-pause", module: "rewards" });
    expect(adminAuthorizationAction({ type: "open-reward-epoch" })).toEqual({
      type: "open-reward-epoch",
    });
  });

  it("rejects sealed configuration and collector actions", () => {
    expect(() =>
      adminAuthorizationAction({
        type: "configure-conversion-track",
        track: 1,
        stockToken: "0x1111111111111111111111111111111111111111",
        adapter: "0x2222222222222222222222222222222222222222",
      }),
    ).toThrow(/not exposed/u);
    expect(() =>
      adminAuthorizationAction({
        type: "claim",
        identityIds: [1],
      }),
    ).toThrow(/not exposed/u);
  });
});
