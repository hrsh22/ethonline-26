// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {AttributeRegistry} from "./AttributeRegistry.sol";
import {TwoStepOwnable} from "./governance/TwoStepOwnable.sol";
import {IClaimGate} from "./interfaces/IClaimGate.sol";
import {IRewardLedger} from "./interfaces/IRewardLedger.sol";

interface IRewardFuelCore {
    function identityOwner(uint16 identityId) external view returns (address);
    function isPermanentIdentity(uint16 identityId) external view returns (bool);
}

interface IRewardToken {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool);
}

/// @notice Accounts for identity-bound Stock Rewards across four independent Reward Tracks.
contract RewardLedger is IRewardLedger, TwoStepOwnable {
    uint16 public constant FIRST_BASKET_RELIC_ID = 4_441;
    uint16 public constant SECOND_BASKET_RELIC_ID = 4_442;
    uint16 public constant THIRD_BASKET_RELIC_ID = 4_443;
    uint16 public constant INDICATOR_RELIC_ID = 4_444;
    uint256 public constant MAX_CLAIM_IDENTITIES = 64;

    uint256 private constant _BASIS_POINTS = 10_000;
    uint256 private constant _ORDINARY_BASIS_POINTS = 8_250;
    uint256 private constant _BASKET_RELIC_BASIS_POINTS = 1_250;

    struct TierAccounting {
        uint256 activeCount;
        uint256 activeWeight;
        uint256 accumulatedRewardPerIdentity;
        uint16 roundingRecipient;
    }

    struct TrackAccounting {
        uint256 totalActiveWeight;
        uint256 unclaimedPot;
        uint256 liability;
        uint16 roundingRecipient;
        uint8 basketRemainderCursor;
        TierAccounting[4] tiers;
    }

    struct OrdinaryAccount {
        bool active;
        uint8 trackIndex;
        uint8 tierIndex;
        uint256 rewardDebt;
    }

    address public immutable override fuelCore;
    AttributeRegistry public immutable attributeRegistry;
    IClaimGate public immutable claimGate;
    address public override epochConverter;
    bool public rewardNotificationsPaused;

    address[4] private _rewardTokens;
    mapping(uint8 trackIndex => TrackAccounting accounting) private _trackAccounting;
    mapping(uint16 identityId => OrdinaryAccount account) private _ordinaryAccounts;
    mapping(uint16 identityId => bool active) public isActive;
    mapping(uint16 identityId => mapping(uint8 trackIndex => uint256 amount)) private _accrued;

    error AlreadyActive(uint16 identityId);
    error ClaimDenied(address currentOwner);
    error ClaimBatchTooLarge(uint256 requested, uint256 maximum);
    error EmptyClaim();
    error EpochConverterAlreadySealed(address converter);
    error IdentityNotActive(uint16 identityId);
    error IdentityNotPermanent(uint16 identityId);
    error InsufficientRewardBalance(uint256 balance, uint256 required);
    error InvalidConfiguration(address account);
    error InvalidRewardAmount();
    error InvalidRewardToken(address expected, address actual);
    error InvalidRewardTrack(AttributeRegistry.RewardTrack track);
    error InvalidRarityTier(AttributeRegistry.RarityTier tier);
    error NotIdentityOwner(uint16 identityId, address expectedOwner, address actualOwner);
    error RewardNotificationsArePaused();
    error TokenTransferFailed(address token, address recipient, uint256 amount);
    error Unauthorized(address caller);
    error UnauthorizedEpochConverter(address caller);
    error UnauthorizedFuelCore(address caller);
    error UnsealedAttributeRegistry();

    event EpochConverterSealed(address indexed converter);
    event IdentityActivated(
        uint16 indexed identityId,
        AttributeRegistry.RewardTrack indexed track,
        uint16 weight,
        uint256 unclaimedPotCredit
    );
    event IdentityCheckpointed(uint16 indexed identityId, uint256 accruedReward);
    event RewardClaimed(
        address indexed currentOwner,
        uint16 indexed identityId,
        AttributeRegistry.RewardTrack indexed track,
        uint256 amount
    );
    event RewardNotified(
        AttributeRegistry.RewardTrack indexed track,
        address indexed token,
        uint256 amount,
        uint256 ordinaryAllocation,
        uint256 basketRelicAllocation,
        uint256 indicatorRelicAllocation
    );
    event RewardNotificationsPausedSet(bool paused);

    constructor(
        address fuelCore_,
        AttributeRegistry attributeRegistry_,
        address[4] memory rewardTokens_,
        IClaimGate claimGate_,
        address owner_
    ) TwoStepOwnable(owner_) {
        if (fuelCore_.code.length == 0) {
            revert InvalidConfiguration(fuelCore_);
        }
        if (address(attributeRegistry_).code.length == 0) {
            revert InvalidConfiguration(address(attributeRegistry_));
        }
        if (!attributeRegistry_.isSealed()) revert UnsealedAttributeRegistry();
        if (address(claimGate_).code.length == 0) {
            revert InvalidConfiguration(address(claimGate_));
        }
        for (uint256 index = 0; index < rewardTokens_.length; ++index) {
            address token = rewardTokens_[index];
            if (token.code.length == 0) revert InvalidConfiguration(token);
            for (uint256 prior = 0; prior < index; ++prior) {
                if (rewardTokens_[prior] == token) revert InvalidConfiguration(token);
            }
            _rewardTokens[index] = token;
        }

        fuelCore = fuelCore_;
        attributeRegistry = attributeRegistry_;
        claimGate = claimGate_;
    }

    modifier onlyFuelCore() {
        if (msg.sender != fuelCore) revert UnauthorizedFuelCore(msg.sender);
        _;
    }

    modifier onlyEpochConverter() {
        if (msg.sender != epochConverter) revert UnauthorizedEpochConverter(msg.sender);
        _;
    }

    function sealEpochConverter(address converter) external onlyOwner {
        if (epochConverter != address(0)) revert EpochConverterAlreadySealed(epochConverter);
        if (converter.code.length == 0) revert InvalidConfiguration(converter);
        epochConverter = converter;
        emit EpochConverterSealed(converter);
    }

    function setRewardNotificationsPaused(bool paused) external onlyOwner {
        rewardNotificationsPaused = paused;
        emit RewardNotificationsPausedSet(paused);
    }

    function activate(uint16 identityId) external override onlyFuelCore {
        if (isActive[identityId]) revert AlreadyActive(identityId);
        if (!IRewardFuelCore(fuelCore).isPermanentIdentity(identityId)) {
            revert IdentityNotPermanent(identityId);
        }

        AttributeRegistry.Attributes memory attributes = attributeRegistry.attributeOf(identityId);
        isActive[identityId] = true;
        uint256 unclaimedPotCredit;
        if (attributes.collectibleKind == AttributeRegistry.CollectibleKind.Ordinary) {
            uint8 trackIndex = _trackIndex(attributes.track);
            uint8 tierIndex = _tierIndex(attributes.tier);
            TrackAccounting storage accounting = _trackAccounting[trackIndex];
            TierAccounting storage tier = accounting.tiers[tierIndex];
            _ordinaryAccounts[identityId] = OrdinaryAccount({
                active: true,
                trackIndex: trackIndex,
                tierIndex: tierIndex,
                rewardDebt: tier.accumulatedRewardPerIdentity
            });
            accounting.totalActiveWeight += attributes.weight;
            ++tier.activeCount;
            tier.activeWeight += attributes.weight;
            if (accounting.roundingRecipient == 0) accounting.roundingRecipient = identityId;
            if (tier.roundingRecipient == 0) tier.roundingRecipient = identityId;
            unclaimedPotCredit = accounting.unclaimedPot;
            if (unclaimedPotCredit != 0) {
                accounting.unclaimedPot = 0;
                _accrued[identityId][trackIndex] += unclaimedPotCredit;
            }
        }

        emit IdentityActivated(identityId, attributes.track, attributes.weight, unclaimedPotCredit);
    }

    function checkpointBeforeTransfer(uint16 identityId) external override onlyFuelCore {
        _checkpoint(identityId);
    }

    function checkpointAfterTransfer(uint16 identityId) external override onlyFuelCore {
        _checkpoint(identityId);
    }

    function notifyReward(AttributeRegistry.RewardTrack track, address token, uint256 amount)
        external
        override
        onlyEpochConverter
    {
        if (rewardNotificationsPaused) revert RewardNotificationsArePaused();
        if (amount == 0) revert InvalidRewardAmount();
        uint8 trackIndex = _trackIndex(track);
        address expectedToken = _rewardTokens[trackIndex];
        if (token != expectedToken) revert InvalidRewardToken(expectedToken, token);

        TrackAccounting storage accounting = _trackAccounting[trackIndex];
        uint256 requiredBalance = accounting.liability + amount;
        uint256 actualBalance = IRewardToken(token).balanceOf(address(this));
        if (actualBalance < requiredBalance) {
            revert InsufficientRewardBalance(actualBalance, requiredBalance);
        }

        uint256 ordinaryAllocation = Math.mulDiv(amount, _ORDINARY_BASIS_POINTS, _BASIS_POINTS);
        uint256 basketRelicAllocation =
            Math.mulDiv(amount, _BASKET_RELIC_BASIS_POINTS, _BASIS_POINTS);
        uint256 indicatorRelicAllocation = amount - ordinaryAllocation - basketRelicAllocation;

        _allocateOrdinary(trackIndex, accounting, ordinaryAllocation);
        uint256 basketRelicShare = basketRelicAllocation / 3;
        _accrued[FIRST_BASKET_RELIC_ID][trackIndex] += basketRelicShare;
        _accrued[SECOND_BASKET_RELIC_ID][trackIndex] += basketRelicShare;
        _accrued[THIRD_BASKET_RELIC_ID][trackIndex] += basketRelicShare;
        uint256 basketRemainder = basketRelicAllocation - basketRelicShare * 3;
        for (uint256 offset = 0; offset < basketRemainder; ++offset) {
            uint16 recipient = FIRST_BASKET_RELIC_ID
                + uint16((uint256(accounting.basketRemainderCursor) + offset) % 3);
            ++_accrued[recipient][trackIndex];
        }
        accounting.basketRemainderCursor =
            uint8((uint256(accounting.basketRemainderCursor) + basketRemainder) % 3);
        _accrued[INDICATOR_RELIC_ID][trackIndex] += indicatorRelicAllocation;
        accounting.liability = requiredBalance;

        emit RewardNotified(
            track,
            token,
            amount,
            ordinaryAllocation,
            basketRelicAllocation,
            indicatorRelicAllocation
        );
    }

    function claim(uint16[] calldata identityIds) external override {
        if (identityIds.length == 0) revert EmptyClaim();
        if (identityIds.length > MAX_CLAIM_IDENTITIES) {
            revert ClaimBatchTooLarge(identityIds.length, MAX_CLAIM_IDENTITIES);
        }
        IRewardFuelCore core = IRewardFuelCore(fuelCore);
        for (uint256 index = 0; index < identityIds.length; ++index) {
            uint16 identityId = identityIds[index];
            address currentOwner = core.identityOwner(identityId);
            if (currentOwner != msg.sender) {
                revert NotIdentityOwner(identityId, msg.sender, currentOwner);
            }
            if (!core.isPermanentIdentity(identityId) || !isActive[identityId]) {
                revert IdentityNotPermanent(identityId);
            }
        }
        if (!claimGate.isClaimAllowed(msg.sender)) revert ClaimDenied(msg.sender);

        uint256[4] memory payouts;
        for (uint256 identityIndex = 0; identityIndex < identityIds.length; ++identityIndex) {
            uint16 identityId = identityIds[identityIndex];
            _checkpoint(identityId);
            for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
                uint256 amount = _accrued[identityId][trackIndex];
                if (amount == 0) continue;
                _accrued[identityId][trackIndex] = 0;
                payouts[trackIndex] += amount;
                emit RewardClaimed(msg.sender, identityId, _rewardTrack(trackIndex), amount);
            }
        }

        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            uint256 amount = payouts[trackIndex];
            if (amount == 0) continue;
            _trackAccounting[trackIndex].liability -= amount;
            _safeTransfer(_rewardTokens[trackIndex], msg.sender, amount);
        }
    }

    function pending(uint16 identityId, AttributeRegistry.RewardTrack track)
        public
        view
        override
        returns (uint256 amount)
    {
        uint8 trackIndex = _trackIndex(track);
        amount = _accrued[identityId][trackIndex];
        OrdinaryAccount memory account = _ordinaryAccounts[identityId];
        if (!account.active || account.trackIndex != trackIndex) return amount;
        return amount
            + _ordinaryPendingSinceDebt(
            account,
            _trackAccounting[trackIndex].tiers[account.tierIndex].accumulatedRewardPerIdentity
        );
    }

    function pendingAll(uint16 identityId)
        external
        view
        override
        returns (uint256[4] memory amounts)
    {
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            amounts[trackIndex] = pending(identityId, _rewardTrack(trackIndex));
        }
    }

    function rewardToken(AttributeRegistry.RewardTrack track)
        external
        view
        override
        returns (address)
    {
        return _rewardTokens[_trackIndex(track)];
    }

    function totalActiveWeight(AttributeRegistry.RewardTrack track)
        external
        view
        override
        returns (uint256)
    {
        return _trackAccounting[_trackIndex(track)].totalActiveWeight;
    }

    function unclaimedTrackPot(AttributeRegistry.RewardTrack track)
        external
        view
        override
        returns (uint256)
    {
        return _trackAccounting[_trackIndex(track)].unclaimedPot;
    }

    function totalLiability(AttributeRegistry.RewardTrack track)
        external
        view
        override
        returns (uint256)
    {
        return _trackAccounting[_trackIndex(track)].liability;
    }

    function ordinaryRewardDebt(uint16 identityId) external view returns (uint256) {
        return _ordinaryAccounts[identityId].rewardDebt;
    }

    function _allocateOrdinary(uint8 trackIndex, TrackAccounting storage accounting, uint256 amount)
        private
    {
        uint256 totalWeight = accounting.totalActiveWeight;
        if (totalWeight == 0) {
            accounting.unclaimedPot += amount;
            return;
        }

        uint256 allocated;
        for (uint8 tierIndex = 0; tierIndex < 4; ++tierIndex) {
            TierAccounting storage tier = accounting.tiers[tierIndex];
            uint256 activeCount = tier.activeCount;
            if (activeCount == 0) continue;

            uint256 tierAllocation = Math.mulDiv(amount, tier.activeWeight, totalWeight);
            allocated += tierAllocation;
            uint256 rewardPerIdentity = tierAllocation / activeCount;
            tier.accumulatedRewardPerIdentity += rewardPerIdentity;
            _accrued[tier.roundingRecipient][trackIndex] += tierAllocation - rewardPerIdentity
                * activeCount;
        }
        _accrued[accounting.roundingRecipient][trackIndex] += amount - allocated;
    }

    function _checkpoint(uint16 identityId) private {
        if (!isActive[identityId]) revert IdentityNotActive(identityId);
        OrdinaryAccount storage account = _ordinaryAccounts[identityId];
        if (!account.active) {
            emit IdentityCheckpointed(identityId, 0);
            return;
        }

        uint256 accumulatedRewardPerIdentity =
            _trackAccounting[account.trackIndex].tiers[account.tierIndex].accumulatedRewardPerIdentity;
        uint256 newlyAccrued = _ordinaryPendingSinceDebt(account, accumulatedRewardPerIdentity);
        if (newlyAccrued != 0) {
            _accrued[identityId][account.trackIndex] += newlyAccrued;
        }
        account.rewardDebt = accumulatedRewardPerIdentity;
        emit IdentityCheckpointed(identityId, newlyAccrued);
    }

    function _ordinaryPendingSinceDebt(
        OrdinaryAccount memory account,
        uint256 accumulatedRewardPerIdentity
    ) private pure returns (uint256) {
        return accumulatedRewardPerIdentity - account.rewardDebt;
    }

    function _safeTransfer(address token, address recipient, uint256 amount) private {
        (bool success, bytes memory result) =
            token.call(abi.encodeCall(IRewardToken.transfer, (recipient, amount)));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TokenTransferFailed(token, recipient, amount);
        }
    }

    function _trackIndex(AttributeRegistry.RewardTrack track) private pure returns (uint8) {
        uint8 trackCode = uint8(track);
        if (trackCode == 0 || trackCode > 4) revert InvalidRewardTrack(track);
        return trackCode - 1;
    }

    function _rewardTrack(uint8 trackIndex) private pure returns (AttributeRegistry.RewardTrack) {
        return AttributeRegistry.RewardTrack(trackIndex + 1);
    }

    function _tierIndex(AttributeRegistry.RarityTier tier) private pure returns (uint8) {
        uint8 tierCode = uint8(tier);
        if (tierCode == 0 || tierCode > 4) revert InvalidRarityTier(tier);
        return tierCode - 1;
    }
}
