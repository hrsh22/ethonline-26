import {
  deriveDiscoveryMaintenance,
  type DiscoveryBatchObservation,
  type DiscoveryMaintenance,
} from "@orbit/protocol/discovery";
import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import { createProtocolContracts } from "@orbit/protocol/contracts";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  type Address,
  type Hex,
  type SimulateContractParameters,
  type WriteContractParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

export type DiscoveryMaintenanceAction = Exclude<
  DiscoveryMaintenance,
  { readonly kind: "wait" }
>;

export interface DiscoveryMaintenanceAttempt {
  readonly status: "simulated" | "confirmed" | "failed";
  readonly transactionHash?: Hex;
  readonly reason?: string;
}

export interface DiscoveryMaintenanceChain {
  readonly observe: () => Promise<DiscoveryBatchObservation | undefined>;
  readonly attempt: (
    action: DiscoveryMaintenanceAction,
    execute: boolean,
  ) => Promise<DiscoveryMaintenanceAttempt>;
}

export interface DiscoveryMaintenanceEvidence {
  readonly status: "idle" | "waiting" | "simulated" | "failed" | "action-limit";
  readonly reason: string;
  readonly actions: readonly (DiscoveryMaintenanceAction &
    DiscoveryMaintenanceAttempt)[];
  readonly head?: DiscoveryBatchObservation;
}

type DiscoverySigningAccount = ReturnType<typeof privateKeyToAccount>;

export const bindLocalDiscoverySigner = <Request extends object>(
  request: Request,
  account: DiscoverySigningAccount,
): Request & { readonly account: DiscoverySigningAccount } => ({
  ...request,
  account,
});

export const runDiscoveryMaintenance = async ({
  chain,
  execute,
  maximumActions,
}: {
  readonly chain: DiscoveryMaintenanceChain;
  readonly execute: boolean;
  readonly maximumActions: number;
}): Promise<DiscoveryMaintenanceEvidence> => {
  if (!Number.isSafeInteger(maximumActions) || maximumActions <= 0) {
    throw new RangeError("maximumActions must be a positive safe integer");
  }
  const actions: Array<
    DiscoveryMaintenanceAction & DiscoveryMaintenanceAttempt
  > = [];
  for (let index = 0; index < maximumActions; index += 1) {
    const head = await chain.observe();
    if (head === undefined) {
      return {
        status: "idle",
        reason: "No Discovery Batch needs maintenance.",
        actions,
      };
    }
    const maintenance = deriveDiscoveryMaintenance(head);
    if (maintenance.kind === "wait") {
      return {
        status: "waiting",
        reason: maintenance.reason,
        actions,
        head,
      };
    }
    const attempt = await chain.attempt(maintenance, execute);
    actions.push({ ...maintenance, ...attempt });
    if (attempt.status === "failed") {
      return {
        status: "failed",
        reason: attempt.reason ?? "Discovery maintenance failed safely.",
        actions,
        head,
      };
    }
    if (!execute || attempt.status === "simulated") {
      return {
        status: "simulated",
        reason: maintenance.reason,
        actions,
        head,
      };
    }
  }
  return {
    status: "action-limit",
    reason: `Discovery maintenance stopped after ${maximumActions} confirmed actions; the next cycle will continue.`,
    actions,
  };
};

const requestState = (raw: number): DiscoveryBatchObservation["state"] => {
  if (raw === 1) return "awaiting-randomness";
  if (raw === 2) return "ready";
  if (raw === 3) return "finalized";
  throw new TypeError(`Unknown discovery request state ${raw}`);
};

const maintenanceFunction = (action: DiscoveryMaintenanceAction) => {
  if (action.kind === "finalize") {
    return {
      functionName: "finalizeDiscovery" as const,
      args: [action.vrfRequestId, BigInt(action.maxCount)] as const,
    };
  }
  if (action.kind === "skip-cancelled") {
    return {
      functionName: "skipCancelledDiscovery" as const,
      args: [action.vrfRequestId] as const,
    };
  }
  return {
    functionName: "reportDelayedRequest" as const,
    args: [action.vrfRequestId] as const,
  };
};

export const maintainBaseSepoliaDiscovery = async ({
  execute,
  manifest,
  privateKey,
  rpcUrl,
}: {
  readonly execute: boolean;
  readonly manifest: ProtocolDeploymentManifest;
  readonly privateKey: Hex | undefined;
  readonly rpcUrl: string;
}): Promise<DiscoveryMaintenanceEvidence> => {
  if (execute && privateKey === undefined) {
    throw new Error("Discovery execute mode requires an operator signing key");
  }
  const transport = http(rpcUrl, {
    retryCount: 6,
    retryDelay: 250,
    timeout: 30_000,
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const signer =
    privateKey === undefined ? undefined : privateKeyToAccount(privateKey);
  const simulationAccount: Address =
    signer?.address ?? getAddress(manifest.roles.keeper);
  const walletClient =
    signer === undefined
      ? undefined
      : createWalletClient({ account: signer, chain: baseSepolia, transport });
  const adapter = createProtocolContracts(manifest).discoveryAdapter;

  const canSkipHead = async (
    vrfRequestId: bigint,
    blockNumber: bigint,
  ): Promise<boolean> => {
    try {
      await publicClient.simulateContract({
        account: simulationAccount,
        address: adapter.address,
        abi: adapter.abi,
        functionName: "skipCancelledDiscovery",
        args: [vrfRequestId],
        blockNumber,
      });
      return true;
    } catch {
      return false;
    }
  };

  const chain: DiscoveryMaintenanceChain = {
    observe: async () => {
      const block = await publicClient.getBlock();
      const [requestCount, nextSequence] = await Promise.all([
        publicClient.readContract({
          address: adapter.address,
          abi: adapter.abi,
          functionName: "requestSequenceCount",
          blockNumber: block.number,
        }),
        publicClient.readContract({
          address: adapter.address,
          abi: adapter.abi,
          functionName: "nextFinalizationSequence",
          blockNumber: block.number,
        }),
      ]);
      if (nextSequence >= requestCount) return undefined;
      const vrfRequestId = await publicClient.readContract({
        address: adapter.address,
        abi: adapter.abi,
        functionName: "vrfRequestIdAtSequence",
        args: [nextSequence],
        blockNumber: block.number,
      });
      const [status, delayed] = await Promise.all([
        publicClient.readContract({
          address: adapter.address,
          abi: adapter.abi,
          functionName: "requestStatus",
          args: [vrfRequestId],
          blockNumber: block.number,
        }),
        publicClient.readContract({
          address: adapter.address,
          abi: adapter.abi,
          functionName: "isDelayed",
          args: [vrfRequestId],
          blockNumber: block.number,
        }),
      ]);
      const [
        rawState,
        requestedAt,
        fulfilledAt,
        count,
        finalizedCount,
        delayReported,
      ] = status;
      const state = requestState(rawState);
      return {
        vrfRequestId,
        sequence: nextSequence,
        state,
        requestedAt,
        fulfilledAt: fulfilledAt === 0n ? undefined : fulfilledAt,
        count: Number(count),
        finalizedCount: Number(finalizedCount),
        delayReported,
        delayed,
        fullyCancelled:
          state === "awaiting-randomness"
            ? await canSkipHead(vrfRequestId, block.number)
            : false,
      };
    },
    attempt: async (action, shouldExecute) => {
      try {
        const call = maintenanceFunction(action);
        const simulation = await publicClient.simulateContract({
          account: simulationAccount,
          address: adapter.address,
          abi: adapter.abi,
          ...call,
        } as unknown as SimulateContractParameters);
        if (!shouldExecute) return { status: "simulated" };
        if (walletClient === undefined || signer === undefined) {
          throw new Error("Discovery signing client is unavailable");
        }
        const transactionHash = await walletClient.writeContract(
          // The public-client simulation is intentionally performed with an
          // address. Replace that address with the local account before the
          // write, otherwise viem delegates to eth_sendTransaction and a
          // public RPC correctly rejects the unknown unlocked account.
          bindLocalDiscoverySigner(
            simulation.request,
            signer,
          ) as unknown as WriteContractParameters,
        );
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: transactionHash,
          confirmations: 2,
        });
        return receipt.status === "success"
          ? { status: "confirmed", transactionHash }
          : {
              status: "failed",
              transactionHash,
              reason: "Discovery maintenance transaction reverted.",
            };
      } catch (cause) {
        return {
          status: "failed",
          reason: cause instanceof Error ? cause.message : String(cause),
        };
      }
    },
  };

  return runDiscoveryMaintenance({
    chain,
    execute,
    maximumActions: 8,
  });
};
