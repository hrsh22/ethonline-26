import {
  formatAddress,
  formatBasisPoints,
  formatCount,
  formatPercent,
  formatRate,
  formatTokenAmount,
  type FormattedValue,
  type TokenAmountOptions,
} from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Typeset measured values.
 *
 * These are the only components that render a chain-derived number. They keep
 * every value in tabular mono so columns align, attach the unit as quiet
 * evidence type rather than as part of the number, and expose the exact value
 * through `title` whenever the display has dropped precision — so no surface
 * has to choose between a readable column and a faithful one.
 *
 * They are server-safe on purpose: making a number readable must never force a
 * route into a client boundary.
 */
const valueClass = "font-mono tabular-nums";

/* Props are nullable rather than optional because the exported wrappers always
 * forward their own optional props through; under `exactOptionalPropertyTypes`
 * an optional target cannot receive an explicit `undefined`. */
function Value({
  className,
  formatted,
  unit,
  unitClassName,
}: {
  readonly className: string | undefined;
  readonly formatted: FormattedValue;
  readonly unit?: string | undefined;
  readonly unitClassName?: string | undefined;
}) {
  return (
    <span
      className={cn(valueClass, className)}
      // Only annotate when there is more precision to reveal; a title on an
      // already-exact value is noise for a screen reader and a pointer alike.
      title={formatted.abbreviated ? formatted.exact : undefined}
    >
      {formatted.display}
      {unit === undefined ? null : (
        <span
          className={cn(
            "ml-1.5 text-[0.8em] font-medium tracking-wide whitespace-nowrap text-ink-faint",
            unitClassName,
          )}
        >
          {unit}
        </span>
      )}
    </span>
  );
}

/** A token balance held in base units. */
export function Amount({
  className,
  unit,
  value,
  ...options
}: {
  readonly className?: string;
  readonly unit?: string;
  readonly value: bigint;
} & TokenAmountOptions) {
  return (
    <Value
      className={className}
      formatted={formatTokenAmount(value, options)}
      unit={unit}
    />
  );
}

/** A price or ratio. Keeps significant digits rather than a fixed width. */
export function Rate({
  className,
  unit,
  value,
  ...options
}: {
  readonly className?: string;
  readonly unit?: string;
  readonly value: bigint;
} & TokenAmountOptions) {
  return (
    <Value
      className={className}
      formatted={formatRate(value, options)}
      unit={unit}
    />
  );
}

/** A whole count of identities, blocks, or observations. */
export function Count({
  className,
  unit,
  value,
}: {
  readonly className?: string;
  readonly unit?: string;
  readonly value: bigint | number;
}) {
  return (
    <Value className={className} formatted={formatCount(value)} unit={unit} />
  );
}

/** A percentage supplied as a fraction of one. */
export function Percent({
  className,
  fractionDigits,
  value,
}: {
  readonly className?: string;
  readonly fractionDigits?: number;
  readonly value: number;
}) {
  return (
    <Value
      className={className}
      formatted={formatPercent(value, fractionDigits)}
    />
  );
}

/** A percentage supplied in basis points, the unit fees are configured in. */
export function BasisPoints({
  className,
  fractionDigits,
  value,
}: {
  readonly className?: string;
  readonly fractionDigits?: number;
  readonly value: bigint | number;
}) {
  return (
    <Value
      className={className}
      formatted={formatBasisPoints(value, fractionDigits)}
    />
  );
}

/** An account or contract address, elided in the middle. */
export function Address({
  className,
  value,
}: {
  readonly className?: string;
  readonly value: string;
}) {
  return <Value className={className} formatted={formatAddress(value)} />;
}

/**
 * A value a surface could not read.
 *
 * Routes used to fill unreadable slots with repeated "Not loaded" strings, so
 * six dead tiles stood in for one missing wallet. An unreadable value renders
 * as a quiet em dash with the reason attached, and the surface states the
 * actual condition once, in its own state feedback.
 */
export function Unavailable({
  className,
  reason,
}: {
  readonly className?: string;
  readonly reason: string;
}) {
  return (
    <span
      aria-label={reason}
      className={cn(valueClass, "text-ink-faint", className)}
      title={reason}
    >
      —
    </span>
  );
}
