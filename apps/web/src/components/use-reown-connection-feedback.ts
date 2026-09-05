"use client";

import { modal } from "@reown/appkit/react";
import { useCallback, useEffect, useRef, useState } from "react";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

export const connectionRejectionState = (
  event: unknown,
): boolean | undefined => {
  if (!isRecord(event)) return undefined;

  switch (event.event) {
    case "USER_REJECTED":
    case "CONNECT_ERROR":
      return true;
    case "CONNECT_SUCCESS":
      return false;
    case "MODAL_CLOSE": {
      if (!isRecord(event.properties)) return undefined;
      if (event.properties.connected === true) return false;
      if (event.properties.connected === false) return true;
      return undefined;
    }
    default:
      return undefined;
  }
};

export function useReownConnectionFeedback() {
  const attemptedConnection = useRef(false);
  const [rejected, setRejected] = useState(false);

  useEffect(
    () =>
      modal?.subscribeEvents?.((event) => {
        const nextRejected = connectionRejectionState(event.data);
        if (nextRejected === undefined) return;

        if (nextRejected && !attemptedConnection.current) return;
        attemptedConnection.current = false;
        setRejected(nextRejected);
      }),
    [],
  );

  const beginConnection = useCallback(() => {
    attemptedConnection.current = true;
    setRejected(false);
  }, []);

  const failConnection = useCallback(() => {
    attemptedConnection.current = false;
    setRejected(true);
  }, []);

  return { beginConnection, failConnection, rejected } as const;
}
