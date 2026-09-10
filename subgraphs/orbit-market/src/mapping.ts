import {
  BigInt,
  BigDecimal,
  Bytes,
  Address,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import {
  Swap as SwapEvent,
  ModifyLiquidity,
  Donate,
} from "../generated/PoolManager/PoolManager";
import { FeeAccrued } from "../generated/CanonicalFeeHook/CanonicalFeeHook";
import {
  RewardEpochOpened,
  TrackExecuted,
} from "../generated/EpochConverter/EpochConverter";
import {
  RewardNotified,
  RewardClaimed,
} from "../generated/RewardLedger/RewardLedger";
import { ProtocolLiquidityAdded } from "../generated/ProtocolLiquidityVault/ProtocolLiquidityVault";
import {
  Token,
  DexAmmProtocol,
  LiquidityPool,
  LiquidityPoolFee,
  Swap,
  Deposit,
  Account,
  ActiveAccount,
  RewardFundingSummary,
  HookFeeAccrual,
  RewardConversion,
  RewardEpoch,
  RewardDistribution,
  RewardClaim,
} from "../generated/schema";
import { snapshots } from "./snapshots";
import {
  POOL,
  MANAGER,
  PROTOCOL,
  FUEL,
  WETH,
  ROUTER,
  GENESIS_VAULT,
  LIQUIDITY_VAULT,
} from "./constants";
const ZERO = BigInt.zero();
const DZERO = BigDecimal.zero();

// Schema-v3 deployments do not register the retired genesis vault, so Graph
// no longer generates its event class. Keep the legacy handler structurally
// compatible without making current builds depend on that removed data source.
export class GenesisLiquiditySeeded extends ethereum.Event {
  get params(): GenesisLiquiditySeededParams {
    return new GenesisLiquiditySeededParams(this);
  }
}

export class GenesisLiquiditySeededParams {
  private event: GenesisLiquiditySeeded;

  constructor(event: GenesisLiquiditySeeded) {
    this.event = event;
  }

  get poolId(): Bytes {
    return this.event.parameters[0].value.toBytes();
  }

  get liquidTokenAmount(): BigInt {
    return this.event.parameters[2].value.toBigInt();
  }
}

export function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}
export function pool(event: ethereum.Event): LiquidityPool {
  let result = LiquidityPool.load(POOL);
  if (result != null) return result;
  token(FUEL);
  token(WETH);
  let protocol = new DexAmmProtocol(PROTOCOL);
  protocol.name = "ORBIT 4444 canonical Uniswap v4 market";
  protocol.slug = "orbit-market";
  protocol.schemaVersion = "1.3.2";
  protocol.subgraphVersion = "0.1.3";
  protocol.methodologyVersion = "1.0.0";
  protocol.network = "BASE_SEPOLIA";
  protocol.type = "EXCHANGE";
  protocol.totalValueLockedUSD = DZERO;
  protocol.cumulativeVolumeUSD = DZERO;
  protocol.cumulativeSupplySideRevenueUSD = DZERO;
  protocol.cumulativeProtocolSideRevenueUSD = DZERO;
  protocol.cumulativeTotalRevenueUSD = DZERO;
  protocol.cumulativeUniqueUsers = 0;
  protocol.totalPoolCount = 1;
  protocol.save();
  let fee = new LiquidityPoolFee("hook-weth-" + POOL);
  fee.feeType = "FIXED_TRADING_FEE";
  fee.feePercentage = BigDecimal.fromString("3");
  fee.save();
  result = new LiquidityPool(POOL);
  result.protocol = PROTOCOL;
  result.name = "FUEL / test WETH";
  result.symbol = "FUEL-WETH";
  result.inputTokens = [FUEL, WETH];
  result.fees = [fee.id];
  result.isSingleSided = false;
  result.createdTimestamp = event.block.timestamp;
  result.createdBlockNumber = event.block.number;
  result.totalValueLockedUSD = DZERO;
  result.cumulativeSupplySideRevenueUSD = DZERO;
  result.cumulativeProtocolSideRevenueUSD = DZERO;
  result.cumulativeTotalRevenueUSD = DZERO;
  result.cumulativeVolumeUSD = DZERO;
  result.inputTokenBalances = [ZERO, ZERO];
  result.inputTokenWeights = [];
  result.poolManager = Bytes.fromHexString(MANAGER);
  result.chainId = 84532;
  result.inventoryComplete = true;
  result.feeBasisToken = WETH;
  result.testAssets = true;
  result.balanceMethodology = "canonical-deposits-minus-pool-swap-deltas";
  result.weightMethodology = "not-applicable-concentrated-liquidity";
  result.save();
  let summary = new RewardFundingSummary(POOL);
  summary.pool = POOL;
  summary.totalFeesWeth = ZERO;
  summary.totalRewardsWeth = ZERO;
  summary.totalLiquidityWeth = ZERO;
  summary.totalCreatorWeth = ZERO;
  summary.totalConvertedWeth = ZERO;
  summary.feeEventCount = 0;
  summary.conversionCount = 0;
  summary.lastEventBlock = event.block.number;
  summary.lastEventTimestamp = event.block.timestamp;
  summary.save();
  return result;
}
function touch(event: ethereum.Event): RewardFundingSummary {
  pool(event);
  let s = RewardFundingSummary.load(POOL)!;
  s.lastEventBlock = event.block.number;
  s.lastEventTimestamp = event.block.timestamp;
  return s;
}
export function handleSwap(event: SwapEvent): void {
  if (event.params.id.toHexString() != POOL) return;
  let p = pool(event);
  let a0 = event.params.amount0;
  let a1 = event.params.amount1;
  let balances = p.inputTokenBalances;
  if (p.inventoryComplete) {
    balances[0] = balances[0].minus(a0);
    balances[1] = balances[1].minus(a1);
    assert(
      balances[0].ge(ZERO) && balances[1].ge(ZERO),
      "Canonical inventory must not become negative",
    );
    p.inputTokenBalances = balances;
    p.save();
    tokenBalances(balances);
  }
  let s = new Swap("swap-" + eventId(event));
  s.hash = event.transaction.hash.toHexString();
  s.logIndex = event.logIndex.toI32();
  s.protocol = PROTOCOL;
  s.from = event.params.sender.toHexString();
  s.to = event.params.sender.toHexString();
  s.blockNumber = event.block.number;
  s.timestamp = event.block.timestamp;
  s.tokenIn = a0.lt(ZERO) ? FUEL : WETH;
  s.tokenOut = a0.lt(ZERO) ? WETH : FUEL;
  s.amountIn = a0.lt(ZERO) ? a0.neg() : a1.neg();
  s.amountOut = a0.gt(ZERO) ? a0 : a1;
  s.amountInUSD = DZERO;
  s.amountOutUSD = DZERO;
  if (p.inventoryComplete) s.reserveAmounts = balances;
  s.pool = POOL;
  s.save();
  snapshots(event, p, 1, a0.abs(), a1.abs());
  let summary = touch(event);
  summary.save();
}
export function handleFee(event: FeeAccrued): void {
  pool(event);
  let f = new HookFeeAccrual(eventId(event));
  f.pool = POOL;
  f.hash = event.transaction.hash.toHexString();
  f.logIndex = event.logIndex.toI32();
  f.blockNumber = event.block.number;
  f.timestamp = event.block.timestamp;
  f.trader = event.params.trader;
  f.wethVolume = event.params.wethVolume;
  f.feesWeth = event.params.totalFee;
  f.rewardsWeth = event.params.rewardAmount;
  f.liquidityWeth = event.params.liquidityAmount;
  f.creatorWeth = event.params.creatorAmount;
  f.save();
  let s = touch(event);
  s.totalFeesWeth = s.totalFeesWeth.plus(f.feesWeth);
  s.totalRewardsWeth = s.totalRewardsWeth.plus(f.rewardsWeth);
  s.totalLiquidityWeth = s.totalLiquidityWeth.plus(f.liquidityWeth);
  s.totalCreatorWeth = s.totalCreatorWeth.plus(f.creatorWeth);
  s.feeEventCount += 1;
  s.save();
}
export function handleConversion(event: TrackExecuted): void {
  let s = touch(event);
  let c = new RewardConversion(eventId(event));
  c.pool = POOL;
  c.hash = event.transaction.hash.toHexString();
  c.logIndex = event.logIndex.toI32();
  c.blockNumber = event.block.number;
  c.timestamp = event.block.timestamp;
  c.track = event.params.track;
  c.wethSpent = event.params.wethInput;
  c.stockReceived = event.params.measuredStockOutput;
  c.deferredWeth = event.params.deferredTrackBudget;
  c.save();
  // Reverted conversions emit no TrackExecuted; every indexed event is measured success.
  s.totalConvertedWeth = s.totalConvertedWeth.plus(c.wethSpent);
  s.conversionCount += 1;
  s.save();
}
export function handleEpoch(event: RewardEpochOpened): void {
  let s = touch(event);
  s.save();
  let e = new RewardEpoch(eventId(event));
  e.hash = event.transaction.hash.toHexString();
  e.blockNumber = event.block.number;
  e.timestamp = event.block.timestamp;
  e.epochNumber = event.params.epochNumber;
  e.openedWeth = event.params.openedAmount;
  e.equalTrackShare = event.params.equalTrackShare;
  e.finalTrackRemainder = event.params.finalTrackRemainder;
  e.save();
}
export function handleDistribution(event: RewardNotified): void {
  let s = touch(event);
  s.save();
  let d = new RewardDistribution(eventId(event));
  d.hash = event.transaction.hash.toHexString();
  d.blockNumber = event.block.number;
  d.timestamp = event.block.timestamp;
  d.track = event.params.track;
  d.token = event.params.token;
  d.amount = event.params.amount;
  d.ordinaryAllocation = event.params.ordinaryAllocation;
  d.basketRelicAllocation = event.params.basketRelicAllocation;
  d.indicatorRelicAllocation = event.params.indicatorRelicAllocation;
  d.save();
}
export function handleClaim(event: RewardClaimed): void {
  let s = touch(event);
  s.save();
  let c = new RewardClaim(eventId(event));
  c.hash = event.transaction.hash.toHexString();
  c.blockNumber = event.block.number;
  c.timestamp = event.block.timestamp;
  c.track = event.params.track;
  c.owner = event.params.currentOwner;
  c.identityId = event.params.identityId;
  c.amount = event.params.amount;
  c.save();
}
function deposit(
  event: ethereum.Event,
  amount0: BigInt,
  amount1: BigInt,
): void {
  let p = pool(event);
  let balances = p.inputTokenBalances;
  if (p.inventoryComplete) {
    balances[0] = balances[0].plus(amount0);
    balances[1] = balances[1].plus(amount1);
    p.inputTokenBalances = balances;
    p.save();
    tokenBalances(balances);
  }
  let d = new Deposit("deposit-" + eventId(event));
  d.hash = event.transaction.hash.toHexString();
  d.logIndex = event.logIndex.toI32();
  d.protocol = PROTOCOL;
  d.from = event.address.toHexString();
  d.to = MANAGER;
  d.blockNumber = event.block.number;
  d.timestamp = event.block.timestamp;
  d.inputTokens = [FUEL, WETH];
  d.inputTokenAmounts = [amount0, amount1];
  if (p.inventoryComplete) d.reserveAmounts = balances;
  d.amountUSD = DZERO;
  d.pool = POOL;
  d.save();
  snapshots(event, p, 0, ZERO, ZERO);
  let s = touch(event);
  s.save();
}
export function handleGenesis(event: GenesisLiquiditySeeded): void {
  if (event.params.poolId.toHexString() != POOL) return;
  deposit(event, event.params.liquidTokenAmount, ZERO);
}
export function handleLiquidity(event: ProtocolLiquidityAdded): void {
  deposit(event, ZERO, event.params.consumedWeth);
}

function token(address: string): Token {
  let t = Token.load(address);
  if (t != null) return t;
  t = new Token(address);
  t.inventoryComplete = true;
  t.name = address == FUEL ? "ORBIT Fuel" : "WETH MOCK TEST Self-Funded";
  t.symbol = address == FUEL ? "FUEL" : "MOCK-WETH-TEST";
  t.decimals = 18;
  t.lastPriceUSD = DZERO;
  t._totalSupply = ZERO;
  t._totalValueLockedUSD = DZERO;
  t._largePriceChangeBuffer = 0;
  t._largeTVLImpactBuffer = 0;
  t.save();
  return t;
}
function tokenBalances(balances: BigInt[]): void {
  let fuel = token(FUEL);
  fuel._totalSupply = balances[0];
  fuel.save();
  let weth = token(WETH);
  weth._totalSupply = balances[1];
  weth.save();
}

function invalidateInventory(event: ethereum.Event): void {
  let p = pool(event);
  p.inventoryComplete = false;
  p.balanceMethodology = "unavailable-untracked-pool-change";
  p.inputTokenBalances = [];
  p.save();
  let fuel = token(FUEL);
  fuel.inventoryComplete = false;
  fuel.save();
  let weth = token(WETH);
  weth.inventoryComplete = false;
  weth.save();
  // The raw standardized reserve array is empty rather than a guessed balance.
  // Historical snapshots retain the completeness state of the last observed event.
  snapshots(event, p, 2, ZERO, ZERO);
}
export function handleModifyLiquidity(event: ModifyLiquidity): void {
  if (event.params.id.toHexString() != POOL) return;
  let sender = event.params.sender.toHexString();
  if (sender != GENESIS_VAULT && sender != LIQUIDITY_VAULT)
    invalidateInventory(event);
}
export function handleDonate(event: Donate): void {
  if (event.params.id.toHexString() == POOL) invalidateInventory(event);
}
