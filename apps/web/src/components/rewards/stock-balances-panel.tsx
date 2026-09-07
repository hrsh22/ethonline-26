"use client";

import { blockedAccessMessage } from "@/components/access-notice";
import { ConnectWalletAction } from "@/components/connect-wallet-action";
import { StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Panel } from "@/components/ui/panel";
import { Address, Amount, Count, Unavailable } from "@/components/ui/value";
import {
  useStockBalances,
  type StockBalancesRead,
} from "@/hooks/use-stock-balances";
import { identity } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

const companies = ["Apple", "Alphabet", "Meta", "NVIDIA"] as const;
const tracks = [1, 2, 3, 4] as const;

function StockBalanceRows({
  read,
}: {
  readonly read: Extract<StockBalancesRead, { readonly status: "loaded" }>;
}) {
  const partial = read.snapshot.balances.some(
    (balance) => balance.status === "unavailable",
  );
  return (
    <>
      <p className="text-caption text-ink-faint">
        Wallet <Address value={read.snapshot.owner} />
      </p>
      {read.stale ? (
        <StateFeedback
          compact
          description="The refresh failed. These are the last successfully checked balances."
          title="Showing last checked balances"
          tone="stale"
        />
      ) : partial ? (
        <StateFeedback
          compact
          description="Unavailable balances are marked with a dash. Refresh to retry."
          title="Some stock balances could not be read"
          tone="partial"
        />
      ) : null}
      <DataList>
        {tracks.map((trackId) => {
          const track = identity.rewardTrackLabels[trackId];
          const balance = read.snapshot.balances.find(
            (candidate) => candidate.trackId === trackId,
          );
          return (
            <DataRow
              key={trackId}
              label={`${companies[trackId - 1]} · ${track}`}
              value={
                balance?.status === "observed" &&
                balance.rawTokenUnits !== undefined &&
                balance.decimals !== undefined ? (
                  <Amount
                    decimals={balance.decimals}
                    unit={track}
                    value={balance.rawTokenUnits}
                  />
                ) : (
                  <Unavailable reason={`${track} wallet balance unavailable`} />
                )
              }
            />
          );
        })}
      </DataList>
      {!partial &&
      read.snapshot.balances.length === 4 &&
      read.snapshot.balances.every(
        (balance) => balance.rawTokenUnits === 0n,
      ) ? (
        <p className="text-body-sm text-ink-soft">
          This wallet does not hold any of the four stock tokens yet. Claimed
          rewards will appear here.
        </p>
      ) : null}
    </>
  );
}

function StockBalanceContent({ read }: { readonly read: StockBalancesRead }) {
  if (read.status === "loaded") return <StockBalanceRows read={read} />;
  if (read.status === "blocked") {
    const message = blockedAccessMessage(read.accessState);
    return (
      <StateFeedback
        action={message.connectable ? <ConnectWalletAction /> : undefined}
        compact
        description={
          message.connectable
            ? "Connect a wallet to see the stock tokens it already holds."
            : message.body
        }
        title={message.title}
        tone={message.tone}
      />
    );
  }
  return (
    <StateFeedback
      compact
      description={
        read.status === "loading"
          ? "Reading the four supported stock-token balances."
          : "No balances could be verified. Refresh to try again."
      }
      title={
        read.status === "loading"
          ? "Checking your stock balances"
          : "Stock balances unavailable"
      }
      tone={read.status === "loading" ? "loading" : "error"}
    />
  );
}

export function StockBalancesPanel() {
  const protocol = useProtocolClient();
  const { read, refreshing, refresh } = useStockBalances(protocol);
  return (
    <Panel
      bodyClassName="grid gap-3"
      className="mt-5"
      footer={
        read.status === "blocked" ? undefined : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-caption text-ink-faint">
              {read.status === "loaded" ? (
                <>
                  Checked at block <Count value={read.snapshot.observedBlock} />
                </>
              ) : (
                "Balances have not been verified yet."
              )}
            </p>
            <Button
              disabled={refreshing}
              onClick={() => void refresh()}
              size="sm"
              type="button"
              variant="outline"
            >
              {refreshing ? "Refreshing…" : "Refresh stock balances"}
            </Button>
          </div>
        )
      }
      meta={<Badge tone="neutral">In wallet</Badge>}
      title="Stock tokens in your wallet"
    >
      <p className="text-body-sm text-ink-soft">
        Tokens already held by your wallet, separate from the unclaimed rewards
        below. These are no-value Base Sepolia test tokens.
      </p>
      <StockBalanceContent read={read} />
    </Panel>
  );
}
