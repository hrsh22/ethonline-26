"use client";

import { SegmentedControl } from "@/components/ui/segmented-control";
import type {
  ExchangeDirection,
  ExchangeSettlementMode,
} from "@/lib/exchange-state";
import { applicationCopy } from "@/lib/identity";

/**
 * The panel's primary instrument switch.
 *
 * Both controls here are the shared segmented control, which states the rule
 * once: the selected segment is the lit one.
 */
export function ExchangeDirectionControl({
  direction,
  onDirection,
}: {
  readonly direction: ExchangeDirection;
  readonly onDirection: (direction: ExchangeDirection) => void;
}) {
  return (
    <SegmentedControl
      label={applicationCopy.exchange.title}
      onValueChange={onDirection}
      options={[
        { label: applicationCopy.exchange.directionToToken, value: "buy" },
        { label: applicationCopy.exchange.directionToWeth, value: "sell" },
      ]}
      value={direction}
    />
  );
}

/**
 * Settlement is a secondary choice: a caps label on the left, the compact
 * control on the right. The router wraps or unwraps inside the swap, so the
 * choice needs no explanation beside it.
 */
export function SettlementModeControl({
  direction,
  mode,
  onMode,
}: {
  readonly direction: ExchangeDirection;
  readonly mode: ExchangeSettlementMode;
  readonly onMode: (mode: ExchangeSettlementMode) => void;
}) {
  const label =
    direction === "buy"
      ? applicationCopy.exchange.payUsing
      : applicationCopy.exchange.receiveAs;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <p
        className="text-body-sm font-medium text-ink-soft"
        id="settlement-mode-label"
      >
        {label}
      </p>
      <SegmentedControl
        className="w-full compact:max-w-[14rem]"
        label={label}
        onValueChange={onMode}
        options={[
          { label: applicationCopy.exchange.nativeEth, value: "native" },
          { label: applicationCopy.exchange.wrappedEth, value: "wrapped" },
        ]}
        size="compact"
        value={mode}
      />
    </div>
  );
}
