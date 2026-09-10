import type { ProtocolDeploymentManifest } from "@orbit/config/deployment-manifest";
import {
  parseAbi,
  type Abi,
  type Address,
  type ContractFunctionReturnType,
} from "viem";

const protocolErrorSignatures = [
  "error TradingLocked()",
  "error NotIdentityOwner(uint16 identityId,address expectedOwner,address actualOwner)",
  "error ClaimDenied(address currentOwner)",
  "error ClaimBatchTooLarge(uint256 requested,uint256 maximum)",
  "error RewardNotificationsArePaused()",
  "error Paused()",
  "error FrozenAccount(address account)",
  "error UnauthorizedKeeper(address caller)",
  "error UnauthorizedExecutor(address caller)",
  "error UnauthorizedOwner(address caller)",
  "error ConfigurationAlreadySealed()",
  "error EmptyTrackQueue(uint8 track)",
  "error RewardEpochIntervalPending(uint256 nextEpochAt)",
  "error RewardPotBelowMinimum(uint256 available,uint256 minimum)",
  "error DeadlineExpired(uint256 deadline,uint256 currentTimestamp)",
  "error DiscoveryMutationLimitExceeded(uint256 requested,uint256 maximum)",
  "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
] as const;

const fuelCoreAbi = parseAbi([
  ...protocolErrorSignatures,
  "function balanceOf(address account) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function permanentCount() view returns (uint16)",
  "function totalTransientCount() view returns (uint16)",
  "function totalPendingDiscoveryCount() view returns (uint256)",
  "function availableIdentityCount() view returns (uint16)",
  "function transientCount(address account) view returns (uint256)",
  "function transientIdentityAt(address account,uint256 index) view returns (uint16)",
  "function pendingDiscoveryCount(address account) view returns (uint256)",
  "function pendingDiscoveryAt(address account,uint256 index) view returns (bytes32)",
  "function isPendingDiscovery(bytes32 requestId) view returns (bool)",
  "function isDiscoveryExempt(address account) view returns (bool)",
  "function isProtectedAccount(address account) view returns (bool)",
  "function isFrozen(address account) view returns (bool)",
  "function isPermanentIdentity(uint16 identityId) view returns (bool)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function isBlockedVenueCodehash(bytes32 codehash) view returns (bool)",
  "function guardian() view returns (address)",
  "function recoveryAuthority() view returns (address)",
  "function rewardLedger() view returns (address)",
  "function canonicalMarketRegistry() view returns (address)",
  "function launched() view returns (bool)",
  "function paused() view returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
  "function commit(uint16 identityId)",
  "function setPaused(bool paused)",
  "event Committed(address indexed account,uint16 indexed identityId)",
  "event DiscoveryRequested(address indexed account,bytes32 indexed requestId)",
  "event DiscoveryFulfilled(address indexed account,bytes32 indexed requestId,uint16 indexed identityId)",
]);

const fuelMirrorAbi = parseAbi([
  ...protocolErrorSignatures,
  "function core() view returns (address)",
  "function ownerOf(uint256 identityId) view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function metadataRenderer() view returns (address)",
  "function safeTransferFrom(address from,address to,uint256 identityId)",
  "event Transfer(address indexed from,address indexed to,uint256 indexed identityId)",
]);

const attributeRegistryAbi = parseAbi([
  "function attributeOf(uint16 identityId) view returns (uint8 track,uint8 tier,uint16 weight,uint8 collectibleKind)",
  "function manifestCommitment() view returns (bytes32)",
  "function isSealed() view returns (bool)",
]);

const rewardLedgerAbi = parseAbi([
  ...protocolErrorSignatures,
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function fuelCore() view returns (address)",
  "function attributeRegistry() view returns (address)",
  "function pendingAll(uint16 identityId) view returns (uint256[4])",
  "function isActive(uint16 identityId) view returns (bool)",
  "function totalLiability(uint8 track) view returns (uint256)",
  "function totalActiveWeight(uint8 track) view returns (uint256)",
  "function unclaimedTrackPot(uint8 track) view returns (uint256)",
  "function rewardToken(uint8 track) view returns (address)",
  "function claimGate() view returns (address)",
  "function epochConverter() view returns (address)",
  "function rewardNotificationsPaused() view returns (bool)",
  "function claim(uint16[] identityIds)",
  "function setRewardNotificationsPaused(bool paused)",
  "event RewardClaimed(address indexed currentOwner,uint16 indexed identityId,uint8 indexed track,uint256 amount)",
  "event RewardNotified(uint8 indexed track,address indexed token,uint256 amount,uint256 ordinaryAllocation,uint256 basketRelicAllocation,uint256 indicatorRelicAllocation)",
]);

const epochConverterAbi = parseAbi([
  ...protocolErrorSignatures,
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function weth() view returns (address)",
  "function rewardLedger() view returns (address)",
  "function keeper() view returns (address)",
  "function canonicalFeeHook() view returns (address)",
  "function configurationSealed() view returns (bool)",
  "function paused() view returns (bool)",
  "function rewardEpochCount() view returns (uint256)",
  "function lastRewardEpochAt() view returns (uint256)",
  "function trackQueue(uint8 track) view returns (uint256)",
  "function trackConfiguration(uint8 track) view returns (address stockToken,address adapter)",
  "function openRewardEpoch() returns (uint256)",
  "function executeTrack(uint8 track,uint256 minimumStockOutput,uint256 deadline) returns (uint256)",
  "function configureTrack(uint8 track,address stockToken,address adapter)",
  "function setPaused(bool paused)",
  "event RewardEpochOpened(uint256 indexed epochNumber,uint256 openedAmount,uint256 equalTrackShare,uint256 finalTrackRemainder)",
  "event TrackExecuted(uint8 indexed track,uint256 wethInput,uint256 measuredStockOutput,uint256 deferredTrackBudget)",
]);

const canonicalMarketRegistryAbi = parseAbi([
  "function manager() view returns (address)",
  "function fuel() view returns (address)",
  "function weth() view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function registered() view returns (bool)",
  "function poolId() view returns (bytes32)",
  "function isSealed() view returns (bool)",
  "function hook() view returns (address)",
  "function router() view returns (address)",
]);

const canonicalFeeHookAbi = parseAbi([
  "function manager() view returns (address)",
  "function registry() view returns (address)",
  "function weth() view returns (address)",
  "function TOTAL_FEE_BPS() view returns (uint256)",
  "function rewardPot() view returns (uint256)",
  "function liquidityPot() view returns (uint256)",
  "function creatorPot() view returns (uint256)",
  "function rewardDestination() view returns (address)",
  "function liquidityDestination() view returns (address)",
  "function creatorDestination() view returns (address)",
  "function pullCreatorPot(uint256 amount)",
  "event FeeAccrued(address indexed trader,uint256 wethVolume,uint256 totalFee,uint256 rewardFee,uint256 liquidityFee,uint256 creatorFee)",
]);

const canonicalRouterAbi = parseAbi([
  ...protocolErrorSignatures,
  "function manager() view returns (address)",
  "function registry() view returns (address)",
  "function weth() view returns (address)",
  "function quoteExactInput(bool fuelForWeth,uint256 amountIn) returns (uint256 amountOut,uint256 feeAmount)",
  "function quoteExactOutput(bool fuelForWeth,uint256 amountOut) returns (uint256 amountIn,uint256 feeAmount)",
  "function swapExactInput((bool fuelForWeth,uint256 amountIn,uint256 amountOutMinimum,address recipient,uint256 deadline,bool useNative) params) payable returns (uint256 amountOut)",
  "function swapExactOutput((bool fuelForWeth,uint256 amountOut,uint256 amountInMaximum,address recipient,uint256 deadline,bool useNative) params) payable returns (uint256 amountIn)",
]);

const protocolLiquidityVaultAbi = parseAbi([
  ...protocolErrorSignatures,
  "function registry() view returns (address)",
  "function manager() view returns (address)",
  "function fuel() view returns (address)",
  "function weth() view returns (address)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function executor() view returns (address)",
  "function canonicalFeeHook() view returns (address)",
  "function configurationSealed() view returns (bool)",
  "function paused() view returns (bool)",
  "function queuedWeth() view returns (uint256)",
  "function permanentlyLockedWeth() view returns (uint256)",
  "function liquidityCycleCount() view returns (uint256)",
  "function addLiquidityCycle(int24 tickLower,int24 tickUpper,uint128 liquidity,uint256 maximumWeth,uint256 deadline) returns (uint256)",
  "function setPaused(bool paused)",
  "event ProtocolLiquidityAdded(uint256 indexed cycleNumber,bytes32 indexed positionSalt,uint256 pulledWeth,uint256 consumedWeth,uint256 queuedWeth,uint256 permanentlyLockedWeth,int24 tickLower,int24 tickUpper,uint128 liquidity)",
]);

const erc20Abi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function approve(address spender,uint256 amount) returns (bool)",
]);
const permit2Abi = parseAbi([
  "function allowance(address owner,address token,address spender) view returns (uint160 amount,uint48 expiration,uint48 nonce)",
  "function approve(address token,address spender,uint160 amount,uint48 expiration)",
]);
const conversionAdapterAbi = parseAbi([
  "function configuredTrack() view returns (uint8)",
  "function converter() view returns (address)",
  "function weth() view returns (address)",
  "function usdc() view returns (address)",
  "function stockToken() view returns (address)",
  "function rewardLedger() view returns (address)",
  "function venue() view returns (address)",
  "function wethUsdcPoolId() view returns (bytes32)",
  "function usdcStockPoolId() view returns (bytes32)",
]);
const noReadsAbi = [] as const satisfies Abi;

const continuousClearingAuctionAbi = parseAbi([
  "function submitBid(uint256 maxPriceQ96,uint128 amount,address owner,uint256 prevTickPriceQ96,bytes hookData) payable returns (uint256 bidId)",
  "function submitBid(uint256 maxPriceQ96,uint128 amount,address owner,bytes hookData) payable returns (uint256 bidId)",
  "function checkpoint() returns ((uint256 clearingPrice,uint256 currencyRaisedAtClearingPriceQ96X7,uint256 cumulativeMpsPerPrice,uint24 cumulativeMps,uint64 prev,uint64 next) checkpoint)",
  "function clearingPrice() view returns (uint256)",
  "function isGraduated() view returns (bool)",
  "function currencyRaised() view returns (uint256)",
  "function totalCleared() view returns (uint256)",
  "function remainingSupply() view returns (uint256)",
  "function nextBidId() view returns (uint256)",
  "function lastCheckpointedBlock() view returns (uint64)",
  "function bids(uint256 bidId) view returns ((uint64 startBlock,uint24 startCumulativeMps,uint64 exitedBlock,uint256 maxPrice,address owner,uint256 amountQ96,uint256 tokensFilled) bid)",
  "function exitBid(uint256 bidId)",
  "function exitPartiallyFilledBid(uint256 bidId,uint64 lastFullyFilledCheckpointBlock,uint64 outbidBlock)",
  "function claimTokens(uint256 bidId)",
  "function claimTokensBatch(address owner,uint256[] bidIds)",
  "function currency() view returns (address)",
  "function token() view returns (address)",
  "function totalSupply() view returns (uint128)",
  "function tokensRecipient() view returns (address)",
  "function fundsRecipient() view returns (address)",
  "function startBlock() view returns (uint64)",
  "function endBlock() view returns (uint64)",
  "function claimBlock() view returns (uint64)",
  "function validationHook() view returns (address)",
  "function floorPrice() view returns (uint256)",
  "function tickSpacing() view returns (uint256)",
  "event BidSubmitted(uint256 indexed id,address indexed owner,uint256 priceQ96,uint128 amount)",
  "event BidExited(uint256 indexed bidId,address indexed owner,uint256 tokensFilled,uint256 currencyRefunded)",
  "event TokensClaimed(uint256 indexed bidId,address indexed owner,uint256 tokensFilled)",
  "event CheckpointUpdated(uint256 blockNumber,uint256 clearingPriceQ96,uint24 cumulativeMps)",
]);

const continuousClearingAuctionFactoryAbi = parseAbi([
  "function create(address token,uint256 amount,bytes configData,bytes32 salt) returns (address distributor)",
  "function getAddress(address token,uint256 amount,bytes configData,bytes32 salt,address sender) view returns (address distributor)",
  "function protocolFeeController() view returns (address)",
  "event AuctionCreated(address indexed auction,address indexed token,uint256 amount,bytes configData)",
]);

const ccaBidEscrowFactoryAbi = parseAbi([
  "function fuel() view returns (address)",
  "function currency() view returns (address)",
  "function registrar() view returns (address)",
  "function escrowOf(address beneficiary) view returns (address)",
  "function beneficiaryOf(address escrow) view returns (address)",
  "function isEscrow(address escrow) view returns (bool)",
  "function deployEscrow(address beneficiary) returns (address escrow)",
  "function predictEscrow(address beneficiary) view returns (address)",
  "event EscrowDeployed(address indexed beneficiary,address indexed escrow)",
]);

const ccaBidEscrowAbi = parseAbi([
  "function beneficiary() view returns (address)",
  "function fuel() view returns (address)",
  "function currency() view returns (address)",
  "function MAX_FUEL_WITHDRAWAL() view returns (uint256)",
  "function withdrawCurrency() returns (uint256 amount)",
  "function withdrawFuel() returns (uint256 amount)",
  "event Withdrawal(address indexed token,address indexed beneficiary,uint256 amount)",
]);

const ccaBidValidationHookAbi = parseAbi([
  "function auction() view returns (address)",
  "function factory() view returns (address)",
  "function validate(uint256 maxPrice,uint128 amount,address owner,address sender,bytes hookData) view",
]);

const ccaLaunchCoordinatorAbi = parseAbi([
  "function fuel() view returns (address)",
  "function readiness() view returns (address)",
  "function configurationAuthority() view returns (address)",
  "function governanceOwner() view returns (address)",
  "function escrowFactory() view returns (address)",
  "function configurationSealed() view returns (bool)",
  "function activated() view returns (bool)",
  "function activate()",
]);

const ccaCanonicalLaunchReadinessAbi = parseAbi([
  "function registry() view returns (address)",
  "function hook() view returns (address)",
  "function strategy() view returns (address)",
  "function positionRecipient() view returns (address)",
  "function isReady() view returns (bool)",
]);

const permanentPositionRecipientAbi = parseAbi([
  "function positionManager() view returns (address)",
  "function expectedPoolId() view returns (bytes32)",
  "function receivedPositionCount() view returns (uint256)",
  "function hasCanonicalPosition() view returns (bool)",
]);

const ccaRecoverySeederAbi = parseAbi([
  "function registry() view returns (address)",
  "function strategy() view returns (address)",
  "function positionRecipient() view returns (address)",
  "function auction() view returns (address)",
  "function reserveSupply() view returns (uint128)",
  "function migrationBlock() view returns (uint64)",
  "function seeded() view returns (bool)",
  "function sweepUnsoldTokens()",
  "function recoverAndSeed()",
]);

const discoveryAdapterAbi = parseAbi([
  "function requestSequenceCount() view returns (uint256)",
  "function nextFinalizationSequence() view returns (uint256)",
  "function vrfRequestIdAtSequence(uint256 sequence) view returns (uint256)",
  "function requestSequence(uint256 vrfRequestId) view returns (uint256)",
  "function vrfRequestForProtocolRequest(bytes32 protocolRequestId) view returns (uint256)",
  "function protocolRequestCount(uint256 vrfRequestId) view returns (uint256)",
  "function protocolRequestIdAt(uint256 vrfRequestId,uint256 index) view returns (bytes32)",
  "function requestStatus(uint256 vrfRequestId) view returns (uint8 state,uint256 requestedAt,uint256 fulfilledAt,uint256 count,uint256 finalizedCount,bool delayReported)",
  "function isDelayed(uint256 vrfRequestId) view returns (bool)",
  "function reportDelayedRequest(uint256 vrfRequestId) returns (bool reported)",
  "function skipCancelledDiscovery(uint256 vrfRequestId) returns (uint256 skipped)",
  "function finalizeDiscovery(uint256 vrfRequestId,uint256 maxCount) returns (uint256 processed,uint256 remaining)",
  "event DiscoveryRandomnessRequested(uint256 indexed vrfRequestId,uint256 count)",
  "event DiscoveryRandomnessReady(uint256 indexed vrfRequestId,uint256 count)",
  "event DiscoveryRandomnessDelayed(uint256 indexed vrfRequestId,uint256 requestedAt,uint256 reportedAt)",
  "event DiscoveryFinalizationProgress(uint256 indexed vrfRequestId,uint256 finalizedCount,uint256 totalCount)",
]);

const sharedRequiredContracts = {
  fuelCore: fuelCoreAbi,
  fuelMirror: fuelMirrorAbi,
  attributeRegistry: attributeRegistryAbi,
  rewardLedger: rewardLedgerAbi,
  claimGate: parseAbi([
    "function isClaimAllowed(address currentOwner) view returns (bool)",
    // Present only on the configurable proof-of-concept policy. The
    // always-allow policy has no administrator and no per-account state.
    "function isAllowed(address account) view returns (bool)",
    "function owner() view returns (address)",
    "function pendingOwner() view returns (address)",
    "function setClaimAllowed(address account,bool allowed)",
    "event ClaimPermissionSet(address indexed account,bool allowed)",
  ]),
  discoveryAdapter: discoveryAdapterAbi,
  epochConverter: epochConverterAbi,
  canonicalMarketRegistry: canonicalMarketRegistryAbi,
  canonicalFeeHook: canonicalFeeHookAbi,
  canonicalRouter: canonicalRouterAbi,
  canonicalHookDeployer: noReadsAbi,
  protocolLiquidityVault: protocolLiquidityVaultAbi,
  uniswapV4PoolManager: parseAbi([
    "function extsload(bytes32 slot) view returns (bytes32 value)",
  ]),
  metadataRenderer: parseAbi([
    "function attributeRegistry() view returns (address)",
  ]),
  testConversionVenue: parseAbi([
    "function manager() view returns (address)",
    "function quoteExactInput(address tokenIn,address tokenOut,uint256 amountIn) returns (uint256 amountOut)",
  ]),
  usdc: erc20Abi,
  weth: erc20Abi,
  mockAaplc: erc20Abi,
  mockGooglc: erc20Abi,
  mockMetac: erc20Abi,
  mockNvdac: erc20Abi,
  aaplcConversionAdapter: conversionAdapterAbi,
  googlcConversionAdapter: conversionAdapterAbi,
  metacConversionAdapter: conversionAdapterAbi,
  nvdacConversionAdapter: conversionAdapterAbi,
} as const satisfies Record<string, Abi>;

const legacyRequiredContracts = {
  genesisLiquidityVault: parseAbi([
    "function registry() view returns (address)",
    "function manager() view returns (address)",
    "function liquidToken() view returns (address)",
    "function weth() view returns (address)",
    "function seeded() view returns (bool)",
    "function seededLiquidity() view returns (uint128)",
  ]),
} as const satisfies Record<string, Abi>;

const ccaRequiredContracts = {
  continuousClearingAuction: continuousClearingAuctionAbi,
  continuousClearingAuctionFactory: continuousClearingAuctionFactoryAbi,
  ccaBidEscrowFactory: ccaBidEscrowFactoryAbi,
  ccaBidValidationHook: ccaBidValidationHookAbi,
  ccaLaunchFunding: noReadsAbi,
  ccaLaunchCoordinator: ccaLaunchCoordinatorAbi,
  ccaCanonicalLaunchReadiness: ccaCanonicalLaunchReadinessAbi,
  ccaRecoverySeeder: ccaRecoverySeederAbi,
  permanentPositionRecipient: permanentPositionRecipientAbi,
  liquidityLauncher: noReadsAbi,
  ccaStrategy: noReadsAbi,
  permit2: permit2Abi,
  uniswapV4PositionManager: noReadsAbi,
} as const satisfies Record<string, Abi>;

const optionalCcaContracts = {
  ccaCreate2Deployer: noReadsAbi,
} as const satisfies Record<string, Abi>;

const requiredContracts = {
  ...sharedRequiredContracts,
  ...legacyRequiredContracts,
  ...ccaRequiredContracts,
  ...optionalCcaContracts,
} as const;

export type ProtocolContractName = keyof typeof requiredContracts;
export type ProtocolAbi<Name extends ProtocolContractName> =
  (typeof requiredContracts)[Name];
export type ProtocolContract<Name extends ProtocolContractName> = {
  readonly address: Address;
  readonly abi: ProtocolAbi<Name>;
};

export const createProtocolContracts = (
  manifest: ProtocolDeploymentManifest,
): {
  readonly [Name in ProtocolContractName]: ProtocolContract<Name>;
} =>
  Object.fromEntries(
    Object.entries({
      ...sharedRequiredContracts,
      ...(manifest.schemaVersion === 2
        ? legacyRequiredContracts
        : {
            ...ccaRequiredContracts,
            ...(!("ccaCreate2Deployer" in manifest.contracts)
              ? {}
              : optionalCcaContracts),
          }),
    }).map(([untypedName, abi]) => {
      const name = untypedName as ProtocolContractName;
      const address = (manifest.contracts as Readonly<Record<string, string>>)[
        name
      ];
      if (address === undefined) {
        throw new Error(`Missing protocol contract ${name}`);
      }
      return [name, { address: address as Address, abi }];
    }),
  ) as unknown as {
    readonly [Name in ProtocolContractName]: ProtocolContract<Name>;
  };

export const protocolAbis = requiredContracts;

export const ccaAbis = {
  continuousClearingAuction: continuousClearingAuctionAbi,
  continuousClearingAuctionFactory: continuousClearingAuctionFactoryAbi,
  bidEscrow: ccaBidEscrowAbi,
  bidEscrowFactory: ccaBidEscrowFactoryAbi,
  bidValidationHook: ccaBidValidationHookAbi,
  launchCoordinator: ccaLaunchCoordinatorAbi,
  launchReadiness: ccaCanonicalLaunchReadinessAbi,
  recoverySeeder: ccaRecoverySeederAbi,
  permanentPositionRecipient: permanentPositionRecipientAbi,
  liquidityLauncher: noReadsAbi,
  create2Deployer: noReadsAbi,
  launchFunding: noReadsAbi,
  permit2: permit2Abi,
} as const;

export type ContinuousClearingAuctionAbi = typeof continuousClearingAuctionAbi;
export type Permit2Abi = typeof permit2Abi;
export type CcaBid = ContractFunctionReturnType<
  ContinuousClearingAuctionAbi,
  "view",
  "bids"
>;
