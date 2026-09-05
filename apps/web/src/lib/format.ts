import { formatUnits } from "viem";

/**
 * Presentation of measured values.
 *
 * Every value this application shows comes from chain state as a bigint in
 * some token's base units. Rendering `formatUnits(value, 18)` directly, as the
 * routes used to, prints the exact decimal expansion — `0.005750386365257872`
 * for a rate, `0.003718500000000005` for a fee balance — which is unreadable
 * and overflows its container. Truncating at a fixed number of fraction digits
 * fails the other way: it turns every value below that cutoff into `0`, so a
 * real nonzero balance reads as empty.
 *
 * So precision here is chosen by *significant* digits. Small values keep
 * enough fraction digits to stay meaningful, large values stay short, and the
 * exact value is always carried alongside the display string so a surface can
 * offer it for inspection or copying rather than silently dropping it.
 */
export interface FormattedValue {
  /** The string to render. Grouped, rounded, and safe in a narrow column. */
  readonly display: string;
  /** The full-precision decimal expansion, for a copy or inspect affordance. */
  readonly exact: string;
  /** True when `display` has dropped precision that `exact` still carries. */
  readonly abbreviated: boolean;
}

export interface TokenAmountOptions {
  /** Base-unit exponent of the token. Defaults to 18. */
  readonly decimals?: number;
  /**
   * Significant digits to keep for values below 1, counted from the first
   * nonzero digit. Five keeps `0.0057504` legible without inventing accuracy.
   */
  readonly significantDigits?: number;
  /** Fraction digits to keep once the value reaches 1. */
  readonly fractionDigits?: number;
  /** Pad the fraction to this width so a column of values stays aligned. */
  readonly minimumFractionDigits?: number;
  /**
   * Hard ceiling on rendered fraction digits. A value too small to survive
   * this ceiling renders as a `< …` bound rather than as a false zero.
   */
  readonly maximumFractionDigits?: number;
}

const TEN = 10n;

const power = (exponent: number): bigint => TEN ** BigInt(exponent);

/** Round-half-up division, exact in bigint space at any magnitude. */
const divideRounded = (value: bigint, divisor: bigint): bigint => {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const rounded = (magnitude * 2n + divisor) / (divisor * 2n);
  return negative ? -rounded : rounded;
};

const groupThousands = (digits: string): string =>
  digits.replace(/\B(?=(?:\d{3})+(?!\d))/gu, ",");

const splitDecimal = (
  text: string,
): { readonly whole: string; readonly fraction: string } => {
  const [whole = "0", fraction = ""] = text.split(".");
  return { whole, fraction };
};

/**
 * Fraction digits needed to show `significantDigits` meaningful digits.
 *
 * For a value at or above 1 the integer part already carries the magnitude, so
 * a fixed fraction width reads better in a column. Below 1 the width has to
 * grow with the run of leading zeros, otherwise small balances collapse.
 */
const fractionWidth = (
  fraction: string,
  whole: string,
  significantDigits: number,
  fractionDigits: number,
): number => {
  if (whole !== "0") return fractionDigits;
  const firstSignificant = /[1-9]/u.exec(fraction)?.index;
  if (firstSignificant === undefined) return fractionDigits;
  return firstSignificant + significantDigits;
};

const trimTrailingZeros = (fraction: string, minimum: number): string => {
  const trimmed = fraction.replace(/0+$/u, "");
  return trimmed.length >= minimum
    ? trimmed
    : fraction.slice(0, Math.max(minimum, trimmed.length));
};

interface ResolvedOptions {
  readonly decimals: number;
  readonly significantDigits: number;
  readonly fractionDigits: number;
  readonly minimumFractionDigits: number;
  readonly maximumFractionDigits: number;
}

const resolveOptions = (options: TokenAmountOptions): ResolvedOptions => {
  const decimals = options.decimals ?? 18;
  return {
    decimals,
    significantDigits: options.significantDigits ?? 5,
    fractionDigits: options.fractionDigits ?? 4,
    minimumFractionDigits: options.minimumFractionDigits ?? 0,
    maximumFractionDigits: options.maximumFractionDigits ?? decimals,
  };
};

const formattedZero = (
  exact: string,
  minimumFractionDigits: number,
): FormattedValue => ({
  display:
    minimumFractionDigits === 0
      ? "0"
      : `0.${"0".repeat(minimumFractionDigits)}`,
  exact,
  abbreviated: false,
});

/**
 * The smallest value the requested width can represent.
 *
 * Reported when a caller's ceiling is tighter than the value is small, so the
 * reader sees a bound they can reason about instead of a zero they would trust.
 */
const formattedBound = (exact: string, width: number): FormattedValue => ({
  display: `< ${width === 0 ? "1" : `0.${"0".repeat(width - 1)}1`}`,
  exact,
  abbreviated: true,
});

/** Reassembles a scaled integer into a grouped decimal string. */
const composeDecimal = (
  magnitude: bigint,
  width: number,
  minimumFractionDigits: number,
): string => {
  const digits = magnitude.toString().padStart(width + 1, "0");
  const wholeDigits = digits.slice(0, digits.length - width) || "0";
  const fraction =
    width === 0
      ? ""
      : trimTrailingZeros(digits.slice(-width), minimumFractionDigits);
  const grouped = groupThousands(wholeDigits);
  return fraction.length === 0 ? grouped : `${grouped}.${fraction}`;
};

/**
 * Formats a token balance held in base units.
 *
 * The returned `display` is always a faithful rounding of the input: it never
 * reports zero for a nonzero value, and it never invents digits beyond the
 * token's own precision.
 */
export const formatTokenAmount = (
  value: bigint,
  options: TokenAmountOptions = {},
): FormattedValue => {
  const resolved = resolveOptions(options);
  const exact = formatUnits(value, resolved.decimals);
  if (value === 0n) {
    return formattedZero(exact, resolved.minimumFractionDigits);
  }

  const negative = value < 0n;
  const unsigned = negative ? exact.slice(1) : exact;
  const { whole, fraction } = splitDecimal(unsigned);
  const width = Math.min(
    Math.max(
      fractionWidth(
        fraction,
        whole,
        resolved.significantDigits,
        resolved.fractionDigits,
      ),
      resolved.minimumFractionDigits,
    ),
    resolved.maximumFractionDigits,
    resolved.decimals,
  );

  const scaled = divideRounded(value, power(resolved.decimals - width));
  if (scaled === 0n) return formattedBound(exact, width);

  const decimal = composeDecimal(
    scaled < 0n ? -scaled : scaled,
    width,
    resolved.minimumFractionDigits,
  );
  const shownFractionLength = splitDecimal(decimal).fraction.length;
  return {
    display: `${negative ? "-" : ""}${decimal}`,
    exact,
    abbreviated: fraction.replace(/0+$/u, "").length > shownFractionLength,
  };
};

/** Formats a whole count. Counts are grouped and never abbreviated. */
export const formatCount = (value: bigint | number): FormattedValue => {
  const exact = value.toString();
  const negative = exact.startsWith("-");
  const digits = negative ? exact.slice(1) : exact;
  return {
    display: `${negative ? "-" : ""}${groupThousands(digits)}`,
    exact,
    abbreviated: false,
  };
};

/**
 * Formats a rate as `unit per unit`. Rates are the smallest values the
 * application shows, so they keep significant digits rather than a fixed width.
 */
export const formatRate = (
  value: bigint,
  options: TokenAmountOptions = {},
): FormattedValue =>
  formatTokenAmount(value, { significantDigits: 5, ...options });

/**
 * Abbreviates an address to its checksummed head and tail.
 *
 * The middle is elided with a true ellipsis rather than dropped, and the full
 * address stays available in `exact` so it can be copied.
 */
export const formatAddress = (address: string): FormattedValue => ({
  display:
    address.length <= 12
      ? address
      : `${address.slice(0, 6)}…${address.slice(-4)}`,
  exact: address,
  abbreviated: address.length > 12,
});

/** Formats a percentage already expressed as a fraction of one. */
export const formatPercent = (
  fraction: number,
  fractionDigits = 2,
): FormattedValue => {
  const exact = `${fraction * 100}%`;
  return {
    display: `${(fraction * 100).toFixed(fractionDigits)}%`,
    exact,
    abbreviated: false,
  };
};

/** Formats basis points, the unit protocol fees are configured in. */
export const formatBasisPoints = (
  basisPoints: bigint | number,
  fractionDigits = 2,
): FormattedValue =>
  formatPercent(Number(basisPoints) / 10_000, fractionDigits);
