"use client";

import { formatUnits } from "viem";

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
  intent.status === "invalid" || intent.status === "insufficient-balance";

const describedBy = (intent: ExchangeIntent): string | undefined =>
  intent.status === "insufficient-balance" ||
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
      <AmountField
        action={
          maximumAmountWei === undefined ? undefined : (
            <MaxAction
              label={applicationCopy.exchange.maxAmountLabel(payAsset)}
              onClick={() => onAmount(formatUnits(maximumAmountWei, 18))}
            >
              {applicationCopy.exchange.maxAmount}
            </MaxAction>
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
