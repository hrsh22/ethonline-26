"use client";

import { useCallback, useEffect, useState } from "react";
import { protocolDeploymentFingerprint } from "./deployment";
import type {
  ExchangeDirection,
  ExchangeSettlementMode,
} from "./exchange-state";

interface Draft {
  amount: string;
  direction: ExchangeDirection;
  settlementMode: ExchangeSettlementMode;
}
const empty: Draft = {
  amount: "",
  direction: "buy",
  settlementMode: "wrapped",
};
const valid = (value: Partial<Draft>): value is Draft =>
  typeof value.amount === "string" &&
  value.amount.length <= 80 &&
  /^[0-9.]*$/.test(value.amount) &&
  (value.direction === "buy" || value.direction === "sell") &&
  (value.settlementMode === "native" || value.settlementMode === "wrapped");

/** Only user input is bookmarked. A reload always obtains a new live quote. */
export function useExchangeDraft(address: string | undefined) {
  const key = `orbit:trade-draft:v1:${protocolDeploymentFingerprint}:${address?.toLowerCase() ?? "visitor"}`;
  const [stored, setStored] = useState<{ key: string; draft: Draft }>({
    key: "",
    draft: empty,
  });
  const draft = stored.key === key ? stored.draft : empty;
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(key);
      const value: Partial<Draft> = raw === null ? empty : JSON.parse(raw);
      // Browser session storage is an external source, read only after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStored((previous) => ({
        key,
        draft:
          raw === null && previous.key.endsWith(":visitor")
            ? previous.draft
            : valid(value)
              ? value
              : empty,
      }));
    } catch {
      setStored({ key, draft: empty });
    }
  }, [key]);
  useEffect(() => {
    if (stored.key !== key) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(stored.draft));
    } catch {
      /* Input remains usable without storage. */
    }
  }, [key, stored]);
  const setAmount = useCallback(
    (amount: string) =>
      setStored((previous) => ({
        ...previous,
        draft: { ...previous.draft, amount },
      })),
    [],
  );
  const setDirection = useCallback(
    (direction: ExchangeDirection) =>
      setStored((previous) => ({
        ...previous,
        draft: { ...previous.draft, direction },
      })),
    [],
  );
  const setSettlementMode = useCallback(
    (settlementMode: ExchangeSettlementMode) =>
      setStored((previous) =>
        previous.draft.settlementMode === settlementMode
          ? previous
          : { ...previous, draft: { ...previous.draft, settlementMode } },
      ),
    [],
  );
  return { ...draft, setAmount, setDirection, setSettlementMode };
}
