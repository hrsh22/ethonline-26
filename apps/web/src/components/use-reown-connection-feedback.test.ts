import { describe, expect, it } from "vitest";

import { connectionRejectionState } from "./use-reown-connection-feedback";

describe("Reown connection feedback", () => {
  it.each([
    [{ event: "USER_REJECTED", properties: { message: "declined" } }, true],
    [{ event: "CONNECT_ERROR", properties: { message: "failed" } }, true],
    [{ event: "MODAL_CLOSE", properties: { connected: false } }, true],
    [{ event: "MODAL_CLOSE", properties: { connected: true } }, false],
    [{ event: "CONNECT_SUCCESS", properties: {} }, false],
    [{ event: "MODAL_OPEN", properties: { connected: false } }, undefined],
    [undefined, undefined],
  ])("maps %j to rejection state %s", (event, expected) => {
    expect(connectionRejectionState(event)).toBe(expected);
  });
});
