import {
  modelGenesisCurve,
  type GenesisCurveInput,
} from "@orbit/protocol/genesis-curve";
import { Data, Effect, Schema } from "effect";

const DECIMALS = 18;
const DECIMAL_SCALE = 10n ** BigInt(DECIMALS);

const DecimalAmount = Schema.String.pipe(
  Schema.pattern(/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/u),
);
const UnsignedInteger = Schema.String.pipe(
  Schema.pattern(/^(0|[1-9][0-9]*)$/u),
);
const RepresentativeAmounts = Schema.Array(DecimalAmount).pipe(
  Schema.filter((values) => values.length > 0, {
    message: () => "At least one representative trade is required",
  }),
);
const SensitivitySchema = Schema.Struct({
  name: Schema.String.pipe(Schema.minLength(1)),
  openingTick: Schema.Number.pipe(Schema.int()),
  tickLower: Schema.Number.pipe(Schema.int()),
  tickUpper: Schema.Number.pipe(Schema.int()),
});
const GenesisCurveConfigurationSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  name: Schema.String.pipe(Schema.minLength(1)),
  supplyLiquidToken: DecimalAmount,
  currencyOrder: Schema.Literal("weth0-liquid-token1", "liquid-token0-weth1"),
  tickSpacing: Schema.Number.pipe(Schema.int(), Schema.positive()),
  openingTick: Schema.Number.pipe(Schema.int()),
  tickLower: Schema.Number.pipe(Schema.int()),
  tickUpper: Schema.Number.pipe(Schema.int()),
  feePolicy: Schema.Struct({
    denominator: UnsignedInteger,
    totalFee: UnsignedInteger,
  }),
  exactOutputLiquidToken: RepresentativeAmounts,
  exactInputWeth: RepresentativeAmounts,
  sensitivity: Schema.Array(SensitivitySchema),
});

type GenesisCurveConfigurationFile =
  typeof GenesisCurveConfigurationSchema.Type;

export interface GenesisCurveSensitivityInput {
  readonly name: string;
  readonly input: GenesisCurveInput;
}

export interface DecodedGenesisCurveConfiguration {
  readonly name: string;
  readonly input: GenesisCurveInput;
  readonly sensitivity: readonly GenesisCurveSensitivityInput[];
}

export class GenesisCurveConfigurationError extends Data.TaggedError(
  "GenesisCurveConfigurationError",
)<{
  readonly message: string;
  readonly cause: unknown;
}> {}

const parseDecimalAmount = (value: string): bigint => {
  const [whole, fractional = ""] = value.split(".");
  const fractionalWei = `${fractional}${"0".repeat(DECIMALS)}`.slice(
    0,
    DECIMALS,
  );
  return BigInt(whole ?? "0") * DECIMAL_SCALE + BigInt(fractionalWei);
};

const toModelInput = (
  configuration: GenesisCurveConfigurationFile,
): GenesisCurveInput => ({
  supplyLiquidTokenWei: parseDecimalAmount(configuration.supplyLiquidToken),
  liquidTokenIsCurrency0: configuration.currencyOrder === "liquid-token0-weth1",
  tickSpacing: configuration.tickSpacing,
  openingTick: configuration.openingTick,
  tickLower: configuration.tickLower,
  tickUpper: configuration.tickUpper,
  feePolicy: {
    denominator: BigInt(configuration.feePolicy.denominator),
    totalFee: BigInt(configuration.feePolicy.totalFee),
  },
  exactOutputLiquidTokenWei:
    configuration.exactOutputLiquidToken.map(parseDecimalAmount),
  exactInputWethWei: configuration.exactInputWeth.map(parseDecimalAmount),
});

const materializeConfiguration = (
  configuration: GenesisCurveConfigurationFile,
): DecodedGenesisCurveConfiguration => {
  const input = toModelInput(configuration);
  modelGenesisCurve(input);
  const sensitivity = configuration.sensitivity.map((scenario) => {
    const scenarioInput = {
      ...input,
      openingTick: scenario.openingTick,
      tickLower: scenario.tickLower,
      tickUpper: scenario.tickUpper,
    };
    modelGenesisCurve(scenarioInput);
    return { name: scenario.name, input: scenarioInput };
  });
  return { name: configuration.name, input, sensitivity };
};

const configurationFailure = (cause: unknown): GenesisCurveConfigurationError =>
  new GenesisCurveConfigurationError({
    message: `Genesis curve configuration is invalid${
      cause instanceof Error ? `: ${cause.message}` : ""
    }`,
    cause,
  });

export const decodeGenesisCurveConfiguration = (
  input: unknown,
): Effect.Effect<
  DecodedGenesisCurveConfiguration,
  GenesisCurveConfigurationError
> =>
  Schema.decodeUnknown(GenesisCurveConfigurationSchema)(input).pipe(
    Effect.mapError(configurationFailure),
    Effect.flatMap((configuration) =>
      Effect.try({
        try: () => materializeConfiguration(configuration),
        catch: configurationFailure,
      }),
    ),
  );
