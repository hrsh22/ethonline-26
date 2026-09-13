import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const directory = fileURLToPath(new URL("..", import.meta.url));
try {
  process.loadEnvFile(resolve(directory, "../../.env"));
} catch {}

const endpoint = process.argv[2] ?? process.env.GRAPH_STUDIO_QUERY_URL;
if (
  endpoint === undefined ||
  !/^https:\/\/api\.studio\.thegraph\.com\/query\/85163\/orbit-market\/\d+\.\d+\.\d+$/u.test(
    endpoint,
  )
)
  throw new Error(
    "Pass the versioned orbit-market Studio query endpoint or set GRAPH_STUDIO_QUERY_URL",
  );

const manifest = JSON.parse(
  readFileSync(
    resolve(directory, "../../deployments/84532.staging.json"),
    "utf8",
  ),
);
const poolId = manifest.canonicalPool.poolId.toLowerCase();
const inputTokens = new Set([
  manifest.canonicalPool.currency0.toLowerCase(),
  manifest.canonicalPool.currency1.toLowerCase(),
]);
const evidenceBlockHash =
  "0x967c62ea5b813e05d9d7bbd9d2b2b19bcf153b178bf31492313d86aa4145a345";
const evidenceBlockNumber = 46_765_498;
const evidenceBlock = { hash: evidenceBlockHash };
const expectedDeployment = "QmPwMqYxUm5F1MRBDcJ9SzoM8R4JYgxiW1BcNCgZ96dDnX";
const stagingTradeHash =
  "0xaa43abc1d1fecb522317bf656ff276770686135b90306963bd59f9bb53d4358b";
const stagingTrade = {
  trader: "0xa497893bbe4855b76db26f18beef34cd0ee3cfdd",
  amountIn: "5820000000000000",
  amountOut: "1160956411569668706",
  wethVolume: "6000000000000000",
  feesWeth: "180000000000000",
  rewardsWeth: "120000000000000",
  liquidityWeth: "51000000000000",
  creatorWeth: "9000000000000",
};
const stagingFunding = {
  feeEventCount: 184,
  totalFeesWeth: "128048266397806156",
  totalRewardsWeth: "85365510931870743",
  totalLiquidityWeth: "36280342146045022",
  totalCreatorWeth: "6402413319890391",
  conversionCount: 8,
  totalConvertedWeth: "85365510931870743",
};
const stagingLifecycle = {
  bid: {
    id: "0x9bfbab71eb3fb79751339dd884eac4ccb080e5c4f41ecf89e18ab5919295c251-134",
    bidId: "0",
    owner: "0xb61d5f617df5f1484c608f04a0a21cb311a3aa73",
    priceQ96: "792281625142643375935439500",
    amount: "20000000000000000000",
  },
  activationId:
    "0x245681975db80dbf05847d9249100496814f748b9221be34d0aa3737f329c904-6",
  escrows: [
    {
      id: "0xb61d5f617df5f1484c608f04a0a21cb311a3aa73",
      beneficiary: "0xd288b7e8e8c968ee0f21f0ba5fb726e9d88dbea9",
      createdHash:
        "0x1aea5352c22b3e9f3692f1647394c0282c246218030f553e81de072052380d49",
    },
    {
      id: "0x4947f058c66bf58b6eafada3df9a50ebaacf89b1",
      beneficiary: "0xb78721b29c028b16ab25f4a2ade1d25fbf8b2d74",
      createdHash:
        "0xd75bfdc8baf3d6937693b728f91067b1b4402930efc8e6a4e402c9e5767a34a0",
    },
  ],
};

const requests = [
  { file: "standard-market", variables: { block: evidenceBlock } },
  {
    file: "reward-funding",
    variables: { block: evidenceBlock, poolId },
  },
  { file: "cca-lifecycle", variables: { block: evidenceBlock } },
  {
    file: "staging-trade",
    queryFile: "privy-trade",
    variables: { block: evidenceBlock, hash: stagingTradeHash },
  },
];

function validateMeta(data, file) {
  if (
    data?._meta?.hasIndexingErrors !== false ||
    data._meta.deployment !== expectedDeployment ||
    Number(data._meta.block?.number) !== evidenceBlockNumber ||
    data._meta.block?.hash?.toLowerCase() !== evidenceBlockHash
  )
    throw new Error(`${file}: index is unhealthy or behind staging evidence`);
}

function validate(file, data) {
  validateMeta(data, file);
  if (file === "standard-market") {
    if (
      data.dexAmmProtocols.length !== 1 ||
      data.dexAmmProtocols[0].schemaVersion !== "1.3.2" ||
      data.liquidityPools.length !== 1 ||
      data.liquidityPools[0].id.toLowerCase() !== poolId
    )
      throw new Error(
        "standard-market: canonical standardized pool is missing",
      );
    return;
  }
  if (file === "reward-funding") {
    const summary = data.rewardFundingSummary;
    const tokens = new Set(
      summary?.pool?.inputTokens?.map(({ id }) => id.toLowerCase()),
    );
    if (
      summary == null ||
      summary.id.toLowerCase() !== poolId ||
      summary.pool.id.toLowerCase() !== poolId ||
      tokens.size !== inputTokens.size ||
      [...inputTokens].some((token) => !tokens.has(token)) ||
      Number(summary.feeEventCount) !== stagingFunding.feeEventCount ||
      summary.totalFeesWeth !== stagingFunding.totalFeesWeth ||
      summary.totalRewardsWeth !== stagingFunding.totalRewardsWeth ||
      summary.totalLiquidityWeth !== stagingFunding.totalLiquidityWeth ||
      summary.totalCreatorWeth !== stagingFunding.totalCreatorWeth ||
      Number(summary.conversionCount) !== stagingFunding.conversionCount ||
      summary.totalConvertedWeth !== stagingFunding.totalConvertedWeth ||
      data.hookFeeAccruals.length !== stagingFunding.feeEventCount ||
      data.rewardConversions.length !== stagingFunding.conversionCount ||
      BigInt(summary.totalFeesWeth) !==
        BigInt(summary.totalRewardsWeth) +
          BigInt(summary.totalLiquidityWeth) +
          BigInt(summary.totalCreatorWeth)
    )
      throw new Error("reward-funding: staging totals or identity are invalid");
    return;
  }
  if (file === "cca-lifecycle") {
    const bid = data.auctionBidSubmissions[0];
    const activation = data.ccaActivations[0];
    if (
      data.auctionBidSubmissions.length !== 1 ||
      bid.id !== stagingLifecycle.bid.id ||
      bid.bidId !== stagingLifecycle.bid.bidId ||
      bid.owner.toLowerCase() !== stagingLifecycle.bid.owner ||
      bid.priceQ96 !== stagingLifecycle.bid.priceQ96 ||
      bid.amount !== stagingLifecycle.bid.amount ||
      data.auctionBidExits.length !== 0 ||
      data.auctionTokenClaims.length !== 0 ||
      data.ccaMigrations.length !== 0 ||
      data.ccaMigrationFailures.length !== 0 ||
      data.ccaFundsRecoveries.length !== 0 ||
      data.ccaActivations.length !== 1 ||
      activation.id !== stagingLifecycle.activationId ||
      activation.governanceOwner.toLowerCase() !==
        manifest.roles.governanceOwner.toLowerCase() ||
      data.ccaEscrows.length !== 2 ||
      data.ccaEscrows.some((escrow, index) => {
        const expected = stagingLifecycle.escrows[index];
        return (
          escrow.id.toLowerCase() !== expected.id ||
          escrow.beneficiary.toLowerCase() !== expected.beneficiary ||
          escrow.createdHash.toLowerCase() !== expected.createdHash
        );
      }) ||
      data.ccaEscrowWithdrawals.length !== 0
    )
      throw new Error(
        "cca-lifecycle: staging lifecycle is incomplete or contaminated",
      );
    return;
  }
  const swap = data.swaps[0];
  const fee = data.hookFeeAccruals[0];
  if (
    data.swaps.length !== 1 ||
    data.hookFeeAccruals.length !== 1 ||
    swap.hash.toLowerCase() !== stagingTradeHash ||
    fee.hash.toLowerCase() !== stagingTradeHash ||
    swap.pool.id.toLowerCase() !== poolId ||
    swap.pool.feeBasisToken.id.toLowerCase() !==
      manifest.contracts.weth.toLowerCase() ||
    swap.tokenIn.id.toLowerCase() !== manifest.contracts.weth.toLowerCase() ||
    swap.tokenOut.id.toLowerCase() !==
      manifest.contracts.fuelCore.toLowerCase() ||
    swap.amountIn !== stagingTrade.amountIn ||
    swap.amountOut !== stagingTrade.amountOut ||
    fee.trader.toLowerCase() !== stagingTrade.trader ||
    fee.wethVolume !== stagingTrade.wethVolume ||
    fee.feesWeth !== stagingTrade.feesWeth ||
    fee.rewardsWeth !== stagingTrade.rewardsWeth ||
    fee.liquidityWeth !== stagingTrade.liquidityWeth ||
    fee.creatorWeth !== stagingTrade.creatorWeth
  )
    throw new Error(
      "staging-trade: canonical swap and fee evidence do not match",
    );
}

for (const request of requests) {
  const query = readFileSync(
    new URL(
      `../queries/${request.queryFile ?? request.file}.graphql`,
      import.meta.url,
    ),
    "utf8",
  );
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables: request.variables }),
    signal: AbortSignal.timeout(20_000),
  });
  const result = await response.json();
  if (!response.ok || result.errors)
    throw new Error(`Graph query failed: ${request.file}`);
  validate(request.file, result.data);
  writeFileSync(
    new URL(`../evidence/${request.file}.json`, import.meta.url),
    `${JSON.stringify(
      {
        endpoint,
        manifest: "deployments/84532.staging.json",
        evidenceBlockHash,
        queriedAt: new Date().toISOString(),
        variables: request.variables,
        result,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${request.file}: verified live staging response`);
}
