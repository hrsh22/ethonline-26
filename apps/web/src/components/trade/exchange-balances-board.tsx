"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Amount, Count, Unavailable } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";

/**
 * One asset row, carrying base units rather than a formatted string so the
 * value primitives decide how many digits a balance shows.
 */
export interface ExchangeBalanceRow {
  readonly asset: string;
  readonly observedBlock?: bigint | undefined;
  readonly reason: string;
  readonly wei: bigint | undefined;
}

/** Re-reads the wallet. Lives in the wallet panel's header strip. */
export function ExchangeBalancesRefresh({
  enabled,
  onRefresh,
}: {
  readonly enabled: boolean;
  readonly onRefresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <Button
      disabled={!enabled || refreshing}
      onClick={() => void refresh()}
      size="sm"
      type="button"
      variant="outline"
    >
      {refreshing
        ? applicationCopy.exchange.refreshingBalances
        : applicationCopy.exchange.refreshBalances}
    </Button>
  );
}

/**
 * Wallet balances as label/value rows on the panel's own surface: the asset on
 * the left, the balance typeset on the right, and the asset being spent marked
 * with a token rather than a box around it. Labelled by the panel title, so it
 * adds no heading of its own.
 */
export function ExchangeBalancesBoard({
  labelledBy,
  observedBlock,
  payAsset,
  rows,
}: {
  readonly labelledBy: string;
  readonly observedBlock: bigint | undefined;
  readonly payAsset: string;
  readonly rows: readonly ExchangeBalanceRow[];
}) {
  const separateRows = rows.filter(
    (row) =>
      row.observedBlock !== undefined && row.observedBlock !== observedBlock,
  );
  return (
    <div>
      <dl aria-labelledby={labelledBy} data-balances-list>
        {rows.map((row) => (
          <div
            className="flex items-center justify-between gap-4 border-b border-line py-2 last:border-b-0"
            data-paying={String(row.asset === payAsset)}
            key={row.asset}
          >
            <dt className="flex items-center gap-2 font-mono text-body-sm text-ink-soft">
              <span>{row.asset}</span>
              {row.asset === payAsset ? (
                <Badge tone="live">
                  {applicationCopy.exchange.balancesPaying}
                </Badge>
              ) : null}
            </dt>
            <dd className="font-mono text-body-sm text-ink tabular-nums text-right">
              {row.wei === undefined ? (
                <Unavailable reason={row.reason} />
              ) : (
                <Amount minimumFractionDigits={4} value={row.wei} />
              )}
              {row.observedBlock !== undefined && separateRows.includes(row) ? (
                <span className="mt-1 flex justify-end gap-1.5 text-caption text-ink-faint">
                  {applicationCopy.exchange.balancesObservedLabel}
                  <Count value={row.observedBlock} />
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p
        className="mt-2 flex items-baseline gap-1.5 font-mono text-caption text-ink-faint"
        data-balances-observed
      >
        {separateRows.length > 0
          ? rows
              .filter((row) => !separateRows.includes(row))
              .map((row) => row.asset)
              .join(" / ")
          : null}
        {observedBlock === undefined ? (
          applicationCopy.exchange.balancesObservedUnknown
        ) : (
          <>
            {applicationCopy.exchange.balancesObservedLabel}
            <Count value={observedBlock} />
          </>
        )}
      </p>
    </div>
  );
}
