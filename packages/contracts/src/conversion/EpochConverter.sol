// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {AttributeRegistry} from "../AttributeRegistry.sol";
import {TwoStepOwnable} from "../governance/TwoStepOwnable.sol";
import {ICanonicalFeeHook} from "../interfaces/ICanonicalFeeHook.sol";
import {IConversionAdapter} from "../interfaces/IConversionAdapter.sol";
import {IRewardLedger} from "../interfaces/IRewardLedger.sol";

interface IEpochConversionToken {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice Opens Reward Epochs and keeps one independent WETH queue per Reward Track.
contract EpochConverter is TwoStepOwnable {
    uint256 public constant MINIMUM_EPOCH_WETH = 0.04 ether;
    uint256 public constant MAXIMUM_EPOCH_WETH = 40 ether;
    uint256 public constant MINIMUM_EPOCH_INTERVAL = 60 seconds;
    uint256 public constant MAXIMUM_TRACK_EXECUTION_WETH = 10 ether;

    address public immutable weth;
    address public immutable rewardLedger;
    address public keeper;
    ICanonicalFeeHook public canonicalFeeHook;
    bool public configurationSealed;
    bool public paused;
    uint256 public rewardEpochCount;
    uint256 public lastRewardEpochAt;

    uint256[4] private _trackQueues;

    struct TrackConfiguration {
        address stockToken;
        IConversionAdapter adapter;
    }

    TrackConfiguration[4] private _trackConfigurations;

    error RewardPotBelowMinimum(uint256 available, uint256 minimum);
    error RewardEpochIntervalPending(uint256 nextEpochAt);
    error InvalidConfiguration(address configured);
    error ConfigurationAlreadySealed();
    error ConfigurationNotSealed();
    error EmptyTrackQueue(AttributeRegistry.RewardTrack track);
    error ConfigurationMismatch(address expected, address actual);
    error AdapterTrackMismatch(
        AttributeRegistry.RewardTrack expected, AttributeRegistry.RewardTrack actual
    );
    error MissingTrackConfiguration(AttributeRegistry.RewardTrack track);
    error InvalidRewardTrack(AttributeRegistry.RewardTrack track);
    error Paused();
    error UnauthorizedOwner(address caller);
    error UnauthorizedKeeper(address caller);
    error TokenApprovalFailed(address token, address spender, uint256 amount);
    error UnexpectedStockOutput(uint256 minimum, uint256 measured);
    error UnexpectedWethPull(uint256 expected, uint256 measured);
    error UnexpectedWethSpend(uint256 expected, uint256 measured);

    event CanonicalFeeHookConfigured(address indexed hook);
    event ConfigurationSealedForever(address indexed hook, address indexed rewardLedger);
    event KeeperReplaced(address indexed previousKeeper, address indexed replacementKeeper);
    event PausedSet(bool paused);
    event RewardEpochOpened(
        uint256 indexed epochNumber,
        uint256 openedAmount,
        uint256 equalTrackShare,
        uint256 finalTrackRemainder
    );
    event TrackConfigured(
        AttributeRegistry.RewardTrack indexed track,
        address indexed stockToken,
        address indexed adapter
    );
    event TrackExecuted(
        AttributeRegistry.RewardTrack indexed track,
        uint256 wethInput,
        uint256 measuredStockOutput,
        uint256 deferredTrackBudget
    );

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert UnauthorizedKeeper(msg.sender);
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    constructor(address weth_, address rewardLedger_, address keeper_, address owner_)
        TwoStepOwnable(owner_)
    {
        if (weth_.code.length == 0) revert InvalidConfiguration(weth_);
        if (rewardLedger_.code.length == 0) revert InvalidConfiguration(rewardLedger_);
        if (keeper_ == address(0)) revert InvalidConfiguration(keeper_);
        weth = weth_;
        rewardLedger = rewardLedger_;
        keeper = keeper_;
    }

    function configureCanonicalFeeHook(ICanonicalFeeHook hook) external onlyOwner {
        if (configurationSealed) revert ConfigurationAlreadySealed();
        canonicalFeeHook = hook;
        emit CanonicalFeeHookConfigured(address(hook));
    }

    function sealConfiguration() external onlyOwner {
        if (configurationSealed) revert ConfigurationAlreadySealed();
        _validateConfiguration();
        configurationSealed = true;
        emit ConfigurationSealedForever(address(canonicalFeeHook), rewardLedger);
    }

    function setKeeper(address replacement) external onlyOwner {
        if (replacement == address(0)) revert InvalidConfiguration(replacement);
        address previousKeeper = keeper;
        keeper = replacement;
        emit KeeperReplaced(previousKeeper, replacement);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function configureTrack(
        AttributeRegistry.RewardTrack track,
        address stockToken,
        IConversionAdapter adapter
    ) external onlyOwner {
        if (configurationSealed) revert ConfigurationAlreadySealed();
        uint8 trackIndex = _trackIndex(track);
        _trackConfigurations[trackIndex] =
            TrackConfiguration({stockToken: stockToken, adapter: adapter});
        emit TrackConfigured(track, stockToken, address(adapter));
    }

    function openRewardEpoch() external onlyKeeper whenNotPaused returns (uint256 openedAmount) {
        if (!configurationSealed) revert ConfigurationNotSealed();
        uint256 previousEpochAt = lastRewardEpochAt;
        // Keeper timing intentionally follows the chain timestamp, with only a 60-second bound.
        // forge-lint: disable-next-line(block-timestamp)
        if (rewardEpochCount != 0 && block.timestamp < previousEpochAt + MINIMUM_EPOCH_INTERVAL) {
            revert RewardEpochIntervalPending(previousEpochAt + MINIMUM_EPOCH_INTERVAL);
        }
        uint256 available = canonicalFeeHook.rewardPot();
        if (available < MINIMUM_EPOCH_WETH) {
            revert RewardPotBelowMinimum(available, MINIMUM_EPOCH_WETH);
        }
        openedAmount = available > MAXIMUM_EPOCH_WETH ? MAXIMUM_EPOCH_WETH : available;
        uint256 wethBalanceBefore = IEpochConversionToken(weth).balanceOf(address(this));
        canonicalFeeHook.pullRewardPot(openedAmount);
        uint256 measuredWethPull =
            IEpochConversionToken(weth).balanceOf(address(this)) - wethBalanceBefore;
        if (measuredWethPull != openedAmount) {
            revert UnexpectedWethPull(openedAmount, measuredWethPull);
        }
        lastRewardEpochAt = block.timestamp;
        uint256 epochNumber = ++rewardEpochCount;

        uint256 equalShare = openedAmount / 4;
        _trackQueues[0] += equalShare;
        _trackQueues[1] += equalShare;
        _trackQueues[2] += equalShare;
        _trackQueues[3] += openedAmount - equalShare * 3;
        emit RewardEpochOpened(epochNumber, openedAmount, equalShare, openedAmount - equalShare * 4);
    }

    function trackQueue(AttributeRegistry.RewardTrack track) external view returns (uint256) {
        return _trackQueues[_trackIndex(track)];
    }

    function trackConfiguration(AttributeRegistry.RewardTrack track)
        external
        view
        returns (address stockToken, IConversionAdapter adapter)
    {
        TrackConfiguration memory configuration = _trackConfigurations[_trackIndex(track)];
        return (configuration.stockToken, configuration.adapter);
    }

    function executeTrack(
        AttributeRegistry.RewardTrack track,
        uint256 minimumStockOutput,
        uint256 deadline
    ) external onlyKeeper whenNotPaused returns (uint256 measuredStockOutput) {
        if (!configurationSealed) revert ConfigurationNotSealed();
        uint8 trackIndex = _trackIndex(track);
        uint256 queued = _trackQueues[trackIndex];
        if (queued == 0) revert EmptyTrackQueue(track);
        uint256 wethInput =
            queued > MAXIMUM_TRACK_EXECUTION_WETH ? MAXIMUM_TRACK_EXECUTION_WETH : queued;
        TrackConfiguration memory configuration = _trackConfigurations[trackIndex];

        uint256 wethBalanceBefore = IEpochConversionToken(weth).balanceOf(address(this));
        uint256 stockBalanceBefore =
            IEpochConversionToken(configuration.stockToken).balanceOf(rewardLedger);
        if (!IEpochConversionToken(weth).approve(address(configuration.adapter), wethInput)) {
            revert TokenApprovalFailed(weth, address(configuration.adapter), wethInput);
        }
        configuration.adapter.convert(track, wethInput, minimumStockOutput, deadline);
        if (!IEpochConversionToken(weth).approve(address(configuration.adapter), 0)) {
            revert TokenApprovalFailed(weth, address(configuration.adapter), 0);
        }
        uint256 measuredWethSpend =
            wethBalanceBefore - IEpochConversionToken(weth).balanceOf(address(this));
        if (measuredWethSpend != wethInput) {
            revert UnexpectedWethSpend(wethInput, measuredWethSpend);
        }
        measuredStockOutput = IEpochConversionToken(configuration.stockToken)
                .balanceOf(rewardLedger) - stockBalanceBefore;
        if (measuredStockOutput == 0 || measuredStockOutput < minimumStockOutput) {
            revert UnexpectedStockOutput(minimumStockOutput, measuredStockOutput);
        }

        _trackQueues[trackIndex] = queued - wethInput;
        IRewardLedger(rewardLedger)
            .notifyReward(track, configuration.stockToken, measuredStockOutput);
        emit TrackExecuted(track, wethInput, measuredStockOutput, queued - wethInput);
    }

    function _trackIndex(AttributeRegistry.RewardTrack track) private pure returns (uint8) {
        uint8 trackCode = uint8(track);
        if (trackCode == 0 || trackCode > 4) revert InvalidRewardTrack(track);
        return trackCode - 1;
    }

    function _validateConfiguration() private view {
        if (weth.code.length == 0) revert InvalidConfiguration(weth);
        if (rewardLedger.code.length == 0) revert InvalidConfiguration(rewardLedger);
        address hookAddress = address(canonicalFeeHook);
        if (hookAddress.code.length == 0) revert InvalidConfiguration(hookAddress);
        address configuredWeth = canonicalFeeHook.weth();
        if (configuredWeth != weth) revert ConfigurationMismatch(weth, configuredWeth);
        address configuredRewardDestination = canonicalFeeHook.rewardDestination();
        if (configuredRewardDestination != address(this)) {
            revert ConfigurationMismatch(address(this), configuredRewardDestination);
        }
        address configuredConverter = IRewardLedger(rewardLedger).epochConverter();
        if (configuredConverter != address(this)) {
            revert ConfigurationMismatch(address(this), configuredConverter);
        }

        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            TrackConfiguration memory configuration = _trackConfigurations[trackIndex];
            if (
                configuration.stockToken.code.length == 0
                    || address(configuration.adapter).code.length == 0
            ) {
                revert MissingTrackConfiguration(track);
            }
            address ledgerToken = IRewardLedger(rewardLedger).rewardToken(track);
            if (ledgerToken != configuration.stockToken) {
                revert ConfigurationMismatch(configuration.stockToken, ledgerToken);
            }
            AttributeRegistry.RewardTrack adapterTrack = configuration.adapter.configuredTrack();
            if (adapterTrack != track) {
                revert AdapterTrackMismatch(track, adapterTrack);
            }
            if (configuration.adapter.converter() != address(this)) {
                revert ConfigurationMismatch(address(this), configuration.adapter.converter());
            }
            if (configuration.adapter.weth() != weth) {
                revert ConfigurationMismatch(weth, configuration.adapter.weth());
            }
            if (configuration.adapter.stockToken() != configuration.stockToken) {
                revert ConfigurationMismatch(
                    configuration.stockToken, configuration.adapter.stockToken()
                );
            }
            if (configuration.adapter.rewardLedger() != rewardLedger) {
                revert ConfigurationMismatch(rewardLedger, configuration.adapter.rewardLedger());
            }
        }
    }
}
