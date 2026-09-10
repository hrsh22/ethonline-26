import {
  test,
  assert,
  clearStore,
  newMockEvent,
  createMockedFunction,
  beforeEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { FeeAccrued } from "../generated/CanonicalFeeHook/CanonicalFeeHook";
import { Swap, Donate } from "../generated/PoolManager/PoolManager";
import { TrackExecuted } from "../generated/EpochConverter/EpochConverter";
import {
  GenesisLiquiditySeeded,
  handleFee,
  handleSwap,
  handleGenesis,
  handleConversion,
  handleDonate,
} from "../src/mapping";
import { POOL, FUEL, WETH, ROUTER } from "../src/constants";
function uint(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(
    name,
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value)),
  );
}
function integer(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(
    name,
    ethereum.Value.fromSignedBigInt(BigInt.fromI32(value)),
  );
}
function seed(): void {
  let e = changetype<GenesisLiquiditySeeded>(newMockEvent());
  e.logIndex = BigInt.fromI32(1);
  e.parameters = [
    new ethereum.EventParam(
      "poolId",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(POOL)),
    ),
    uint("liquidity", 100),
    uint("liquidTokenAmount", 4444),
    uint("roundingDust", 0),
    integer("tickLower", 0),
    integer("tickUpper", 60),
  ];
  handleGenesis(e);
}
beforeEach(() => {
  clearStore();
  createMockedFunction(
    Address.fromString(FUEL),
    "totalSupply",
    "totalSupply():(uint256)",
  ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(4444))]);
  createMockedFunction(
    Address.fromString(WETH),
    "totalSupply",
    "totalSupply():(uint256)",
  ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(1000000))]);
});
test("canonical reserves exclude other singleton pools and hook fee amounts", () => {
  seed();
  let e = changetype<Swap>(newMockEvent());
  e.logIndex = BigInt.fromI32(2);
  e.parameters = [
    new ethereum.EventParam(
      "id",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(POOL)),
    ),
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(ROUTER)),
    ),
    integer("amount0", 10),
    integer("amount1", -100),
    uint("sqrtPriceX96", 1),
    uint("liquidity", 100),
    integer("tick", 1),
    uint("fee", 0),
  ];
  handleSwap(e);
  assert.fieldEquals(
    "LiquidityPool",
    POOL,
    "inputTokenBalances",
    "[4434, 100]",
  );
  assert.entityCount("Swap", 1);
  assert.fieldEquals("LiquidityPool", POOL, "totalValueLockedUSD", "0");
  e.parameters[0] = new ethereum.EventParam(
    "id",
    ethereum.Value.fromFixedBytes(
      Bytes.fromHexString(
        "0x0000000000000000000000000000000000000000000000000000000000000001",
      ),
    ),
  );
  e.logIndex = BigInt.fromI32(3);
  handleSwap(e);
  assert.entityCount("Swap", 1);
  assert.fieldEquals(
    "LiquidityPool",
    POOL,
    "inputTokenBalances",
    "[4434, 100]",
  );
});
test("exact hook splits retain integer rounding and separate multiple logs", () => {
  seed();
  let e = changetype<FeeAccrued>(newMockEvent());
  e.logIndex = BigInt.fromI32(2);
  e.parameters = [
    new ethereum.EventParam(
      "trader",
      ethereum.Value.fromAddress(Address.fromString(ROUTER)),
    ),
    uint("wethVolume", 103),
    uint("totalFee", 3),
    uint("rewardAmount", 2),
    uint("liquidityAmount", 0),
    uint("creatorAmount", 1),
  ];
  handleFee(e);
  e.logIndex = BigInt.fromI32(3);
  handleFee(e);
  assert.entityCount("HookFeeAccrual", 2);
  assert.fieldEquals("RewardFundingSummary", POOL, "totalFeesWeth", "6");
  assert.fieldEquals("RewardFundingSummary", POOL, "totalRewardsWeth", "4");
  assert.fieldEquals("RewardFundingSummary", POOL, "totalCreatorWeth", "2");
  assert.fieldEquals("RewardFundingSummary", POOL, "feeEventCount", "2");
});
test("conversion records successful spend independently from retained track budget", () => {
  seed();
  let e = changetype<TrackExecuted>(newMockEvent());
  e.logIndex = BigInt.fromI32(2);
  e.parameters = [
    uint("track", 1),
    uint("wethInput", 17),
    uint("measuredStockOutput", 52),
    uint("deferredTrackBudget", 9),
  ];
  handleConversion(e);
  assert.entityCount("RewardConversion", 1);
  assert.fieldEquals("RewardFundingSummary", POOL, "totalConvertedWeth", "17");
  assert.fieldEquals("RewardFundingSummary", POOL, "conversionCount", "1");
});

test("untracked donations invalidate inventory without stopping funding history", () => {
  seed();
  let d = changetype<Donate>(newMockEvent());
  d.parameters = [
    new ethereum.EventParam(
      "id",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(POOL)),
    ),
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(ROUTER)),
    ),
    uint("amount0", 0),
    uint("amount1", 19),
  ];
  handleDonate(d);
  assert.fieldEquals("LiquidityPool", POOL, "inventoryComplete", "false");
  assert.fieldEquals("LiquidityPool", POOL, "inputTokenBalances", "[]");
  let e = changetype<Swap>(newMockEvent());
  e.logIndex = BigInt.fromI32(9);
  e.parameters = [
    new ethereum.EventParam(
      "id",
      ethereum.Value.fromFixedBytes(Bytes.fromHexString(POOL)),
    ),
    new ethereum.EventParam(
      "sender",
      ethereum.Value.fromAddress(Address.fromString(ROUTER)),
    ),
    integer("amount0", 10),
    integer("amount1", -100),
    uint("sqrtPriceX96", 1),
    uint("liquidity", 100),
    integer("tick", 1),
    uint("fee", 0),
  ];
  handleSwap(e);
  assert.entityCount("Swap", 1);
  assert.fieldEquals("LiquidityPool", POOL, "inputTokenBalances", "[]");
});
