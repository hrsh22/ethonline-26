import { formatUnits } from "viem";

const Q96 = 1n << 96n;
const DISPLAY_SCALE = 10n ** 18n;
const PRICE_DISPLAY_DECIMALS = 6;

export const formatAuctionPriceQ96 = (value: bigint): string =>
  formatUnits(
    (value * 10n ** BigInt(PRICE_DISPLAY_DECIMALS) + Q96 / 2n) / Q96,
    PRICE_DISPLAY_DECIMALS,
  );

export const parseAuctionPriceQ96 = (
  value: string,
  floor: bigint,
  spacing: bigint,
): bigint => {
  const normalized = value.trim();
  if (!/^\d+(?:\.\d{0,18})?$/u.test(normalized))
    throw new RangeError("Enter a maximum price with at most 18 decimals.");
  if (spacing <= 0n) throw new RangeError("Auction tick spacing is invalid.");

  const [whole, fraction = ""] = normalized.split(".") as [string, string?];
  const decimal = BigInt(`${whole}${fraction.padEnd(18, "0")}`);
  const requested = (decimal * Q96) / DISPLAY_SCALE;
  if (requested <= floor)
    throw new RangeError(
      `Set a maximum price above the floor price. The first valid price is ${formatAuctionPriceQ96(floor + spacing)}.`,
    );

  const delta = requested - floor;
  const completeTicks = delta / spacing;
  const remainder = delta % spacing;
  const tolerance = Q96 / DISPLAY_SCALE;
  if (remainder === 0n || remainder <= tolerance)
    return floor + completeTicks * spacing;
  if (spacing - remainder <= tolerance)
    return floor + (completeTicks + 1n) * spacing;

  const nextTick = floor + (completeTicks + 1n) * spacing;
  throw new RangeError(
    `Use a valid price increment, such as ${formatAuctionPriceQ96(nextTick)}.`,
  );
};
