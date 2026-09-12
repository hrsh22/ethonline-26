"use client";

import Link from "next/link";
import { formatUnits } from "viem";

import { Button } from "@/components/ui/button";
import { AmountField, MaxAction } from "@/components/ui/amount-field";
import { DataList, DataRow } from "@/components/ui/data-list";
import { BasisPoints, Rate, Unavailable } from "@/components/ui/value";
import type { deriveExchangeIntent, ExchangeQuote } from "@/lib/exchange-state";
import { formatTokenAmount } from "@/lib/format";
import { applicationCopy } from "@/lib/identity";

type ExchangeIntent = ReturnType<typeof deriveExchangeIntent>;

const staticIntentStatuses: ReadonlySet<ExchangeIntent["status"]> = new Set([
  "invalid",
  "reader-unavailable",
  "balance-unavailable",
  "balance-loading",
]);

const rejected = (intent: ExchangeIntent): boolean =>
  intent.status === "invalid" ||
  intent.status === "insufficient-balance" ||
  intent.status === "insufficient-gas";

const describedBy = (intent: ExchangeIntent): string | undefined =>
  intent.status === "insufficient-balance" ||
  intent.status === "insufficient-gas" ||
  staticIntentStatuses.has(intent.status)
    ? "exchange-amount-feedback"
    : undefined;

/**
 * The pay and receive rows: two amount fields, the second read-only.
 *
 * A missing output is never rendered as a number. The receive field stays
 * empty with a placeholder that says what is happening, because a `0.00`
 * there reads as a real zero quote for the amount just entered.
 */
export function ExchangeInstrument({
  amount,
  intent,
  maximumAmountWei,
  onAmount,
  outputState,
  payAsset,
  quote,
  receiveAsset,
}: {
  readonly amount: string;
  readonly intent: ExchangeIntent;
  readonly maximumAmountWei: bigint | undefined;
  readonly onAmount: (value: string) => void;
  readonly outputState: "loading" | "empty";
  readonly payAsset: string;
  readonly quote: ExchangeQuote | undefined;
  readonly receiveAsset: string;
}) {
  return (
    <div className="grid gap-3">
      {maximumAmountWei === undefined ? null : (
        <p
          className="text-right text-body-sm text-ink-soft"
          title={formatUnits(maximumAmountWei, 18)}
        >
          Available: {formatTokenAmount(maximumAmountWei).display} {payAsset}
        </p>
      )}
      {maximumAmountWei === 0n &&
      payAsset !== applicationCopy.exchange.token ? (
        <Link
          href="/faucet?returnTo=%2Fexchange"
          className="inline-flex min-h-11 items-center text-body-sm text-signal underline"
        >
          Get test funds
        </Link>
      ) : null}
      <AmountField
        action={
          maximumAmountWei === undefined ||
          maximumAmountWei === 0n ? undefined : (
            <div className="flex flex-wrap gap-1">
              {[25n, 50n].map((percent) => (
                <Button
                  key={String(percent)}
                  aria-label={`Use ${percent}% of spendable ${payAsset}`}
                  disabled={(maximumAmountWei * percent) / 100n === 0n}
                  onClick={() =>
                    onAmount(
                      formatUnits((maximumAmountWei * percent) / 100n, 18),
                    )
                  }
                  size="sm"
                  variant="ghost"
                >
                  {String(percent)}%
                </Button>
              ))}
              <MaxAction
                label={applicationCopy.exchange.maxAmountLabel(payAsset)}
                onClick={() => onAmount(formatUnits(maximumAmountWei, 18))}
              >
                {applicationCopy.exchange.maxAmount}
              </MaxAction>
            </div>
          )
        }
        describedBy={describedBy(intent)}
        id="exchange-amount"
        invalid={rejected(intent)}
        label={applicationCopy.exchange.pay}
        onValueChange={onAmount}
        placeholder={applicationCopy.exchange.amountPlaceholder}
        unit={payAsset}
        value={amount}
      />
      <div
        data-quote-output
        data-state={quote === undefined ? outputState : "ready"}
      >
        <AmountField
          id="exchange-receive"
          label={applicationCopy.exchange.receive}
          placeholder={
            outputState === "loading"
              ? applicationCopy.exchange.quotePending
              : applicationCopy.exchange.awaitingQuote
          }
          readOnly
          unit={receiveAsset}
          value={
            quote === undefined
              ? ""
              : formatTokenAmount(quote.amountOut, { minimumFractionDigits: 4 })
                  .display
          }
        />
      </div>
    </div>
  );
}

/**
 * The two market facts a trader wants before typing an amount, quoted from the
 * current quote when there is one and from the deployed policy otherwise.
 */
export function ExchangeMarketReference({
  feeBasisPoints,
  priceWei,
}: {
  readonly feeBasisPoints: number | undefined;
  readonly priceWei: bigint | undefined;
}) {
  return (
    <DataList>
      <DataRow
        label={applicationCopy.exchange.price}
        tone="live"
        value={
          priceWei === undefined ? (
            <Unavailable reason={applicationCopy.common.notObserved} />
          ) : (
            <Rate value={priceWei} />
          )
        }
      />
      <DataRow
        label={applicationCopy.exchange.fee}
        value={
          feeBasisPoints === undefined ? (
            <span className="font-mono">
              {applicationCopy.exchange.defaultFee}
            </span>
          ) : (
            <BasisPoints value={feeBasisPoints} />
          )
        }
      />
    </DataList>
  );
}
