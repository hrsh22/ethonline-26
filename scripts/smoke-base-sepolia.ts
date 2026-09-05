import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { selectedIdentityConfiguration } from "@orbit/config/identity";
import { createProtocolReader } from "@orbit/protocol/reader";
import { makeViemProtocolTransport } from "@orbit/protocol/viem-transport";
import { Effect, Schema } from "effect";
import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  http,
  keccak256,
  parseAbi,
  parseEther,
  toHex,
} from "viem";
import type {
  Abi,
  Address,
  Hex,
  SimulateContractParameters,
  TransactionReceipt,
  WriteContractParameters,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import {
  readLaunchedBaseSepoliaManifest,
  resolveRepositoryPath,
} from "./base-sepolia-manifest.ts";
import {
  decodeEnvironment,
  ensure,
  fileSystem,
  requireAddresses,
  rpc,
  runMain,
  validate,
} from "./effect-runtime.ts";

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const SmokeEnvironmentSchema = Schema.Struct({
  RPC_URL: Schema.optional(NonEmptyString),
  BASE_SEPOLIA_RPC_URL: Schema.optional(NonEmptyString),
  DEPLOYER_PRIVATE_KEY: NonEmptyString,
  DEPLOYER_ADDRESS: Schema.optional(NonEmptyString),
  DEPLOYMENT_MANIFEST_PATH: Schema.optional(NonEmptyString),
  SMOKE_EVIDENCE_PATH: Schema.optional(NonEmptyString),
  SMOKE_FORK: Schema.optionalWith(Schema.BooleanFromString, {
    default: () => false,
  }),
});

runMain(
  Effect.gen(function* () {
    const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    const environment = yield* decodeEnvironment(
      SmokeEnvironmentSchema,
      "RPC_URL, DEPLOYER_PRIVATE_KEY, and strict smoke options are required",
    );
    const rpcUrl = yield* validate("RPC_URL is required", () => {
      const selected = environment.RPC_URL ?? environment.BASE_SEPOLIA_RPC_URL;
      if (selected === undefined) throw new Error("RPC_URL is required");
      return selected;
    });
    const privateKey = environment.DEPLOYER_PRIVATE_KEY;
    const manifestPath = resolveRepositoryPath(
      repositoryRoot,
      environment.DEPLOYMENT_MANIFEST_PATH,
      "deployments/84532.json",
    );
    const evidencePath = resolveRepositoryPath(
      repositoryRoot,
      environment.SMOKE_EVIDENCE_PATH,
      "deployments/84532-evidence.json",
    );
    const manifest = yield* readLaunchedBaseSepoliaManifest(manifestPath);

    const account = yield* validate("DEPLOYER_PRIVATE_KEY is invalid", () => {
      const normalizedPrivateKey = privateKey.startsWith("0x")
        ? privateKey
        : `0x${privateKey}`;
      if (!/^0x[0-9a-fA-F]{64}$/.test(normalizedPrivateKey)) {
        throw new Error("DEPLOYER_PRIVATE_KEY must be a 32-byte hex value");
      }
      return privateKeyToAccount(normalizedPrivateKey as Hex);
    });
    const expectedDeployer = environment.DEPLOYER_ADDRESS;
    yield* ensure(
      expectedDeployer === undefined ||
        expectedDeployer.toLowerCase() === account.address.toLowerCase(),
      "DEPLOYER_ADDRESS does not match DEPLOYER_PRIVATE_KEY",
    );
    const sharedRoleNames = [
      "owner",
      "guardian",
      "keeper",
      "liquidityExecutor",
      "creator",
    ] as const;
    for (const roleName of sharedRoleNames) {
      yield* ensure(
        manifest.roles[roleName].toLowerCase() ===
          account.address.toLowerCase(),
        `${roleName} is not the configured development signer`,
      );
    }
    yield* ensure(
      manifest.roles.recoveryAuthority.toLowerCase() !==
        account.address.toLowerCase(),
      "Threshold recovery is not independent from the deployer",
    );

    const smokeIsFork = environment.SMOKE_FORK;
    const evidence = yield* rpc(
      "Base Sepolia smoke RPC workflow failed",
      async () => {
        const rpcTransport = () =>
          http(rpcUrl, {
            retryCount: 3,
            timeout: smokeIsFork ? 120_000 : 30_000,
          });
        const publicClient = createPublicClient({
          chain: baseSepolia,
          transport: rpcTransport(),
        });
        const walletClient = createWalletClient({
          account,
          chain: baseSepolia,
          transport: rpcTransport(),
        });
        const receiptConfirmations = smokeIsFork ? 1 : 2;
        if ((await publicClient.getChainId()) !== 84_532) {
          throw new Error("Smoke RPC is not Base Sepolia chain 84532");
        }

        const erc20Abi = parseAbi([
          "function approve(address spender,uint256 amount) returns (bool)",
          "function balanceOf(address account) view returns (uint256)",
        ]);
        const routerAbi = parseAbi([
          "function quoteExactInput(bool fuelForWeth,uint256 amountIn) returns (uint256 amountOut,uint256 feeAmount)",
          "function swapExactInput((bool fuelForWeth,uint256 amountIn,uint256 amountOutMinimum,address recipient,uint256 deadline,bool useNative) params) payable returns (uint256 amountOut)",
        ]);
        const fuelAbi = parseAbi([
          "function approve(address spender,uint256 amount) returns (bool)",
          "function balanceOf(address account) view returns (uint256)",
          "function totalSupply() view returns (uint256)",
          "function permanentCount() view returns (uint16)",
          "function totalTransientCount() view returns (uint16)",
          "function totalPendingDiscoveryCount() view returns (uint256)",
          "function pendingDiscoveryCount(address account) view returns (uint256)",
          "function transientCount(address account) view returns (uint256)",
          "function transientIdentityAt(address account,uint256 index) view returns (uint16)",
          "function commit(uint16 identityId)",
        ]);
        const attributesAbi = parseAbi([
          "function attributeOf(uint16 identityId) view returns (uint8 track,uint8 tier,uint16 weight,uint8 collectibleKind)",
        ]);
        const hookAbi = parseAbi([
          "function rewardPot() view returns (uint256)",
          "function liquidityPot() view returns (uint256)",
        ]);
        const converterAbi = parseAbi([
          "function openRewardEpoch() returns (uint256)",
          "function executeTrack(uint8 track,uint256 minimumStockOutput,uint256 deadline) returns (uint256)",
          "function trackQueue(uint8 track) view returns (uint256)",
          "function rewardEpochCount() view returns (uint256)",
        ]);
        const stockAbi = parseAbi([
          "function balanceOf(address account) view returns (uint256)",
          "function setPaused(bool paused)",
        ]);
        const ledgerAbi = parseAbi([
          "function claim(uint16[] identityIds)",
          "function pendingAll(uint16 identityId) view returns (uint256[4])",
          "function totalLiability(uint8 track) view returns (uint256)",
        ]);
        const claimGateAbi = parseAbi([
          "function isClaimAllowed(address currentOwner) view returns (bool)",
          // Present only on the configurable policy. The always-allow policy
          // has no administrator and no per-account state.
          "function setClaimAllowed(address account,bool allowed)",
        ]);
        const venueAbi = parseAbi([
          "function quoteExactInput(address tokenIn,address tokenOut,uint256 amountIn) returns (uint256)",
        ]);
        const liquidityAbi = parseAbi([
          "function addLiquidityCycle(int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 maximumWeth,uint256 deadline) returns (uint256)",
          "function wethIsCurrency0() view returns (bool)",
          "function permanentlyLockedWeth() view returns (uint256)",
        ]);
        const poolManagerAbi = parseAbi([
          "function extsload(bytes32 slot) view returns (bytes32 value)",
        ]);
        const recoveryAbi = parseAbi([
          "function getThreshold() view returns (uint256)",
        ]);
        const fuelMirrorAbi = parseAbi([
          "function balanceOf(address account) view returns (uint256)",
        ]);
        const discoveryAdapterAbi = parseAbi([
          "function s_vrfCoordinator() view returns (address)",
          "function rawFulfillRandomWords(uint256 requestId,uint256[] randomWords)",
          "function requestStatus(uint256 requestId) view returns (uint8 state,uint256 requestedAt,uint256 fulfilledAt,uint256 count,uint256 finalizedCount,bool delayReported)",
          "function nextFinalizationSequence() view returns (uint256)",
          "function vrfRequestIdAtSequence(uint256 sequence) view returns (uint256)",
          "function finalizeDiscovery(uint256 requestId,uint256 maxCount) returns (uint256 processed,uint256 remaining)",
          "error RequestFinalizationOutOfOrder(uint256 requestId,uint256 sequence,uint256 expectedSequence)",
          "event DiscoveryRandomnessRequested(uint256 indexed vrfRequestId,uint256 count)",
        ]);

        const contracts = requireAddresses(manifest.contracts, [
          "attributeRegistry",
          "canonicalFeeHook",
          "canonicalRouter",
          "discoveryAdapter",
          "epochConverter",
          "fuelCore",
          "fuelMirror",
          "mockAaplc",
          "mockGooglc",
          "mockMetac",
          "mockNvdac",
          "protocolLiquidityVault",
          "claimGate",
          "rewardLedger",
          "testConversionVenue",
          "uniswapV4PoolManager",
          "usdc",
          "weth",
        ] as const);
        const recoveryAuthority = getAddress(manifest.roles.recoveryAuthority);
        const receipts: Array<{
          readonly label: string;
          readonly transactionHash: Hex;
          readonly transactionLink: string | undefined;
          readonly blockNumber: bigint;
          readonly gasUsed: bigint;
          readonly status: TransactionReceipt["status"];
        }> = [];
        const transactionLink = (hash: Hex): string | undefined =>
          smokeIsFork ? undefined : `https://sepolia.basescan.org/tx/${hash}`;
        const retainReceipt = (
          label: string,
          receipt: TransactionReceipt,
          expectedStatus: TransactionReceipt["status"] = "success",
        ): TransactionReceipt => {
          const status = receipt.status;
          if (status !== expectedStatus) {
            throw new Error(
              `${label} was ${status}; expected ${expectedStatus}`,
            );
          }
          receipts.push({
            label,
            transactionHash: receipt.transactionHash,
            transactionLink: transactionLink(receipt.transactionHash),
            blockNumber: receipt.blockNumber,
            gasUsed: receipt.gasUsed,
            status,
          });
          return receipt;
        };
        interface ContractWrite {
          readonly label: string;
          readonly address: Address;
          readonly abi: Abi;
          readonly functionName: string;
          readonly args: readonly unknown[];
          readonly gas?: bigint;
          readonly value?: bigint;
        }
        const simulateAndWrite = async ({
          label,
          address,
          abi,
          functionName,
          args,
          gas,
          value,
        }: ContractWrite): Promise<TransactionReceipt> => {
          let hash: Hex;
          const write = {
            account,
            address,
            abi,
            functionName,
            args,
            ...(gas === undefined ? {} : { gas }),
            ...(value === undefined ? {} : { value }),
          } as unknown as WriteContractParameters;
          if (smokeIsFork) {
            hash = await walletClient.writeContract(write);
          } else {
            const { request } = await publicClient.simulateContract({
              account,
              address,
              abi,
              functionName,
              args,
              ...(value === undefined ? {} : { value }),
            } as unknown as SimulateContractParameters);
            hash = await walletClient.writeContract({
              ...request,
              ...(gas === undefined ? {} : { gas }),
            });
          }
          return retainReceipt(
            label,
            await publicClient.waitForTransactionReceipt({
              hash,
              confirmations: receiptConfirmations,
            }),
          );
        };
        const currentDeadline = async () =>
          (await publicClient.getBlock()).timestamp + 600n;
        const discoveryRequestTopic = keccak256(
          toHex("DiscoveryRandomnessRequested(uint256,uint256)"),
        );
        const discoveryRequestsIn = (receipt: TransactionReceipt) =>
          receipt.logs.flatMap((log) => {
            if (
              log.address.toLowerCase() !==
                contracts.discoveryAdapter.toLowerCase() ||
              log.topics[0] !== discoveryRequestTopic ||
              log.topics[1] === undefined
            ) {
              return [];
            }
            return [
              {
                count: Number(BigInt(log.data)),
                vrfRequestId: BigInt(log.topics[1]),
              },
            ];
          });
        const assertAcquisitionHidesIdentity = (
          receipt: TransactionReceipt,
        ) => {
          if (
            receipt.logs.some(
              (log) =>
                log.address.toLowerCase() ===
                contracts.fuelMirror.toLowerCase(),
            )
          ) {
            throw new Error(
              "Acquisition receipt exposed a FuelMirror NFT mutation",
            );
          }
          if (discoveryRequestsIn(receipt).length === 0) {
            throw new Error(
              "Acquisition crossed no verifiable Discovery Draw boundary",
            );
          }
        };
        const fulfillForkDiscoveries = async (
          acquisitionReceipts: readonly TransactionReceipt[],
        ) => {
          if (!smokeIsFork) return;
          const coordinator = await publicClient.readContract({
            address: contracts.discoveryAdapter,
            abi: discoveryAdapterAbi,
            functionName: "s_vrfCoordinator",
          });
          await publicClient.request({
            method: "anvil_impersonateAccount" as never,
            params: [coordinator] as never,
          });
          await publicClient.request({
            method: "anvil_setBalance" as never,
            params: [coordinator, toHex(parseEther("1"))] as never,
          });
          const coordinatorClient = createWalletClient({
            account: coordinator,
            chain: baseSepolia,
            transport: rpcTransport(),
          });
          for (const acquisition of acquisitionReceipts) {
            for (const request of discoveryRequestsIn(acquisition)) {
              const randomWords = [
                BigInt(
                  keccak256(
                    encodeAbiParameters(
                      [{ type: "uint256" }, { type: "uint256" }],
                      [request.vrfRequestId, 0n],
                    ),
                  ),
                ),
              ];
              const hash = await coordinatorClient.writeContract({
                address: contracts.discoveryAdapter,
                abi: discoveryAdapterAbi,
                functionName: "rawFulfillRandomWords",
                args: [request.vrfRequestId, randomWords],
                gas: 3_000_000n,
              });
              retainReceipt(
                `fork VRF fulfillment ${request.vrfRequestId}`,
                await publicClient.waitForTransactionReceipt({ hash }),
              );
            }
          }
          await publicClient.request({
            method: "anvil_stopImpersonatingAccount" as never,
            params: [coordinator] as never,
          });
        };
        const waitForDiscoveries = async (
          acquisitionReceipts: readonly TransactionReceipt[],
        ) => {
          await fulfillForkDiscoveries(acquisitionReceipts);
          const deadline = Date.now() + 10 * 60_000;
          while (
            (await publicClient.readContract({
              address: contracts.fuelCore,
              abi: fuelAbi,
              functionName: "pendingDiscoveryCount",
              args: [account.address],
            })) !== 0n
          ) {
            if (Date.now() >= deadline) {
              throw new Error(
                "Discovery did not receive and finalize Chainlink VRF within ten minutes",
              );
            }
            const nextSequence = await publicClient.readContract({
              address: contracts.discoveryAdapter,
              abi: discoveryAdapterAbi,
              functionName: "nextFinalizationSequence",
            });
            const headRequestId = await publicClient.readContract({
              address: contracts.discoveryAdapter,
              abi: discoveryAdapterAbi,
              functionName: "vrfRequestIdAtSequence",
              args: [nextSequence],
            });
            const [headState] = await publicClient.readContract({
              address: contracts.discoveryAdapter,
              abi: discoveryAdapterAbi,
              functionName: "requestStatus",
              args: [headRequestId],
            });
            if (headState === 2) {
              await simulateAndWrite({
                label: `finalize ready Discovery Batch ${headRequestId}`,
                address: contracts.discoveryAdapter,
                abi: discoveryAdapterAbi,
                functionName: "finalizeDiscovery",
                args: [headRequestId, 8n],
              });
              continue;
            }
            await new Promise((resolve) => setTimeout(resolve, 5_000));
          }
        };

        // The fork runs the destructive, high-volume reward and failure drill
        // below. Live verification stays intentionally bounded: a previous
        // version queued dozens of valid VRF requests merely to fund a Reward
        // Epoch, turning a correctness smoke into an oracle-throughput load
        // test. One normal acquisition is enough to prove that simulation
        // cannot expose an NFT and that independently verified randomness is
        // later applied through retryable finalization.
        if (!smokeIsFork) {
          const amountIn = parseEther("0.01");
          const acquisition = await simulateAndWrite({
            label: "bounded native ETH discovery buy",
            address: contracts.canonicalRouter,
            abi: routerAbi,
            functionName: "swapExactInput",
            gas: 12_000_000n,
            value: amountIn,
            args: [
              {
                fuelForWeth: false,
                amountIn,
                amountOutMinimum: 0n,
                recipient: account.address,
                deadline: await currentDeadline(),
                useNative: true,
              },
            ],
          });
          assertAcquisitionHidesIdentity(acquisition);
          const pendingAfterAcquisition = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "pendingDiscoveryCount",
            args: [account.address],
          });
          if (pendingAfterAcquisition === 0n) {
            throw new Error(
              "Acquisition did not expose the expected Pending Discovery state",
            );
          }

          await waitForDiscoveries([acquisition]);
          const transientAfterCallback = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "transientCount",
            args: [account.address],
          });
          const mirrorBalanceAfterCallback = await publicClient.readContract({
            address: contracts.fuelMirror,
            abi: fuelMirrorAbi,
            functionName: "balanceOf",
            args: [account.address],
          });
          if (
            transientAfterCallback === 0n ||
            mirrorBalanceAfterCallback !== transientAfterCallback
          ) {
            throw new Error(
              "Verified callback did not materialize matching FuelCore and FuelMirror identities",
            );
          }

          return {
            schemaVersion: 1,
            chainId: 84_532,
            network: "base-sepolia",
            fork: false,
            scope: "bounded-live-discovery",
            manifestPath: "deployments/84532.json",
            manifestLaunch: manifest.launch,
            signer: account.address,
            discovery: {
              acquisitionContainedMirrorMutation: false,
              pendingAfterAcquisition,
              transientAfterCallback,
              mirrorBalanceAfterCallback,
            },
            transactions: receipts,
          };
        }

        const reader = createProtocolReader({
          manifest,
          identity: selectedIdentityConfiguration,
          transport: makeViemProtocolTransport(
            publicClient as unknown as Parameters<
              typeof makeViemProtocolTransport
            >[0],
            manifest,
            selectedIdentityConfiguration,
          ),
        });
        const healthSnapshot = async (phase: string) => {
          const snapshot = await reader.readHealth(account.address);
          return {
            phase,
            observedBlock: snapshot.deployment.observedBlock,
            observedAt: snapshot.deployment.observedAt,
            status: snapshot.health.status,
            freshness: snapshot.health.freshness,
            checks: snapshot.health.checks,
            rpcFailures: snapshot.health.rpcFailures,
            trackQueues: snapshot.operations.trackQueues,
            deferredTrackBudgets: snapshot.operations.deferredTrackBudgets,
            capabilities: snapshot.capabilities,
          };
        };

        const prepareRewardEpochScenario = async () => {
          const snapshots = [await healthSnapshot("post-deployment")];
          const wethBalance = await publicClient.readContract({
            address: contracts.weth,
            abi: erc20Abi,
            functionName: "balanceOf",
            args: [account.address],
          });
          if (wethBalance < parseEther("2.1")) {
            throw new Error(
              "Development signer needs at least 2.1 self-funded WETH",
            );
          }

          await simulateAndWrite({
            label: "approve WETH for Canonical Router",
            address: contracts.weth,
            abi: erc20Abi,
            functionName: "approve",
            args: [contracts.canonicalRouter, 2n ** 256n - 1n],
          });

          const minimumEpochWeth = parseEther("0.04");
          const findOrdinaryAaplIdentity = async () => {
            const count = await publicClient.readContract({
              address: contracts.fuelCore,
              abi: fuelAbi,
              functionName: "transientCount",
              args: [account.address],
            });
            for (let index = 0n; index < count; index += 1n) {
              const identityId = await publicClient.readContract({
                address: contracts.fuelCore,
                abi: fuelAbi,
                functionName: "transientIdentityAt",
                args: [account.address, index],
              });
              const attributes = await publicClient.readContract({
                address: contracts.attributeRegistry,
                abi: attributesAbi,
                functionName: "attributeOf",
                args: [identityId],
              });
              if (attributes[0] === 1 && attributes[3] === 0)
                return Number(identityId);
            }
            return undefined;
          };
          const acquisitionReceipts: TransactionReceipt[] = [];
          for (let buyIndex = 0; buyIndex < 30; buyIndex += 1) {
            const rewardPot = await publicClient.readContract({
              address: contracts.canonicalFeeHook,
              abi: hookAbi,
              functionName: "rewardPot",
            });
            if (rewardPot >= minimumEpochWeth) break;

            const amountIn = parseEther("0.1");
            const useNative = buyIndex === 0;
            const acquisition = await simulateAndWrite({
              label: useNative
                ? "Canonical Market native ETH buy"
                : `Canonical Market WETH buy ${String(buyIndex).padStart(2, "0")}`,
              address: contracts.canonicalRouter,
              abi: routerAbi,
              functionName: "swapExactInput",
              gas: 12_000_000n,
              ...(useNative ? { value: amountIn } : {}),
              args: [
                {
                  fuelForWeth: false,
                  amountIn,
                  amountOutMinimum: 0n,
                  recipient: account.address,
                  deadline: await currentDeadline(),
                  useNative,
                },
              ],
            });
            assertAcquisitionHidesIdentity(acquisition);
            acquisitionReceipts.push(acquisition);
          }
          await waitForDiscoveries(acquisitionReceipts);

          let chosenIdentity = await findOrdinaryAaplIdentity();
          for (
            let additionalBuy = 0;
            additionalBuy < 10 && chosenIdentity === undefined;
            additionalBuy += 1
          ) {
            const acquisition = await simulateAndWrite({
              label: `Canonical Market identity buy ${String(additionalBuy + 1).padStart(2, "0")}`,
              address: contracts.canonicalRouter,
              abi: routerAbi,
              functionName: "swapExactInput",
              gas: 12_000_000n,
              args: [
                {
                  fuelForWeth: false,
                  amountIn: parseEther("0.1"),
                  amountOutMinimum: 0n,
                  recipient: account.address,
                  deadline: await currentDeadline(),
                  useNative: false,
                },
              ],
            });
            assertAcquisitionHidesIdentity(acquisition);
            await waitForDiscoveries([acquisition]);
            chosenIdentity = await findOrdinaryAaplIdentity();
          }
          if (chosenIdentity === undefined) {
            throw new Error(
              "Canonical buys did not discover an ordinary AAPLc identity",
            );
          }
          const rewardPotBeforeEpoch = await publicClient.readContract({
            address: contracts.canonicalFeeHook,
            abi: hookAbi,
            functionName: "rewardPot",
          });
          if (rewardPotBeforeEpoch < minimumEpochWeth) {
            throw new Error(
              "Canonical trades did not fund the minimum Reward Epoch",
            );
          }

          await simulateAndWrite({
            label: `Launch identity ${chosenIdentity}`,
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "commit",
            args: [chosenIdentity],
          });
          await simulateAndWrite({
            label: "approve FUEL for Canonical Router",
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "approve",
            args: [contracts.canonicalRouter, 2n ** 256n - 1n],
          });
          await simulateAndWrite({
            label: "post-Launch Canonical Market trade",
            address: contracts.canonicalRouter,
            abi: routerAbi,
            functionName: "swapExactInput",
            gas: 12_000_000n,
            args: [
              {
                fuelForWeth: true,
                amountIn: parseEther("0.25"),
                amountOutMinimum: 0n,
                recipient: account.address,
                deadline: await currentDeadline(),
                useNative: false,
              },
            ],
          });
          await simulateAndWrite({
            label: "open Reward Epoch",
            address: contracts.epochConverter,
            abi: converterAbi,
            functionName: "openRewardEpoch",
            args: [],
          });
          snapshots.push(await healthSnapshot("before-failure"));
          return { chosenIdentity, snapshots };
        };
        const preparedEpoch = await prepareRewardEpochScenario();
        const { chosenIdentity, snapshots } = preparedEpoch;

        const executeDeferredTrackScenario = async () => {
          await simulateAndWrite({
            label: "pause METAc test token",
            address: contracts.mockMetac,
            abi: stockAbi,
            functionName: "setPaused",
            args: [true],
          });
          const describeFailure = (cause: unknown) => {
            if (!(cause instanceof Error)) return String(cause);
            if (
              "shortMessage" in cause &&
              typeof cause.shortMessage === "string"
            ) {
              return cause.shortMessage;
            }
            return cause.message;
          };
          let failedTrackReason = "conversion reverted";
          try {
            await publicClient.simulateContract({
              account,
              address: contracts.epochConverter,
              abi: converterAbi,
              functionName: "executeTrack",
              args: [3, 0n, await currentDeadline()],
            });
            throw new Error(
              "Paused METAc route unexpectedly simulated successfully",
            );
          } catch (cause) {
            failedTrackReason = describeFailure(cause);
          }
          const failedTrackHash = await walletClient.sendTransaction({
            account,
            chain: baseSepolia,
            to: contracts.epochConverter,
            data: encodeFunctionData({
              abi: converterAbi,
              functionName: "executeTrack",
              args: [3, 0n, await currentDeadline()],
            }),
            gas: 2_000_000n,
          });
          retainReceipt(
            "failed METAc track execution",
            await publicClient.waitForTransactionReceipt({
              hash: failedTrackHash,
              confirmations: receiptConfirmations,
            }),
            "reverted",
          );

          for (const track of [1, 2, 4]) {
            await simulateAndWrite({
              label: `execute successful track ${track}`,
              address: contracts.epochConverter,
              abi: converterAbi,
              functionName: "executeTrack",
              args: [track, 0n, await currentDeadline()],
            });
          }
          const deferredQueue = await publicClient.readContract({
            address: contracts.epochConverter,
            abi: converterAbi,
            functionName: "trackQueue",
            args: [3],
          });
          if (deferredQueue === 0n) {
            throw new Error(
              "Failed METAc track did not retain its Deferred Track Budget",
            );
          }
          for (const track of [1, 2, 4]) {
            const queue = await publicClient.readContract({
              address: contracts.epochConverter,
              abi: converterAbi,
              functionName: "trackQueue",
              args: [track],
            });
            if (queue !== 0n)
              throw new Error(`Successful track ${track} remained queued`);
          }
          snapshots.push(await healthSnapshot("during-deferred-track"));
          return { deferredQueue, failedTrackReason };
        };
        const failedTrack = await executeDeferredTrackScenario();
        const { deferredQueue, failedTrackReason } = failedTrack;

        await simulateAndWrite({
          label: "restore METAc test token",
          address: contracts.mockMetac,
          abi: stockAbi,
          functionName: "setPaused",
          args: [false],
        });
        await simulateAndWrite({
          label: "retry METAc track",
          address: contracts.epochConverter,
          abi: converterAbi,
          functionName: "executeTrack",
          args: [3, 0n, await currentDeadline()],
        });
        if (
          (await publicClient.readContract({
            address: contracts.epochConverter,
            abi: converterAbi,
            functionName: "trackQueue",
            args: [3],
          })) !== 0n
        ) {
          throw new Error("Retried METAc track remained queued");
        }
        snapshots.push(await healthSnapshot("after-retry"));

        type HealthSnapshot = Awaited<ReturnType<typeof healthSnapshot>>;
        type TrackId = 1 | 2 | 3 | 4;
        const snapshotFor = (phase: string): HealthSnapshot => {
          const snapshot = snapshots.find(
            (candidate) => candidate.phase === phase,
          );
          if (snapshot === undefined) {
            throw new Error(`Missing ${phase} health snapshot`);
          }
          return snapshot;
        };
        const trackFor = (snapshot: HealthSnapshot, trackId: TrackId) => {
          const track = snapshot.trackQueues.find(
            (candidate) => candidate.trackId === trackId,
          );
          const check = snapshot.checks.find(
            (candidate) => candidate.id === `track:${trackId}`,
          );
          if (track === undefined || check === undefined) {
            throw new Error(
              `${snapshot.phase} health snapshot omitted Reward Track ${trackId}`,
            );
          }
          return { track, check };
        };
        const metacHealthIsDeferred = (
          observation: ReturnType<typeof trackFor>,
          retainedQueue: bigint,
        ) =>
          observation.track.weth !== undefined &&
          BigInt(observation.track.weth) === retainedQueue &&
          observation.track.status === "retryable" &&
          observation.check.status === "fail" &&
          observation.check.observed?.includes("Deferred Track Budget") ===
            true;
        const onlyMetacBudgetIsDeferred = (snapshot: HealthSnapshot) =>
          snapshot.deferredTrackBudgets.length === 1 &&
          snapshot.deferredTrackBudgets[0]?.trackId === 3;
        const assertExecutableTracks = (
          snapshot: HealthSnapshot,
          trackIds: readonly TrackId[],
        ) => {
          for (const trackId of trackIds) {
            const { track } = trackFor(snapshot, trackId);
            const positiveQueue =
              track.weth !== undefined && BigInt(track.weth) > 0n;
            if (!track.queueAvailable || !positiveQueue) {
              throw new Error(
                `Before-failure health did not expose executable Reward Track ${trackId}`,
              );
            }
          }
        };
        const assertClearTracks = (
          snapshot: HealthSnapshot,
          trackIds: readonly TrackId[],
          failure: (trackId: TrackId) => string,
        ) => {
          for (const trackId of trackIds) {
            const { track, check } = trackFor(snapshot, trackId);
            const clearAmount =
              track.weth !== undefined && BigInt(track.weth) === 0n;
            const clearTrack =
              clearAmount &&
              track.status === "clear" &&
              check.status === "pass" &&
              check.observed === "queue clear";
            if (!clearTrack) throw new Error(failure(trackId));
          }
        };
        const assertDeferredMetac = (
          snapshot: HealthSnapshot,
          retainedQueue: bigint,
        ) => {
          const deferredMetac = trackFor(snapshot, 3);
          if (
            snapshot.status !== "degraded" ||
            !metacHealthIsDeferred(deferredMetac, retainedQueue) ||
            !onlyMetacBudgetIsDeferred(snapshot)
          ) {
            throw new Error(
              "Operations health did not isolate METAc as the only Deferred Track Budget",
            );
          }
        };
        const assertHealthyRetry = (snapshot: HealthSnapshot) => {
          const healthy =
            snapshot.status === "healthy" &&
            snapshot.freshness === "fresh" &&
            snapshot.deferredTrackBudgets.length === 0;
          if (!healthy) {
            throw new Error(
              "Operations health did not return to healthy after retry",
            );
          }
        };
        const beforeFailure = snapshotFor("before-failure");
        assertExecutableTracks(beforeFailure, [1, 2, 3, 4]);
        const duringDeferredTrack = snapshotFor("during-deferred-track");
        assertClearTracks(
          duringDeferredTrack,
          [1, 2, 4],
          (trackId) =>
            `Deferred-track health incorrectly marked successful Reward Track ${trackId}`,
        );
        assertDeferredMetac(duringDeferredTrack, deferredQueue);
        const afterRetry = snapshotFor("after-retry");
        assertHealthyRetry(afterRetry);
        assertClearTracks(
          afterRetry,
          [1, 2, 3, 4],
          (trackId) =>
            `After-retry health did not clear Reward Track ${trackId}`,
        );

        /**
         * With a configurable claim policy the gate denies by default, which is
         * the whole point of deploying it: the always-allow policy cannot deny,
         * so the denied path was unexercisable. Prove the denial holds the
         * entitlement rather than destroying it, then approve and retry the
         * same claim. Returns whether a denial was actually observed, so an
         * always-allow deployment still smoke-tests cleanly.
         */
        const proveDenialPreservesEntitlement = async (
          pendingBeforeDenial: readonly bigint[],
        ) => {
          const allowed = await publicClient.readContract({
            address: contracts.claimGate,
            abi: claimGateAbi,
            functionName: "isClaimAllowed",
            args: [account.address],
          });
          if (allowed) return false;

          let denied = false;
          try {
            await publicClient.simulateContract({
              account,
              address: contracts.rewardLedger,
              abi: ledgerAbi,
              functionName: "claim",
              args: [[chosenIdentity]],
            });
          } catch {
            denied = true;
          }
          if (!denied) {
            throw new Error(
              "The claim policy reports the account is not allowed, yet the claim did not revert",
            );
          }

          // A denial that quietly consumed the reward would be worse than no
          // gate at all, so the entitlement is re-read rather than assumed.
          const pendingAfterDenial = await publicClient.readContract({
            address: contracts.rewardLedger,
            abi: ledgerAbi,
            functionName: "pendingAll",
            args: [chosenIdentity],
          });
          if (
            pendingAfterDenial.some(
              (amount, track) => amount !== pendingBeforeDenial[track],
            )
          ) {
            throw new Error("A denied claim changed the pending reward");
          }

          await simulateAndWrite({
            label: `approve ${account.address} for claims`,
            address: contracts.claimGate,
            abi: claimGateAbi,
            functionName: "setClaimAllowed",
            args: [account.address, true],
          });
          const allowedAfterApproval = await publicClient.readContract({
            address: contracts.claimGate,
            abi: claimGateAbi,
            functionName: "isClaimAllowed",
            args: [account.address],
          });
          if (!allowedAfterApproval) {
            throw new Error("Approval did not make the account claim-eligible");
          }
          return true;
        };

        const claimAaplcRewards = async () => {
          const rewardsBeforeClaim = await publicClient.readContract({
            address: contracts.rewardLedger,
            abi: ledgerAbi,
            functionName: "pendingAll",
            args: [chosenIdentity],
          });
          if (rewardsBeforeClaim[0] === 0n) {
            throw new Error(
              "Launched AAPLc identity accrued no claimable reward",
            );
          }
          const deniedThenApproved =
            await proveDenialPreservesEntitlement(rewardsBeforeClaim);
          const stockBalanceBeforeClaim = await publicClient.readContract({
            address: contracts.mockAaplc,
            abi: stockAbi,
            functionName: "balanceOf",
            args: [account.address],
          });
          await simulateAndWrite({
            label: `claim identity ${chosenIdentity} rewards`,
            address: contracts.rewardLedger,
            abi: ledgerAbi,
            functionName: "claim",
            args: [[chosenIdentity]],
          });
          const stockBalanceAfterClaim = await publicClient.readContract({
            address: contracts.mockAaplc,
            abi: stockAbi,
            functionName: "balanceOf",
            args: [account.address],
          });
          if (stockBalanceAfterClaim <= stockBalanceBeforeClaim) {
            throw new Error("Reward claim transferred no AAPLc");
          }
          return {
            claimed: stockBalanceAfterClaim - stockBalanceBeforeClaim,
            deniedThenApproved,
          };
        };
        const { claimed: claimedAaplc, deniedThenApproved } =
          await claimAaplcRewards();

        const executeProtocolLiquidityCycle = async () => {
          const poolStateSlot = BigInt(
            keccak256(
              encodeAbiParameters(
                [{ type: "bytes32" }, { type: "uint256" }],
                [manifest.canonicalPool.poolId as Hex, 6n],
              ),
            ),
          );
          const packedSlot0 = BigInt(
            await publicClient.readContract({
              address: contracts.uniswapV4PoolManager,
              abi: poolManagerAbi,
              functionName: "extsload",
              args: [toHex(poolStateSlot, { size: 32 })],
            }),
          );
          const rawTick = Number((packedSlot0 >> 160n) & 0xff_ffffn);
          const currentTick =
            rawTick >= 0x80_0000 ? rawTick - 0x100_0000 : rawTick;
          const wethIsCurrency0 = await publicClient.readContract({
            address: contracts.protocolLiquidityVault,
            abi: liquidityAbi,
            functionName: "wethIsCurrency0",
          });
          const tickLower = wethIsCurrency0
            ? Math.ceil(currentTick / 60) * 60
            : Math.floor(currentTick / 60) * 60 - 600;
          const tickUpper = wethIsCurrency0
            ? tickLower + 600
            : Math.floor(currentTick / 60) * 60;
          const liquidityPot = await publicClient.readContract({
            address: contracts.canonicalFeeHook,
            abi: hookAbi,
            functionName: "liquidityPot",
          });
          const vaultFuelBefore = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "balanceOf",
            args: [contracts.protocolLiquidityVault],
          });
          const lockedWethBefore = await publicClient.readContract({
            address: contracts.protocolLiquidityVault,
            abi: liquidityAbi,
            functionName: "permanentlyLockedWeth",
          });
          await simulateAndWrite({
            label: "WETH-only Protocol-Owned Liquidity cycle",
            address: contracts.protocolLiquidityVault,
            abi: liquidityAbi,
            functionName: "addLiquidityCycle",
            args: [
              tickLower,
              tickUpper,
              1_000_000_000_000_000n,
              liquidityPot,
              await currentDeadline(),
            ],
          });
          const vaultFuelAfter = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "balanceOf",
            args: [contracts.protocolLiquidityVault],
          });
          const lockedWethAfter = await publicClient.readContract({
            address: contracts.protocolLiquidityVault,
            abi: liquidityAbi,
            functionName: "permanentlyLockedWeth",
          });
          const wethOnlyCycle =
            vaultFuelBefore === 0n &&
            vaultFuelAfter === 0n &&
            lockedWethAfter > lockedWethBefore;
          if (!wethOnlyCycle) {
            throw new Error("Protocol-Owned Liquidity cycle was not WETH-only");
          }
          return {
            lockedWethAfter,
            lockedWethBefore,
            vaultFuelAfter,
            vaultFuelBefore,
          };
        };
        const liquidityEvidence = await executeProtocolLiquidityCycle();
        const {
          lockedWethAfter,
          lockedWethBefore,
          vaultFuelAfter,
          vaultFuelBefore,
        } = liquidityEvidence;

        const readFinalProtocolObservations = async () => {
          const canonicalQuote = await publicClient.simulateContract({
            account,
            address: contracts.canonicalRouter,
            abi: routerAbi,
            functionName: "quoteExactInput",
            args: [false, parseEther("0.01")],
          });
          const conversionQuoteInputs = [
            ["wethUsdc", contracts.weth, contracts.usdc, parseEther("0.01")],
            ["aaplc", contracts.usdc, contracts.mockAaplc, 1_000_000n],
            ["googlc", contracts.usdc, contracts.mockGooglc, 1_000_000n],
            ["metac", contracts.usdc, contracts.mockMetac, 1_000_000n],
            ["nvdac", contracts.usdc, contracts.mockNvdac, 1_000_000n],
          ] as const;
          const conversionQuotes: Record<
            string,
            { readonly amountIn: bigint; readonly amountOut: bigint }
          > = {};
          for (const [
            name,
            tokenIn,
            tokenOut,
            amountIn,
          ] of conversionQuoteInputs) {
            const quote = await publicClient.simulateContract({
              account,
              address: contracts.testConversionVenue,
              abi: venueAbi,
              functionName: "quoteExactInput",
              args: [tokenIn, tokenOut, amountIn],
            });
            if (quote.result === 0n)
              throw new Error(`${name} returned an empty quote`);
            conversionQuotes[name] = { amountIn, amountOut: quote.result };
          }

          const totalSupply = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "totalSupply",
          });
          const permanentCount = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "permanentCount",
          });
          const totalTransientCount = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "totalTransientCount",
          });
          const totalPendingDiscoveryCount = await publicClient.readContract({
            address: contracts.fuelCore,
            abi: fuelAbi,
            functionName: "totalPendingDiscoveryCount",
          });
          const rewardAccounting = [];
          const stockNames = [
            "mockAaplc",
            "mockGooglc",
            "mockMetac",
            "mockNvdac",
          ] as const;
          for (const [index, stockName] of stockNames.entries()) {
            const track = index + 1;
            const liability = await publicClient.readContract({
              address: contracts.rewardLedger,
              abi: ledgerAbi,
              functionName: "totalLiability",
              args: [track],
            });
            const ledgerBalance = await publicClient.readContract({
              address: contracts[stockName],
              abi: stockAbi,
              functionName: "balanceOf",
              args: [contracts.rewardLedger],
            });
            if (ledgerBalance < liability) {
              throw new Error(`Reward Track ${track} is undercollateralized`);
            }
            rewardAccounting.push({ track, liability, ledgerBalance });
          }
          if (
            totalSupply + BigInt(permanentCount) * parseEther("1") !==
            parseEther("4444")
          ) {
            throw new Error(
              "Liquid supply plus permanent commitments does not equal 4,444",
            );
          }

          snapshots.push(await healthSnapshot("final"));
          const recoveryThreshold = await publicClient.readContract({
            address: recoveryAuthority,
            abi: recoveryAbi,
            functionName: "getThreshold",
          });
          if (recoveryThreshold < 2n) {
            throw new Error("Recovery threshold fell below two");
          }
          return {
            canonicalQuote,
            conversionQuotes,
            permanentCount,
            recoveryThreshold,
            rewardAccounting,
            totalPendingDiscoveryCount,
            totalSupply,
            totalTransientCount,
          };
        };
        const finalObservations = await readFinalProtocolObservations();
        const {
          canonicalQuote,
          conversionQuotes,
          permanentCount,
          recoveryThreshold,
          rewardAccounting,
          totalPendingDiscoveryCount,
          totalSupply,
          totalTransientCount,
        } = finalObservations;

        return {
          schemaVersion: 1,
          chainId: 84_532,
          network: "base-sepolia",
          fork: smokeIsFork,
          manifestPath: "deployments/84532.json",
          manifestLaunch: manifest.launch,
          signer: account.address,
          roleConsolidation: {
            sharedRoles: sharedRoleNames,
            justification:
              "Valueless POC operations use one funded development signer.",
            recoveryAuthority: manifest.roles.recoveryAuthority,
            recoveryThreshold,
            independentRecovery: true,
          },
          selectedIdentity: chosenIdentity,
          failedTrack: {
            track: 3,
            reason: failedTrackReason,
            retainedQueue: deferredQueue,
          },
          healthSnapshots: snapshots,
          quotes: {
            canonical: {
              amountIn: parseEther("0.01"),
              amountOut: canonicalQuote.result[0],
              feeAmount: canonicalQuote.result[1],
            },
            conversion: conversionQuotes,
          },
          invariants: {
            totalSupply,
            permanentCount,
            permanentEquivalentSupply: BigInt(permanentCount) * parseEther("1"),
            maximumEconomicUnits: parseEther("4444"),
            totalTransientCount,
            totalPendingDiscoveryCount,
            rewardAccounting,
            claimedAaplc,
            deniedThenApproved,
            polFuelBefore: vaultFuelBefore,
            polFuelAfter: vaultFuelAfter,
            permanentlyLockedWethBefore: lockedWethBefore,
            permanentlyLockedWethAfter: lockedWethAfter,
          },
          transactions: receipts,
        };
      },
    );
    yield* fileSystem("Could not write Base Sepolia smoke evidence", () =>
      writeFileSync(
        evidencePath,
        `${JSON.stringify(
          evidence,
          (_key, value) =>
            typeof value === "bigint" ? value.toString() : value,
          2,
        )}\n`,
      ),
    );
    process.stdout.write(
      `Base Sepolia smoke passed with evidence at ${evidencePath}\n`,
    );
  }),
);
