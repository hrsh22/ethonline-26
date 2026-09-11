import { Schema } from "effect";

const EvmAddress = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/));

export const TestVenueConfigurationSchema = Schema.Struct({
  $schema: Schema.Literal("./venue-schema.json"),
  schemaVersion: Schema.Literal(1),
  environment: Schema.Literal("development-sepolia"),
  chainId: Schema.Literal(84_532),
  network: Schema.Literal("base-sepolia"),
  assetProfile: Schema.Literal(
    "self-funded-test-assets",
    "official-test-assets",
  ),
  operator: EvmAddress,
  contracts: Schema.Struct({
    weth: EvmAddress,
    usdc: EvmAddress,
    uniswapV4PoolManager: EvmAddress,
    testConversionVenue: EvmAddress,
    mockAaplc: EvmAddress,
    mockGooglc: EvmAddress,
    mockMetac: EvmAddress,
    mockNvdac: EvmAddress,
  }),
});

export type TestVenueConfiguration = typeof TestVenueConfigurationSchema.Type;

export const decodeTestVenueConfiguration = Schema.decodeUnknownSync(
  TestVenueConfigurationSchema,
);
