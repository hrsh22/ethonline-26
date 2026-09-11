import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";
import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseAbiItem,
  zeroAddress,
  type Address,
  type Hex,
  type WriteContractParameters,
  type SimulateContractParameters,
} from "viem";
import { baseSepolia } from "viem/chains";

export interface CcaObservation {
  readonly blockNumber: bigint;
  readonly endBlock: bigint;
  readonly migrationBlock: bigint;
  readonly checkpointBlock: bigint;
  readonly graduated: boolean;
  readonly reservation: "auction" | "consumed" | "other";
  readonly poolInitialized: boolean;
  readonly canonicalPosition: boolean;
  readonly positionToRegister?: bigint;
  readonly ready: boolean;
  readonly activated: boolean;
  readonly launched: boolean;
}

export type CcaAction =
  | {
      readonly kind: "checkpoint" | "migrate" | "recover-and-seed" | "activate";
    }
  | { readonly kind: "register-position"; readonly tokenId: bigint };
export type CcaPlan =
  | CcaAction
  | {
      readonly kind: "wait" | "terminal" | "complete";
      readonly reason: string;
    };

export function planCcaMaintenance(state: CcaObservation): CcaPlan {
  if (state.activated && state.launched)
    return {
      kind: "complete",
      reason: "Coordinator activated and FUEL launched.",
    };
  if (state.activated || state.launched)
    return {
      kind: "wait",
      reason: "Coordinator and FUEL launch state disagree.",
    };
  if (state.blockNumber < state.endBlock)
    return { kind: "wait", reason: "Auction has not ended." };
  if (state.checkpointBlock < state.endBlock) return { kind: "checkpoint" };
  if (!state.graduated)
    return {
      kind: "terminal",
      reason: "Auction failed graduation; refunds remain available.",
    };
  if (state.blockNumber < state.migrationBlock)
    return { kind: "wait", reason: "Waiting for the migration block." };
  return planCcaMigration(state);
}

function planCcaMigration(state: CcaObservation): CcaPlan {
  if (state.reservation === "other")
    return {
      kind: "terminal",
      reason: "Canonical pool reservation belongs to another auction.",
    };
  if (!state.poolInitialized)
    return {
      kind: state.reservation === "auction" ? "migrate" : "recover-and-seed",
    };
  if (!state.canonicalPosition && state.positionToRegister !== undefined)
    return { kind: "register-position", tokenId: state.positionToRegister };
  if (state.ready && !state.activated) return { kind: "activate" };
  return {
    kind: "wait",
    reason:
      "Waiting for canonical position custody, readiness, and launch state.",
  };
}

export interface CcaAttempt {
  readonly status: "simulated" | "confirmed" | "failed" | "submitted-unknown";
  readonly blockNumber?: bigint;
  readonly transactionHash?: `0x${string}`;
  readonly reason?: string;
}
export interface CcaMaintenanceChain {
  readonly observe: (minimumBlock?: bigint) => Promise<CcaObservation>;
  readonly attempt: (
    action: CcaAction,
    execute: boolean,
  ) => Promise<CcaAttempt>;
}

export async function runCcaMaintenance({
  chain,
  execute,
  minimumBlock,
}: {
  readonly chain: CcaMaintenanceChain;
  readonly execute: boolean;
  readonly minimumBlock?: bigint;
}) {
  const head = await chain.observe(minimumBlock);
  const plan = planCcaMaintenance(head);
  if ("reason" in plan)
    return {
      status: plan.kind,
      complete: plan.kind === "complete",
      head,
      plan,
    };
  const attempt = await chain.attempt(plan, execute);
  if (attempt.status !== "confirmed")
    return { ...attempt, complete: false, head, plan };
  if (attempt.blockNumber === undefined)
    throw new Error("CCA confirmation has no canonical block");
  const after = await chain.observe(attempt.blockNumber);
  const next = planCcaMaintenance(after);
  return {
    ...attempt,
    complete: next.kind === "complete",
    head: after,
    plan,
    next,
  };
}

const positionAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getPoolAndPositionInfo(uint256 tokenId) view returns ((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks),uint256)",
  "function getPositionLiquidity(uint256 tokenId) view returns (uint128)",
]);

const classifyReservation = (
  reservation: Address,
  auction: Address,
): CcaObservation["reservation"] =>
  getAddress(reservation) === getAddress(auction)
    ? "auction"
    : reservation === zeroAddress
      ? "consumed"
      : "other";

/** Revalidate the simulated observation immediately before guarded submission. */
export async function submitCcaFromCanonicalObservation(input: {
  readonly observation: { readonly number: bigint; readonly hash: Hex };
  readonly readBlockHash: (number: bigint) => Promise<Hex>;
  readonly assertMaySign: () => void;
  readonly submit: () => Promise<Hex>;
}): Promise<Hex> {
  if (
    (await input.readBlockHash(input.observation.number)) !==
    input.observation.hash
  )
    throw new Error("CCA observation block changed before signing");
  input.assertMaySign();
  return input.submit();
}

/** All writes use the operator's guarded, durable local signed outbox. */
export async function maintainBaseSepoliaCca(input: {
  readonly manifest: ProtocolDeploymentManifest;
  readonly rpcUrl: string;
  readonly execute: boolean;
  readonly account: Address;
  readonly minimumBlock?: bigint;
  readonly assertMaySign: () => void;
  readonly submitTransaction: (
    request: WriteContractParameters,
  ) => Promise<Hex>;
}) {
  if (input.manifest.schemaVersion !== 3) return undefined;
  const manifest = input.manifest;
  const contracts = createProtocolContracts(manifest);
  const client = createPublicClient({
    chain: baseSepolia,
    transport: http(input.rpcUrl),
  });
  if ((await client.getChainId()) !== manifest.chainId)
    throw new Error("CCA RPC chain does not match deployment");
  const auction = contracts.continuousClearingAuction;
  const strategy = contracts.ccaStrategy;
  const recipient = contracts.permanentPositionRecipient;
  const poolId = manifest.canonicalPool.poolId as Hex;
  let observationBlock = 0n;
  let observationHash: Hex | undefined;
  const chain: CcaMaintenanceChain = {
    observe: async (minimumBlock) => {
      const block = await client.getBlock();
      if (minimumBlock !== undefined && block.number < minimumBlock)
        throw new Error("CCA RPC is behind a confirmed submission");
      observationBlock = block.number;
      observationHash = block.hash;
      const pinned = { blockNumber: block.number };
      const [
        endBlock,
        migrationBlock,
        checkpointBlock,
        graduated,
        reservation,
        slot0,
        canonicalPosition,
        ready,
        activated,
        launched,
      ] = await Promise.all([
        client.readContract({
          ...auction,
          ...pinned,
          functionName: "endBlock",
        }),
        client.readContract({
          ...contracts.ccaRecoverySeeder,
          ...pinned,
          functionName: "migrationBlock",
        }),
        client.readContract({
          ...auction,
          ...pinned,
          functionName: "lastCheckpointedBlock",
        }),
        client.readContract({
          ...auction,
          ...pinned,
          functionName: "isGraduated",
        }),
        client.readContract({
          ...strategy,
          ...pinned,
          functionName: "registeredPoolIds",
          args: [poolId],
        }),
        client.readContract({
          ...contracts.uniswapV4PoolManager,
          ...pinned,
          functionName: "extsload",
          args: [
            keccak256(
              encodeAbiParameters(
                [{ type: "bytes32" }, { type: "uint256" }],
                [poolId, 6n],
              ),
            ),
          ],
        }),
        client.readContract({
          ...recipient,
          ...pinned,
          functionName: "hasCanonicalPosition",
        }),
        client.readContract({
          ...contracts.ccaCanonicalLaunchReadiness,
          ...pinned,
          functionName: "isReady",
        }),
        client.readContract({
          ...contracts.ccaLaunchCoordinator,
          ...pinned,
          functionName: "activated",
        }),
        client.readContract({
          ...contracts.fuelCore,
          ...pinned,
          functionName: "launched",
        }),
      ]);
      if (checkpointBlock >= endBlock && graduated)
        await client.readContract({
          ...auction,
          ...pinned,
          functionName: "lbpInitializationParams",
        });
      const poolInitialized = (BigInt(slot0) & ((1n << 160n) - 1n)) !== 0n;
      const findPosition = async (): Promise<bigint | undefined> => {
        let positionToRegister: bigint | undefined;
        const manager = await client.readContract({
          ...recipient,
          ...pinned,
          functionName: "positionManager",
        });
        if (
          getAddress(manager) !==
          getAddress(contracts.uniswapV4PositionManager.address)
        )
          throw new Error(
            "Permanent recipient is not bound to the canonical PositionManager",
          );
        const expected = await client.readContract({
          ...recipient,
          ...pinned,
          functionName: "expectedPoolId",
        });
        if (expected.toLowerCase() !== poolId.toLowerCase())
          throw new Error("Permanent recipient has a different canonical pool");
        // Bounded RPC ranges; restart discovery from immutable setup provenance.
        for (
          let fromBlock = BigInt(manifest.launch.blockNumber);
          fromBlock <= block.number && positionToRegister === undefined;
          fromBlock += 2000n
        ) {
          const toBlock =
            fromBlock + 1999n < block.number ? fromBlock + 1999n : block.number;
          const transfers = await client.getLogs({
            address: manager,
            event: parseAbiItem(
              "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
            ),
            args: { to: recipient.address },
            fromBlock,
            toBlock,
            strict: true,
          });
          const verifyPosition = async (tokenId: bigint) => {
            const [owner, info, liquidity, received] = await Promise.all([
              client.readContract({
                address: manager,
                abi: positionAbi,
                ...pinned,
                functionName: "ownerOf",
                args: [tokenId],
              }),
              client.readContract({
                address: manager,
                abi: positionAbi,
                ...pinned,
                functionName: "getPoolAndPositionInfo",
                args: [tokenId],
              }),
              client.readContract({
                address: manager,
                abi: positionAbi,
                ...pinned,
                functionName: "getPositionLiquidity",
                args: [tokenId],
              }),
              client.readContract({
                ...recipient,
                ...pinned,
                functionName: "receivedPosition",
                args: [tokenId],
              }),
            ]);
            const key = info[0];
            const actualPoolId = keccak256(
              encodeAbiParameters(
                [
                  { type: "address" },
                  { type: "address" },
                  { type: "uint24" },
                  { type: "int24" },
                  { type: "address" },
                ],
                [
                  key.currency0,
                  key.currency1,
                  key.fee,
                  key.tickSpacing,
                  key.hooks,
                ],
              ),
            );
            return (
              getAddress(owner) === getAddress(recipient.address) &&
              !received &&
              liquidity > 0n &&
              actualPoolId.toLowerCase() === poolId.toLowerCase()
            );
          };
          for (const transfer of transfers) {
            if (!(await verifyPosition(transfer.args.tokenId))) continue;
            positionToRegister = transfer.args.tokenId;
            break;
          }
        }
        return positionToRegister;
      };
      const positionToRegister =
        poolInitialized && !canonicalPosition
          ? await findPosition()
          : undefined;
      if (
        (await client.getBlock({ blockNumber: block.number })).hash !==
        block.hash
      )
        throw new Error("CCA observation block changed during reads");
      return {
        blockNumber: block.number,
        endBlock,
        migrationBlock,
        checkpointBlock,
        graduated,
        reservation: classifyReservation(reservation, auction.address),
        poolInitialized,
        canonicalPosition,
        ...(positionToRegister === undefined ? {} : { positionToRegister }),
        ready,
        activated,
        launched,
      };
    },
    attempt: async (action, execute) => {
      let transactionHash: Hex | undefined;
      let submitting = false;
      try {
        const actionRequest = () =>
          action.kind === "checkpoint"
            ? { ...auction, functionName: "checkpoint" as const }
            : action.kind === "migrate"
              ? {
                  ...strategy,
                  functionName: "migrate" as const,
                  args: [auction.address] as const,
                }
              : action.kind === "recover-and-seed"
                ? {
                    ...contracts.ccaRecoverySeeder,
                    functionName: "recoverAndSeed" as const,
                  }
                : action.kind === "register-position"
                  ? {
                      ...recipient,
                      functionName: "registerPosition" as const,
                      args: [action.tokenId] as const,
                    }
                  : {
                      ...contracts.ccaLaunchCoordinator,
                      functionName: "activate" as const,
                    };
        const simulation = await client.simulateContract({
          ...actionRequest(),
          account: input.account,
          blockNumber: observationBlock,
        } as unknown as SimulateContractParameters);
        if (!execute) return { status: "simulated" };
        if (observationHash === undefined)
          throw new Error("CCA observation hash is unavailable");
        transactionHash = await submitCcaFromCanonicalObservation({
          observation: { number: observationBlock, hash: observationHash },
          readBlockHash: async (blockNumber) =>
            (await client.getBlock({ blockNumber })).hash,
          assertMaySign: input.assertMaySign,
          submit: () => {
            submitting = true;
            return input.submitTransaction(
              simulation.request as unknown as WriteContractParameters,
            );
          },
        });
        const receipt = await client.waitForTransactionReceipt({
          hash: transactionHash,
        });
        if (
          (await client.getBlock({ blockNumber: receipt.blockNumber })).hash !==
          receipt.blockHash
        )
          throw new Error("CCA receipt is not canonical");
        return {
          status: receipt.status === "success" ? "confirmed" : "failed",
          transactionHash,
          blockNumber: receipt.blockNumber,
        };
      } catch (error) {
        return {
          status: submitting ? "submitted-unknown" : "failed",
          ...(transactionHash === undefined ? {} : { transactionHash }),
          reason: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
  return runCcaMaintenance({
    chain,
    execute: input.execute,
    ...(input.minimumBlock === undefined
      ? {}
      : { minimumBlock: input.minimumBlock }),
  });
}
