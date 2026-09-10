import { readFileSync, writeFileSync } from "node:fs";
const endpoint =
  "https://api.studio.thegraph.com/query/85163/orbit-market/0.1.3";
const poolId =
  "0xcf6ffb9f078721909ca4fb59177c1d58160405929272a0a5dcb0807306c6b43d";
for (const file of ["standard-market", "reward-funding", "privy-trade"]) {
  const query = readFileSync(
    new URL(`../queries/${file}.graphql`, import.meta.url),
    "utf8",
  );
  const variables =
    file === "reward-funding"
      ? { poolId }
      : file === "privy-trade"
        ? {
            hash: "0x86b97644279a23a0c281d51807cff93dc305c5d094e140ae6d6ba51fc2ebb928",
          }
        : {};
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(20000),
  });
  const result = await response.json();
  if (!response.ok || result.errors)
    throw new Error(`Graph query failed: ${file}`);
  if (
    file === "reward-funding" &&
    (!result.data.rewardFundingSummary || result.data._meta.hasIndexingErrors)
  )
    throw new Error("Index not ready or has indexing errors");
  if (file === "standard-market" && !result.data.liquidityPools.length)
    throw new Error("Standard market has not indexed yet");
  if (file === "privy-trade") {
    const fees = result.data.hookFeeAccruals;
    const swaps = result.data.swaps;
    if (
      result.data._meta.hasIndexingErrors ||
      fees.length !== 1 ||
      swaps.length !== 1 ||
      fees[0].feesWeth !== "210000000000000" ||
      fees[0].trader.toLowerCase() !==
        "0xd86df743ee66906981e34beecfd5f7afd89caac9" ||
      swaps[0].amountOut !== "1171360501692246067"
    )
      throw new Error(
        "Privy canonical trade evidence did not match the expected receipt",
      );
  }
  writeFileSync(
    new URL(`../evidence/${file}.json`, import.meta.url),
    `${JSON.stringify({ endpoint, queriedAt: new Date().toISOString(), variables, result }, null, 2)}\n`,
  );
  console.log(`${file}: verified live response`);
}
