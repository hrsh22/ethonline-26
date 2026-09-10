import { BigInt, BigDecimal, ethereum } from "@graphprotocol/graph-ts";
import {
  UsageMetricsDailySnapshot,
  UsageMetricsHourlySnapshot,
  FinancialsDailySnapshot,
  LiquidityPoolDailySnapshot,
  LiquidityPoolHourlySnapshot,
  LiquidityPool,
  DexAmmProtocol,
  Account,
  ActiveAccount,
} from "../generated/schema";
import { POOL, PROTOCOL } from "./constants";
const ZERO = BigInt.zero();
const DZERO = BigDecimal.zero();
export function snapshots(
  event: ethereum.Event,
  pool: LiquidityPool,
  kind: i32,
  volume0: BigInt,
  volume1: BigInt,
): void {
  let protocol = DexAmmProtocol.load(PROTOCOL)!;
  let account = event.transaction.from.toHexString();
  if (kind < 2 && Account.load(account) == null) {
    let a = new Account(account);
    a.save();
    protocol.cumulativeUniqueUsers += 1;
    protocol.save();
  }
  if (kind < 2) {
    let s0id = event.block.timestamp.div(BigInt.fromI32(86400)).toString();
    let s0 = UsageMetricsDailySnapshot.load(s0id);
    if (s0 == null) {
      s0 = new UsageMetricsDailySnapshot(s0id);
      s0.protocol = PROTOCOL;
      s0.dailyActiveUsers = 0;
      s0.cumulativeUniqueUsers = 0;
      s0.dailyTransactionCount = 0;
      s0.dailyDepositCount = 0;
      s0.dailyWithdrawCount = 0;
      s0.dailySwapCount = 0;
      s0.totalPoolCount = 0;
      s0.blockNumber = ZERO;
      s0.timestamp = ZERO;
    }
    s0.blockNumber = event.block.number;
    s0.timestamp = event.block.timestamp;
    s0.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
    s0.totalPoolCount = 1;
    if (kind == 1) s0.dailySwapCount += 1;
    else if (kind == 0) s0.dailyDepositCount += 1;
    let s0user = "daily-user-" + s0id + "-" + account;
    if (ActiveAccount.load(s0user) == null) {
      let a = new ActiveAccount(s0user);
      a.save();
      s0.dailyActiveUsers += 1;
    }
    let s0tx = "daily-tx-" + s0id + "-" + event.transaction.hash.toHexString();
    if (ActiveAccount.load(s0tx) == null) {
      let a = new ActiveAccount(s0tx);
      a.save();
      s0.dailyTransactionCount += 1;
    }
    s0.save();
    let s1id = event.block.timestamp.div(BigInt.fromI32(3600)).toString();
    let s1 = UsageMetricsHourlySnapshot.load(s1id);
    if (s1 == null) {
      s1 = new UsageMetricsHourlySnapshot(s1id);
      s1.protocol = PROTOCOL;
      s1.hourlyActiveUsers = 0;
      s1.cumulativeUniqueUsers = 0;
      s1.hourlyTransactionCount = 0;
      s1.hourlyDepositCount = 0;
      s1.hourlyWithdrawCount = 0;
      s1.hourlySwapCount = 0;
      s1.blockNumber = ZERO;
      s1.timestamp = ZERO;
    }
    s1.blockNumber = event.block.number;
    s1.timestamp = event.block.timestamp;
    s1.cumulativeUniqueUsers = protocol.cumulativeUniqueUsers;
    if (kind == 1) s1.hourlySwapCount += 1;
    else if (kind == 0) s1.hourlyDepositCount += 1;
    let s1user = "hourly-user-" + s1id + "-" + account;
    if (ActiveAccount.load(s1user) == null) {
      let a = new ActiveAccount(s1user);
      a.save();
      s1.hourlyActiveUsers += 1;
    }
    let s1tx = "hourly-tx-" + s1id + "-" + event.transaction.hash.toHexString();
    if (ActiveAccount.load(s1tx) == null) {
      let a = new ActiveAccount(s1tx);
      a.save();
      s1.hourlyTransactionCount += 1;
    }
    s1.save();
  }
  let s2id = event.block.timestamp.div(BigInt.fromI32(86400)).toString();
  let s2 = FinancialsDailySnapshot.load(s2id);
  if (s2 == null) {
    s2 = new FinancialsDailySnapshot(s2id);
    s2.protocol = PROTOCOL;
    s2.totalValueLockedUSD = DZERO;
    s2.dailyVolumeUSD = DZERO;
    s2.cumulativeVolumeUSD = DZERO;
    s2.dailySupplySideRevenueUSD = DZERO;
    s2.cumulativeSupplySideRevenueUSD = DZERO;
    s2.dailyProtocolSideRevenueUSD = DZERO;
    s2.cumulativeProtocolSideRevenueUSD = DZERO;
    s2.dailyTotalRevenueUSD = DZERO;
    s2.cumulativeTotalRevenueUSD = DZERO;
    s2.blockNumber = ZERO;
    s2.timestamp = ZERO;
  }
  s2.blockNumber = event.block.number;
  s2.timestamp = event.block.timestamp;
  s2.save();
  let s3id =
    POOL + "-" + event.block.timestamp.div(BigInt.fromI32(86400)).toString();
  let s3 = LiquidityPoolDailySnapshot.load(s3id);
  if (s3 == null) {
    s3 = new LiquidityPoolDailySnapshot(s3id);
    s3.protocol = PROTOCOL;
    s3.pool = POOL;
    s3.blockNumber = ZERO;
    s3.timestamp = ZERO;
    s3.totalValueLockedUSD = DZERO;
    s3.cumulativeSupplySideRevenueUSD = DZERO;
    s3.dailySupplySideRevenueUSD = DZERO;
    s3.cumulativeProtocolSideRevenueUSD = DZERO;
    s3.dailyProtocolSideRevenueUSD = DZERO;
    s3.cumulativeTotalRevenueUSD = DZERO;
    s3.dailyTotalRevenueUSD = DZERO;
    s3.dailyVolumeUSD = DZERO;
    s3.dailyVolumeByTokenAmount = [ZERO, ZERO];
    s3.dailyVolumeByTokenUSD = [DZERO, DZERO];
    s3.cumulativeVolumeUSD = DZERO;
    s3.inventoryComplete = pool.inventoryComplete;
    s3.inputTokenBalances = [ZERO, ZERO];
    s3.inputTokenWeights = [DZERO, DZERO];
  }
  s3.blockNumber = event.block.number;
  s3.timestamp = event.block.timestamp;
  s3.inventoryComplete = pool.inventoryComplete;
  s3.inputTokenBalances = pool.inputTokenBalances;
  s3.inputTokenWeights = pool.inputTokenWeights;
  let s3vol = s3.dailyVolumeByTokenAmount;
  s3vol[0] = s3vol[0].plus(volume0);
  s3vol[1] = s3vol[1].plus(volume1);
  s3.dailyVolumeByTokenAmount = s3vol;
  s3.save();
  let s4id =
    POOL + "-" + event.block.timestamp.div(BigInt.fromI32(3600)).toString();
  let s4 = LiquidityPoolHourlySnapshot.load(s4id);
  if (s4 == null) {
    s4 = new LiquidityPoolHourlySnapshot(s4id);
    s4.protocol = PROTOCOL;
    s4.pool = POOL;
    s4.blockNumber = ZERO;
    s4.timestamp = ZERO;
    s4.totalValueLockedUSD = DZERO;
    s4.cumulativeSupplySideRevenueUSD = DZERO;
    s4.hourlySupplySideRevenueUSD = DZERO;
    s4.cumulativeProtocolSideRevenueUSD = DZERO;
    s4.hourlyProtocolSideRevenueUSD = DZERO;
    s4.cumulativeTotalRevenueUSD = DZERO;
    s4.hourlyTotalRevenueUSD = DZERO;
    s4.hourlyVolumeUSD = DZERO;
    s4.hourlyVolumeByTokenAmount = [ZERO, ZERO];
    s4.hourlyVolumeByTokenUSD = [DZERO, DZERO];
    s4.cumulativeVolumeUSD = DZERO;
    s4.inventoryComplete = pool.inventoryComplete;
    s4.inputTokenBalances = [ZERO, ZERO];
    s4.inputTokenWeights = [DZERO, DZERO];
  }
  s4.blockNumber = event.block.number;
  s4.timestamp = event.block.timestamp;
  s4.inventoryComplete = pool.inventoryComplete;
  s4.inputTokenBalances = pool.inputTokenBalances;
  s4.inputTokenWeights = pool.inputTokenWeights;
  let s4vol = s4.hourlyVolumeByTokenAmount;
  s4vol[0] = s4vol[0].plus(volume0);
  s4vol[1] = s4vol[1].plus(volume1);
  s4.hourlyVolumeByTokenAmount = s4vol;
  s4.save();
}
