/** @vitest-environment jsdom */
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const events = vi.hoisted(
  () =>
    new Set<
      (event: {
        data: { event: string; properties?: { connected: boolean } };
      }) => void
    >(),
);
vi.mock("@reown/appkit/react", () => ({
  modal: {
    subscribeEvents: (
      listener: (event: {
        data: { event: string; properties?: { connected: boolean } };
      }) => void,
    ) => {
      events.add(listener);
      return () => events.delete(listener);
    },
  },
}));

import {
  connectionRejectionState,
  useReownConnectionFeedback,
} from "./use-reown-connection-feedback";

describe("Reown connection feedback", () => {
  it.each([
    [{ event: "USER_REJECTED", properties: { message: "declined" } }, true],
    [{ event: "CONNECT_ERROR", properties: { message: "failed" } }, true],
    [{ event: "MODAL_CLOSE", properties: { connected: false } }, undefined],
    [{ event: "MODAL_CLOSE", properties: { connected: true } }, false],
    [{ event: "CONNECT_SUCCESS", properties: {} }, false],
    [{ event: "MODAL_OPEN", properties: { connected: false } }, undefined],
    [undefined, undefined],
  ])("maps %j to rejection state %s", (event, expected) => {
    expect(connectionRejectionState(event)).toBe(expected);
  });
});

it.each([undefined, "USER_REJECTED", "CONNECT_ERROR"])(
  "dismisses the chooser while retaining only an explicit %s failure",
  async (failure) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    let feedback: ReturnType<typeof useReownConnectionFeedback>;
    function Harness() {
      feedback = useReownConnectionFeedback();
      return null;
    }
    const emit = (event: string) =>
      events.forEach((listener) =>
        listener({ data: { event, properties: { connected: false } } }),
      );
    try {
      await act(() => root.render(createElement(Harness)));
      await act(() => feedback.beginConnection());
      if (failure !== undefined) await act(() => emit(failure));
      await act(() => emit("MODAL_CLOSE"));
      expect(feedback!.rejected).toBe(failure !== undefined);
      // An event from a later, unrelated modal must not attach to this attempt.
      await act(() => emit("CONNECT_ERROR"));
      expect(feedback!.rejected).toBe(failure !== undefined);
    } finally {
      await act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);
