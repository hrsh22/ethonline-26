import type {
  CanonicalMarketCandleFeed,
  CanonicalMarketCandleObservation,
} from "@orbit/protocol/history";
import type { Address, Hex } from "viem";

const HOURLY_INTERVAL_SECONDS = 3_600n;
const PRICE_SCALE = 10n ** 18n;
const MAXIMUM_CANDLES = 1_000;
const MAXIMUM_RESPONSE_BYTES = 2 * 1_024 * 1_024;

const POOL_HOUR_QUERY = `query CanonicalPoolHours($poolId: ID!, $poolFilter: String!, $limit: Int!) {
  pool(id: $poolId) {
    id
    token0 { id }
    token1 { id }
  }
  poolHourDatas(
    first: $limit
    orderBy: periodStartUnix
    orderDirection: desc
    where: { pool: $poolFilter }
  ) {
    periodStartUnix
    open
    high
    low
    close
  }
  swaps(
    first: $limit
    orderBy: timestamp
    orderDirection: desc
    where: { pool: $poolFilter }
  ) {
    timestamp
  }
  _meta {
    block { number }
    hasIndexingErrors
  }
}`;

type JsonRecord = Readonly<Record<string, unknown>>;

export interface UniswapV4CandleSourceOptions {
  readonly bearerToken: string | undefined;
  readonly cacheMilliseconds: number;
  readonly currency0: Address;
  readonly currency1: Address;
  readonly fetcher?: typeof fetch;
  readonly liquidToken: Address;
  readonly nowMilliseconds?: () => number;
  readonly poolId: Hex;
  readonly timeoutMilliseconds: number;
  readonly url: URL;
}

export interface UniswapV4CandleSource {
  readonly readLatest: () => Promise<CanonicalMarketCandleFeed>;
}

const record = (value: unknown, label: string): JsonRecord => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return value as JsonRecord;
};

const stringValue = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
};

const unsignedInteger = (value: unknown, label: string): bigint => {
  if (
    (typeof value !== "string" && typeof value !== "number") ||
    !/^(0|[1-9][0-9]*)$/u.test(String(value))
  ) {
    throw new TypeError(`${label} must be an unsigned integer`);
  }
  return BigInt(value);
};

interface DecimalFraction {
  readonly numerator: bigint;
  readonly denominator: bigint;
}

/** Parses GraphQL BigDecimal without losing price precision through Number. */
const decimalFraction = (value: unknown, label: string): DecimalFraction => {
  const encoded = stringValue(value, label);
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/u.exec(
    encoded,
  );
  if (match === null) throw new TypeError(`${label} must be a decimal`);
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? "0");
  if (!Number.isSafeInteger(exponent) || exponent < -256 || exponent > 256) {
    throw new RangeError(`${label} exponent is out of bounds`);
  }
  let numerator = BigInt(`${match[1]}${fraction}`);
  let denominator = 10n ** BigInt(fraction.length);
  if (exponent > 0) numerator *= 10n ** BigInt(exponent);
  if (exponent < 0) denominator *= 10n ** BigInt(-exponent);
  if (numerator === 0n) throw new RangeError(`${label} must be positive`);
  return { numerator, denominator };
};

const scaledDecimal = (value: unknown, label: string): bigint => {
  const decimal = decimalFraction(value, label);
  return (decimal.numerator * PRICE_SCALE) / decimal.denominator;
};

const scaledReciprocal = (value: unknown, label: string): bigint => {
  const decimal = decimalFraction(value, label);
  return (decimal.denominator * PRICE_SCALE) / decimal.numerator;
};

const checkedPrice = (value: bigint, label: string): bigint => {
  if (value === 0n) {
    throw new RangeError(`${label} lost all precision at 18 decimals`);
  }
  return value;
};

const candleFrom = (
  value: unknown,
  liquidIsCurrency0: boolean,
  swapCount: number,
): CanonicalMarketCandleObservation => {
  const hour = record(value, "Uniswap PoolHourData");
  const intervalStart = unsignedInteger(
    hour.periodStartUnix,
    "PoolHourData.periodStartUnix",
  );
  if (intervalStart % HOURLY_INTERVAL_SECONDS !== 0n) {
    throw new TypeError("PoolHourData timestamp must align to a UTC hour");
  }
  const direct = (input: unknown, label: string) =>
    checkedPrice(scaledDecimal(input, label), label);
  const inverse = (input: unknown, label: string) =>
    checkedPrice(scaledReciprocal(input, label), label);
  const prices = liquidIsCurrency0
    ? {
        // The official v4 subgraph stores OHLC as token0 per token1. This
        // deployment needs token1 (WETH) per token0 (the liquid token), so
        // inversion also swaps the high and low extrema.
        open: inverse(hour.open, "PoolHourData.open"),
        high: inverse(hour.low, "PoolHourData.low"),
        low: inverse(hour.high, "PoolHourData.high"),
        close: inverse(hour.close, "PoolHourData.close"),
      }
    : {
        open: direct(hour.open, "PoolHourData.open"),
        high: direct(hour.high, "PoolHourData.high"),
        low: direct(hour.low, "PoolHourData.low"),
        close: direct(hour.close, "PoolHourData.close"),
      };
  return {
    intervalStart,
    intervalEnd: intervalStart + HOURLY_INTERVAL_SECONDS,
    openWethPerLiquidTokenX18: prices.open,
    highWethPerLiquidTokenX18: prices.high,
    lowWethPerLiquidTokenX18: prices.low,
    closeWethPerLiquidTokenX18: prices.close,
    swapCount,
  };
};

const swapTimestampsFrom = (value: unknown): readonly bigint[] => {
  if (!Array.isArray(value)) {
    throw new TypeError("Uniswap v4 swaps must be an array");
  }
  if (value.length >= MAXIMUM_CANDLES) {
    throw new RangeError("Uniswap v4 swap coverage may be truncated");
  }
  const timestamps = value.map((item) =>
    unsignedInteger(
      record(item, "Uniswap v4 swap").timestamp,
      "Uniswap v4 swap timestamp",
    ),
  );
  timestamps.forEach((timestamp, index) => {
    const previous = timestamps[index - 1];
    if (previous !== undefined && previous < timestamp) {
      throw new TypeError("Uniswap v4 swaps are not descending by time");
    }
  });
  return timestamps;
};

const swapCountsByHour = (
  timestamps: readonly bigint[],
): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>();
  timestamps.forEach((timestamp) => {
    const start = timestamp - (timestamp % HOURLY_INTERVAL_SECONDS);
    const key = start.toString();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return counts;
};

const address = (value: unknown, label: string): string => {
  const decoded = stringValue(value, label).toLowerCase();
  if (!/^0x[0-9a-f]{40}$/u.test(decoded)) {
    throw new TypeError(`${label} must be an address`);
  }
  return decoded;
};

const readResponseBody = async (response: Response): Promise<unknown> => {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new TypeError("Uniswap v4 subgraph returned a non-JSON response");
  }
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    (!/^(0|[1-9][0-9]*)$/u.test(contentLength) ||
      BigInt(contentLength) > BigInt(MAXIMUM_RESPONSE_BYTES))
  ) {
    throw new RangeError("Uniswap v4 subgraph response is too large");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAXIMUM_RESPONSE_BYTES) {
    throw new RangeError("Uniswap v4 subgraph response is too large");
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
};

const liquidCurrencyPosition = (
  data: JsonRecord,
  options: UniswapV4CandleSourceOptions,
): boolean => {
  const pool = record(data.pool, "Uniswap v4 canonical pool");
  const token0 = record(pool.token0, "Uniswap v4 token0");
  const token1 = record(pool.token1, "Uniswap v4 token1");
  const matchesPool =
    stringValue(pool.id, "Uniswap v4 pool ID").toLowerCase() ===
    options.poolId.toLowerCase();
  const matchesCurrency0 =
    address(token0.id, "Uniswap v4 token0") === options.currency0.toLowerCase();
  const matchesCurrency1 =
    address(token1.id, "Uniswap v4 token1") === options.currency1.toLowerCase();
  if (!matchesPool || !matchesCurrency0 || !matchesCurrency1) {
    throw new TypeError(
      "Uniswap v4 subgraph pool identity does not match the deployment",
    );
  }
  const liquid = options.liquidToken.toLowerCase();
  if (liquid === options.currency0.toLowerCase()) return true;
  if (liquid === options.currency1.toLowerCase()) return false;
  throw new TypeError("Liquid token is not a canonical pool currency");
};

const candlesFrom = (
  data: JsonRecord,
  liquidIsCurrency0: boolean,
): readonly CanonicalMarketCandleObservation[] => {
  if (!Array.isArray(data.poolHourDatas)) {
    throw new TypeError("Uniswap v4 PoolHourData must be an array");
  }
  if (data.poolHourDatas.length >= MAXIMUM_CANDLES) {
    throw new RangeError("Uniswap v4 hourly coverage may be truncated");
  }
  const swapTimestamps = swapTimestampsFrom(data.swaps);
  const swapCounts = swapCountsByHour(swapTimestamps);
  return (
    data.poolHourDatas
      .map((item) => {
        const hour = record(item, "Uniswap PoolHourData");
        const start = unsignedInteger(
          hour.periodStartUnix,
          "PoolHourData.periodStartUnix",
        );
        return candleFrom(
          item,
          liquidIsCurrency0,
          swapCounts.get(start.toString()) ?? 0,
        );
      })
      // PoolHourData is also touched by initialization and liquidity changes.
      // Keep only hours proved to contain Swap entities. Full pages are rejected
      // above: silently omitting a boundary hour would conceal missing history.
      .filter((candle) => candle.swapCount > 0)
      .reverse()
  );
};

const feedFrom = (
  value: unknown,
  options: UniswapV4CandleSourceOptions,
): CanonicalMarketCandleFeed => {
  const body = record(value, "Uniswap v4 subgraph response");
  if (Array.isArray(body.errors) && body.errors.length > 0) {
    throw new TypeError("Uniswap v4 subgraph returned GraphQL errors");
  }
  const data = record(body.data, "Uniswap v4 subgraph data");
  const candles = candlesFrom(data, liquidCurrencyPosition(data, options));
  candles.forEach((candle, index) => {
    const previous = candles[index - 1];
    if (
      previous !== undefined &&
      previous.intervalStart >= candle.intervalStart
    ) {
      throw new TypeError("Uniswap v4 PoolHourData is not strictly ordered");
    }
  });
  const meta = record(data._meta, "Uniswap v4 subgraph metadata");
  const block = record(meta.block, "Uniswap v4 subgraph block");
  if (typeof meta.hasIndexingErrors !== "boolean") {
    throw new TypeError("Uniswap v4 indexing state must be boolean");
  }
  return {
    source: "uniswap-v4-subgraph",
    state: "available",
    interval: "1h",
    indexedThroughBlock: unsignedInteger(
      block.number,
      "Uniswap v4 indexed block",
    ),
    hasIndexingErrors: meta.hasIndexingErrors,
    candles,
  };
};

export const createUniswapV4CandleSource = (
  options: UniswapV4CandleSourceOptions,
): UniswapV4CandleSource => {
  let cached:
    | { readonly expiresAt: number; readonly feed: CanonicalMarketCandleFeed }
    | undefined;
  let inFlight: Promise<CanonicalMarketCandleFeed> | undefined;
  const now = options.nowMilliseconds ?? Date.now;
  const fetchLatest = async (): Promise<CanonicalMarketCandleFeed> => {
    const response = await (options.fetcher ?? fetch)(options.url, {
      body: JSON.stringify({
        query: POOL_HOUR_QUERY,
        variables: {
          limit: MAXIMUM_CANDLES,
          poolId: options.poolId.toLowerCase(),
          poolFilter: options.poolId.toLowerCase(),
        },
      }),
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(options.bearerToken === undefined
          ? {}
          : { authorization: `Bearer ${options.bearerToken}` }),
      },
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMilliseconds),
    });
    if (!response.ok) {
      throw new Error(`Uniswap v4 subgraph returned HTTP ${response.status}`);
    }
    return feedFrom(await readResponseBody(response), options);
  };
  const readLatest = (): Promise<CanonicalMarketCandleFeed> => {
    const currentTime = now();
    if (cached !== undefined && cached.expiresAt > currentTime) {
      return Promise.resolve(cached.feed);
    }
    if (inFlight !== undefined) return inFlight;
    const request = fetchLatest();
    const settled = request.then(
      (feed) => {
        cached = {
          expiresAt: now() + options.cacheMilliseconds,
          feed,
        };
        if (inFlight === settled) inFlight = undefined;
        return feed;
      },
      (cause: unknown) => {
        if (inFlight === settled) inFlight = undefined;
        throw cause;
      },
    );
    inFlight = settled;
    return settled;
  };
  return { readLatest };
};
