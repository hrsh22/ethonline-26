// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelMirror} from "./FuelMirror.sol";
import {TwoStepOwnable} from "./governance/TwoStepOwnable.sol";
import {ICanonicalMarketRegistry} from "./interfaces/ICanonicalMarketRegistry.sol";
import {ICollectibleMetadata} from "./interfaces/ICollectibleMetadata.sol";
import {IDiscoveryAdapter} from "./interfaces/IDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "./interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "./interfaces/IThresholdRecovery.sol";

contract FuelCore is TwoStepOwnable {
    uint8 public constant decimals = 18;
    uint256 public constant MAX_LIQUID_SUPPLY = 4_444 ether;
    uint256 public constant MAX_DISCOVERY_MUTATIONS_PER_TRANSFER = 64;

    string public name;
    string public symbol;
    uint256 public totalSupply;
    uint16 public permanentCount;
    uint16 public availableIdentityCount = 4_444;
    uint16 public totalTransientCount;
    uint256 public totalPendingDiscoveryCount;
    uint256 public discoveryNonce;
    bool public launched;
    bool public paused;

    enum IdentityState {
        Available,
        Transient,
        Permanent
    }

    struct BackingSlot {
        uint16 identityId;
        bytes32 requestId;
    }

    struct PendingDiscovery {
        address recipient;
        bool active;
        bool used;
    }

    address public immutable guardian;
    IThresholdRecovery public immutable recoveryAuthority;
    IDiscoveryAdapter public discoveryAdapter;
    IRewardLedgerCallbacks public rewardLedger;
    ICanonicalMarketRegistry public canonicalMarketRegistry;
    FuelMirror public immutable mirror;

    bool private _entered;

    mapping(address account => uint256 balance) public balanceOf;
    mapping(address owner_ => mapping(address spender => uint256 amount)) public allowance;
    mapping(address account => bool exempt) public isDiscoveryExempt;
    mapping(address account => bool protected_) public isProtectedAccount;
    mapping(address account => bool frozen) public isFrozen;
    mapping(bytes32 codehash => bool blocked) public isBlockedVenueCodehash;
    mapping(address account => uint16[] identityIds) private _transientIdentities;
    mapping(address account => BackingSlot[] slots) private _backingSlots;
    mapping(address account => bytes32[] requestIds) private _pendingDiscoveries;
    mapping(address account => mapping(uint16 identityId => uint256 indexPlusOne)) private
        _transientIdentityIndexPlusOne;
    mapping(address account => mapping(uint16 identityId => uint16 previousIdentity)) private
        _previousTransientIdentity;
    mapping(address account => mapping(uint16 identityId => uint16 nextIdentity)) private
        _nextTransientIdentity;
    mapping(address account => uint16 identityId) private _latestTransientIdentity;
    mapping(address account => mapping(bytes32 requestId => uint256 indexPlusOne)) private
        _pendingDiscoveryIndexPlusOne;
    mapping(address account => mapping(bytes32 requestId => bytes32 previousRequestId)) private
        _previousPendingDiscovery;
    mapping(address account => mapping(bytes32 requestId => bytes32 nextRequestId)) private
        _nextPendingDiscovery;
    mapping(address account => bytes32 requestId) private _latestPendingDiscovery;
    mapping(address account => mapping(uint16 identityId => uint256 indexPlusOne)) private
        _identityBackingSlotIndexPlusOne;
    mapping(address account => mapping(bytes32 requestId => uint256 indexPlusOne)) private
        _requestBackingSlotIndexPlusOne;
    mapping(bytes32 requestId => PendingDiscovery pending) private _pendingDiscovery;
    mapping(address account => uint256 count) public pendingDiscoveryCount;
    mapping(address account => uint256 count) public collectibleBalanceOf;
    mapping(uint16 identityId => address owner) public identityOwner;
    mapping(uint16 identityId => IdentityState state) public identityState;
    mapping(uint16 poolIndex => uint16 identityId) private _availablePool;

    error InsufficientBalance(address account, uint256 balance, uint256 required);
    error InsufficientAllowance(address spender, uint256 allowance_, uint256 required);
    error BackingInvariantBroken(address account);
    error InvalidRecipient();
    error ExemptRecipient(address recipient);
    error NoAvailableIdentity();
    error NotIdentityOwner(uint16 identityId, address expectedOwner, address actualOwner);
    error RecoveryThresholdTooLow(uint256 threshold);
    error TradingLocked();
    error UnauthorizedMirror(address caller);
    error UnauthorizedDiscoveryAdapter(address caller);
    error NotGuardian(address caller);
    error NotRecoveryAuthority(address caller);
    error InvalidCommitment(uint16 identityId, address caller, IdentityState state);
    error InvalidDiscoveryRequest(bytes32 requestId);
    error InvalidConfiguration(address account);
    error Paused();
    error FrozenAccount(address account);
    error BlockedVenue(address account, bytes32 codehash);
    error ProtectedRecoveryEndpoint(address account);
    error RewardLedgerNotConfigured();
    error Reentrancy();
    error UnauthorizedCanonicalFeeHook(address caller);
    error UnauthorizedPoolManagerSettlement(address operator, address from, address to);
    error DiscoveryMutationLimitExceeded(uint256 requested, uint256 maximum);

    event Transfer(address indexed from, address indexed to, uint256 amount);
    event Approval(address indexed owner, address indexed spender, uint256 amount);
    event Launched();
    event Committed(address indexed account, uint16 indexed identityId);
    event DiscoveryRequested(address indexed account, bytes32 indexed requestId);
    event DiscoveryFulfilled(
        address indexed account, bytes32 indexed requestId, uint16 indexed identityId
    );
    event DiscoveryCancelled(address indexed account, bytes32 indexed requestId);
    event LateDiscoveryIgnored(bytes32 indexed requestId);
    event DiscoveryExemptionSet(address indexed account, bool exempt);
    event ProtectedAccountSet(address indexed account, bool protected_);
    event DiscoveryAdapterSet(address indexed adapter);
    event MetadataRendererSet(address indexed renderer);
    event RewardLedgerSet(address indexed ledger);
    event CanonicalMarketRegistrySet(address indexed registry);
    event PausedSet(bool paused);
    event AccountFrozen(address indexed account, bool frozen, address indexed authority);
    event VenueCodehashBlocked(bytes32 indexed codehash, bool blocked);
    event LiquidRecovered(address indexed from, address indexed to, uint256 amount);
    event CollectibleRecovered(address indexed from, address indexed to, uint16 indexed identityId);

    constructor(
        string memory name_,
        string memory symbol_,
        string memory mirrorName_,
        string memory mirrorSymbol_,
        address initialSupplyRecipient,
        IDiscoveryAdapter discoveryAdapter_,
        address guardian_,
        IThresholdRecovery recoveryAuthority_
    ) TwoStepOwnable(msg.sender) {
        require(initialSupplyRecipient != address(0), "zero supply recipient");
        require(address(discoveryAdapter_) != address(0), "zero discovery adapter");
        require(guardian_ != address(0), "zero guardian");
        require(address(recoveryAuthority_) != address(0), "zero recovery authority");

        name = name_;
        symbol = symbol_;
        guardian = guardian_;
        recoveryAuthority = recoveryAuthority_;
        discoveryAdapter = discoveryAdapter_;
        mirror = new FuelMirror(mirrorName_, mirrorSymbol_);

        totalSupply = MAX_LIQUID_SUPPLY;
        balanceOf[initialSupplyRecipient] = MAX_LIQUID_SUPPLY;
        isDiscoveryExempt[initialSupplyRecipient] = true;
        emit Transfer(address(0), initialSupplyRecipient, MAX_LIQUID_SUPPLY);
    }

    modifier onlyMirror() {
        if (msg.sender != address(mirror)) revert UnauthorizedMirror(msg.sender);
        _;
    }

    modifier onlyRecoveryAuthority() {
        if (msg.sender != address(recoveryAuthority)) revert NotRecoveryAuthority(msg.sender);
        _;
    }

    modifier nonReentrant() {
        if (_entered) revert Reentrancy();
        _entered = true;
        _;
        _entered = false;
    }

    function launch() external onlyOwner {
        if (launched) revert TradingLocked();
        ICanonicalMarketRegistry registry = canonicalMarketRegistry;
        if (address(registry) == address(0) || !registry.isSealed()) {
            revert InvalidConfiguration(address(registry));
        }
        uint256 threshold = recoveryAuthority.getThreshold();
        if (threshold < 2) revert RecoveryThresholdTooLow(threshold);
        launched = true;
        emit Launched();
    }

    function setDiscoveryExempt(address account, bool exempt) external onlyOwner {
        if (launched) revert TradingLocked();
        if (account == address(0)) revert InvalidConfiguration(account);
        if (
            _transientIdentities[account].length != 0 || pendingDiscoveryCount[account] != 0
                || collectibleBalanceOf[account] != 0
        ) {
            revert InvalidConfiguration(account);
        }
        if (!exempt && balanceOf[account] >= 1 ether) revert InvalidConfiguration(account);
        isDiscoveryExempt[account] = exempt;
        emit DiscoveryExemptionSet(account, exempt);
    }

    function setProtectedAccount(address account, bool protected_) external onlyOwner {
        if (launched) revert TradingLocked();
        if (account == address(0)) revert InvalidConfiguration(account);
        isProtectedAccount[account] = protected_;
        emit ProtectedAccountSet(account, protected_);
    }

    function setDiscoveryAdapter(IDiscoveryAdapter adapter) external onlyOwner {
        if (launched) revert TradingLocked();
        if (address(adapter) == address(0)) revert InvalidConfiguration(address(adapter));
        discoveryAdapter = adapter;
        emit DiscoveryAdapterSet(address(adapter));
    }

    function setMetadataRenderer(ICollectibleMetadata renderer) external onlyOwner {
        if (launched) revert TradingLocked();
        if (address(renderer).code.length == 0) {
            revert InvalidConfiguration(address(renderer));
        }
        mirror.setMetadataRenderer(renderer);
        emit MetadataRendererSet(address(renderer));
    }

    function setRewardLedger(IRewardLedgerCallbacks ledger) external onlyOwner {
        if (launched) revert TradingLocked();
        if (address(ledger).code.length == 0 || ledger.fuelCore() != address(this)) {
            revert InvalidConfiguration(address(ledger));
        }
        rewardLedger = ledger;
        emit RewardLedgerSet(address(ledger));
    }

    function setCanonicalMarketRegistry(ICanonicalMarketRegistry registry_) external onlyOwner {
        if (launched) revert TradingLocked();
        if (
            address(canonicalMarketRegistry) != address(0) || address(registry_).code.length == 0
                || registry_.fuel() != address(this) || !registry_.isSealed()
                || address(registry_.manager()).code.length == 0
                || registry_.hook().code.length == 0 || registry_.router().code.length == 0
        ) {
            revert InvalidConfiguration(address(registry_));
        }
        canonicalMarketRegistry = registry_;
        emit CanonicalMarketRegistrySet(address(registry_));
    }

    function validateCanonicalTrader(address trader) external view {
        ICanonicalMarketRegistry registry = canonicalMarketRegistry;
        address canonicalHook = address(registry) == address(0) ? address(0) : registry.hook();
        if (msg.sender != canonicalHook) revert UnauthorizedCanonicalFeeHook(msg.sender);
        if (!launched) revert TradingLocked();
        _enforceTransferPolicy(trader, trader, trader);
    }

    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit PausedSet(paused_);
    }

    function guardianFreeze(address account) external {
        if (msg.sender != guardian) revert NotGuardian(msg.sender);
        if (account == address(0)) revert InvalidConfiguration(account);
        isFrozen[account] = true;
        emit AccountFrozen(account, true, msg.sender);
    }

    function setFrozen(address account, bool frozen) external onlyRecoveryAuthority {
        if (account == address(0)) revert InvalidConfiguration(account);
        isFrozen[account] = frozen;
        emit AccountFrozen(account, frozen, msg.sender);
    }

    function setBlockedVenueCodehash(bytes32 codehash, bool blocked) external onlyOwner {
        if (launched) revert TradingLocked();
        if (codehash == bytes32(0)) revert InvalidConfiguration(address(0));
        isBlockedVenueCodehash[codehash] = blocked;
        emit VenueCodehashBlocked(codehash, blocked);
    }

    function transfer(address to, uint256 amount) external nonReentrant returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        if (launched) _enforceTransferPolicy(msg.sender, msg.sender, spender);
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount)
        external
        nonReentrant
        returns (bool)
    {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            if (allowed < amount) revert InsufficientAllowance(msg.sender, allowed, amount);
            allowance[from][msg.sender] = allowed - amount;
            emit Approval(from, msg.sender, allowed - amount);
        }
        _transfer(from, to, amount);
        return true;
    }

    function transientCount(address account) external view returns (uint256) {
        return _transientIdentities[account].length;
    }

    function transientIdentityAt(address account, uint256 index) external view returns (uint16) {
        return _transientIdentities[account][index];
    }

    function pendingDiscoveryAt(address account, uint256 index) external view returns (bytes32) {
        return _pendingDiscoveries[account][index];
    }

    function isPendingDiscovery(bytes32 requestId) external view returns (bool) {
        return _pendingDiscovery[requestId].active;
    }

    function isPermanentIdentity(uint16 identityId) external view returns (bool) {
        return identityState[identityId] == IdentityState.Permanent;
    }

    function commit(uint16 identityId) external nonReentrant {
        if (!launched) revert TradingLocked();
        _enforceTransferPolicy(msg.sender, msg.sender, msg.sender);
        IdentityState state = identityState[identityId];
        if (state != IdentityState.Transient || identityOwner[identityId] != msg.sender) {
            revert InvalidCommitment(identityId, msg.sender, state);
        }

        uint256 accountBalance = balanceOf[msg.sender];
        if (accountBalance < 1 ether) revert BackingInvariantBroken(msg.sender);
        IRewardLedgerCallbacks configuredLedger = rewardLedger;
        if (address(configuredLedger) == address(0)) revert RewardLedgerNotConfigured();

        _removeTransientIdentity(msg.sender, identityId);
        --totalTransientCount;
        balanceOf[msg.sender] = accountBalance - 1 ether;
        totalSupply -= 1 ether;
        emit Transfer(msg.sender, address(0), 1 ether);

        identityState[identityId] = IdentityState.Permanent;
        ++permanentCount;
        mirror.clearApproval(msg.sender, identityId);
        configuredLedger.activate(identityId);
        emit Committed(msg.sender, identityId);
    }

    function validateMirrorApproval(address identityOwner_, address caller, address operator)
        external
        view
    {
        if (msg.sender != address(mirror)) revert UnauthorizedMirror(msg.sender);
        _enforceTransferPolicy(caller, identityOwner_, identityOwner_);
        _enforceTransferPolicy(operator, identityOwner_, identityOwner_);
    }

    function recoverLiquid(address from, address to, uint256 amount)
        external
        onlyRecoveryAuthority
        nonReentrant
    {
        _validateRecoveryEndpoints(from, to);
        _moveLiquid(msg.sender, from, to, amount, false);
        emit LiquidRecovered(from, to, amount);
    }

    function recoverCollectible(address from, address to, uint16 identityId)
        external
        onlyRecoveryAuthority
        nonReentrant
    {
        if (!launched) revert TradingLocked();
        _validateRecoveryEndpoints(from, to);
        address currentOwner = identityOwner[identityId];
        if (currentOwner != from) revert NotIdentityOwner(identityId, from, currentOwner);
        IdentityState state = identityState[identityId];
        if (state == IdentityState.Transient) {
            _moveTransientIdentity(from, to, identityId);
        } else if (state == IdentityState.Permanent) {
            _movePermanentIdentity(from, to, identityId);
        } else {
            revert NotIdentityOwner(identityId, from, currentOwner);
        }
        emit CollectibleRecovered(from, to, identityId);
    }

    function fulfillDiscovery(bytes32 requestId, bytes32 entropy)
        external
        nonReentrant
        returns (bool)
    {
        if (msg.sender != address(discoveryAdapter)) {
            revert UnauthorizedDiscoveryAdapter(msg.sender);
        }
        PendingDiscovery storage pending = _pendingDiscovery[requestId];
        if (!pending.active) {
            emit LateDiscoveryIgnored(requestId);
            return false;
        }

        address recipient = pending.recipient;
        pending.active = false;
        _removePendingDiscovery(recipient, requestId);
        --pendingDiscoveryCount[recipient];
        --totalPendingDiscoveryCount;

        uint16 identityId = _drawAvailableIdentity(entropy);
        _replaceRequestBackingWithIdentity(recipient, requestId, identityId);

        _materializeIdentity(recipient, identityId);
        emit DiscoveryFulfilled(recipient, requestId, identityId);
        return true;
    }

    function mirrorTransfer(address operator, address from, address to, uint16 identityId)
        external
        onlyMirror
        nonReentrant
    {
        if (!launched) revert TradingLocked();
        if (to == address(0)) revert InvalidRecipient();
        _enforceTransferPolicy(operator, from, to);

        address currentOwner = identityOwner[identityId];
        if (currentOwner != from) revert NotIdentityOwner(identityId, from, currentOwner);
        IdentityState state = identityState[identityId];
        if (state == IdentityState.Permanent) {
            _movePermanentIdentity(from, to, identityId);
            return;
        }
        if (from == to) {
            mirror.syncTransfer(from, to, identityId);
            return;
        }
        if (state != IdentityState.Transient) {
            revert NotIdentityOwner(identityId, from, currentOwner);
        }
        _moveTransientIdentity(from, to, identityId);
    }

    function _transfer(address from, address to, uint256 amount) private {
        _moveLiquid(msg.sender, from, to, amount, true);
    }

    function _moveLiquid(
        address operator,
        address from,
        address to,
        uint256 amount,
        bool enforcePolicy
    ) private {
        if (to == address(0)) revert InvalidRecipient();
        if (!launched) {
            if (enforcePolicy && (!isDiscoveryExempt[from] || !isDiscoveryExempt[to])) {
                revert TradingLocked();
            }
        } else if (enforcePolicy) {
            _enforceTransferPolicy(operator, from, to);
        }

        uint256 fromBalance = balanceOf[from];
        if (fromBalance < amount) revert InsufficientBalance(from, fromBalance, amount);
        if (from == to) {
            emit Transfer(from, to, amount);
            return;
        }

        uint256 fromWholeUnitsBefore = fromBalance / 1 ether;
        uint256 toBalance = balanceOf[to];
        uint256 toWholeUnitsBefore = toBalance / 1 ether;
        uint256 fromBalanceAfter = fromBalance - amount;
        uint256 toBalanceAfter = toBalance + amount;
        uint256 lostWholeUnits =
            isDiscoveryExempt[from] ? 0 : fromWholeUnitsBefore - fromBalanceAfter / 1 ether;
        uint256 gainedWholeUnits =
            isDiscoveryExempt[to] ? 0 : toBalanceAfter / 1 ether - toWholeUnitsBefore;
        uint256 discoveryMutations = lostWholeUnits + gainedWholeUnits;
        if (discoveryMutations > MAX_DISCOVERY_MUTATIONS_PER_TRANSFER) {
            revert DiscoveryMutationLimitExceeded(
                discoveryMutations, MAX_DISCOVERY_MUTATIONS_PER_TRANSFER
            );
        }

        balanceOf[from] = fromBalanceAfter;
        balanceOf[to] = toBalanceAfter;
        emit Transfer(from, to, amount);

        for (uint256 index = 0; index < lostWholeUnits; ++index) {
            _dissolveLatest(from);
        }
        if (gainedWholeUnits != 0) _discover(to, gainedWholeUnits);
    }

    function _moveTransientIdentity(address from, address to, uint16 identityId) private {
        if (isDiscoveryExempt[to]) revert ExemptRecipient(to);
        if (from == to) {
            mirror.syncTransfer(from, to, identityId);
            return;
        }

        uint256 fromBalance = balanceOf[from];
        if (fromBalance < 1 ether) revert BackingInvariantBroken(from);
        balanceOf[from] = fromBalance - 1 ether;
        balanceOf[to] += 1 ether;
        emit Transfer(from, to, 1 ether);

        _removeTransientIdentity(from, identityId);
        _appendTransientIdentity(to, identityId);
        _appendIdentityBackingSlot(to, identityId);
        identityOwner[identityId] = to;
        --collectibleBalanceOf[from];
        ++collectibleBalanceOf[to];
        mirror.syncTransfer(from, to, identityId);
    }

    function _movePermanentIdentity(address from, address to, uint16 identityId) private {
        IRewardLedgerCallbacks configuredLedger = rewardLedger;
        if (address(configuredLedger) != address(0)) {
            configuredLedger.checkpointBeforeTransfer(identityId);
        }
        if (from != to) {
            identityOwner[identityId] = to;
            --collectibleBalanceOf[from];
            ++collectibleBalanceOf[to];
        }
        mirror.syncTransfer(from, to, identityId);
        if (address(configuredLedger) != address(0)) {
            configuredLedger.checkpointAfterTransfer(identityId);
        }
    }

    function _validateRecoveryEndpoints(address from, address to) private view {
        if (!launched) revert TradingLocked();
        if (from == address(0) || to == address(0)) revert InvalidRecipient();
        if (isProtectedAccount[from]) revert ProtectedRecoveryEndpoint(from);
        if (isProtectedAccount[to]) revert ProtectedRecoveryEndpoint(to);
        if (isFrozen[to]) revert FrozenAccount(to);
    }

    function _enforceTransferPolicy(address operator, address from, address to) private view {
        if (paused) revert Paused();
        if (isFrozen[from]) revert FrozenAccount(from);
        if (isFrozen[to]) revert FrozenAccount(to);
        if (operator != address(0) && isFrozen[operator]) revert FrozenAccount(operator);
        _rejectBlockedVenue(operator);
        _rejectBlockedVenue(from);
        _rejectBlockedVenue(to);
        ICanonicalMarketRegistry registry = canonicalMarketRegistry;
        if (address(registry) != address(0)) {
            address poolManager = address(registry.manager());
            if (operator == poolManager || from == poolManager || to == poolManager) {
                if (!registry.isAuthorizedFuelSettlement(operator, from, to)) {
                    revert UnauthorizedPoolManagerSettlement(operator, from, to);
                }
            }
        }
    }

    function _rejectBlockedVenue(address account) private view {
        if (account == address(0) || account.code.length == 0) return;
        bytes32 codehash = account.codehash;
        if (isBlockedVenueCodehash[codehash]) revert BlockedVenue(account, codehash);
    }

    function _discover(address recipient, uint256 count) private {
        uint256 firstNonce = discoveryNonce;
        discoveryNonce = firstNonce + count;
        IDiscoveryAdapter.DiscoveryResponse memory response =
            discoveryAdapter.requestDiscovery(recipient, firstNonce, count);
        if (!response.immediate) {
            if (response.requestIds.length != count || response.entropies.length != 0) {
                revert InvalidDiscoveryRequest(bytes32(0));
            }
            for (uint256 index; index < count; ++index) {
                bytes32 requestId = response.requestIds[index];
                if (requestId == bytes32(0) || _pendingDiscovery[requestId].used) {
                    revert InvalidDiscoveryRequest(requestId);
                }
                _pendingDiscovery[requestId] =
                    PendingDiscovery({recipient: recipient, active: true, used: true});
                _appendPendingDiscovery(recipient, requestId);
                _appendRequestBackingSlot(recipient, requestId);
                ++pendingDiscoveryCount[recipient];
                ++totalPendingDiscoveryCount;
                emit DiscoveryRequested(recipient, requestId);
            }
            return;
        }

        if (response.entropies.length != count || response.requestIds.length != 0) {
            revert InvalidDiscoveryRequest(bytes32(0));
        }
        for (uint256 index; index < count; ++index) {
            uint16 identityId = _drawAvailableIdentity(response.entropies[index]);
            _appendIdentityBackingSlot(recipient, identityId);
            _materializeIdentity(recipient, identityId);
        }
    }

    function _materializeIdentity(address recipient, uint16 identityId) private {
        identityState[identityId] = IdentityState.Transient;
        identityOwner[identityId] = recipient;
        _appendTransientIdentity(recipient, identityId);
        ++totalTransientCount;
        ++collectibleBalanceOf[recipient];
        mirror.syncTransfer(address(0), recipient, identityId);
    }

    function _drawAvailableIdentity(bytes32 entropy) private returns (uint16 identityId) {
        uint16 count = availableIdentityCount;
        if (count == 0) revert NoAvailableIdentity();

        uint16 selectedIndex = uint16(uint256(entropy) % count);
        identityId = _availablePool[selectedIndex];
        if (identityId == 0) identityId = selectedIndex + 1;

        uint16 lastIndex = count - 1;
        uint16 lastIdentityId = _availablePool[lastIndex];
        if (lastIdentityId == 0) lastIdentityId = lastIndex + 1;
        if (selectedIndex != lastIndex) {
            _availablePool[selectedIndex] = lastIdentityId;
        }
        delete _availablePool[lastIndex];
        availableIdentityCount = lastIndex;
    }

    function _dissolveLatest(address account) private {
        bytes32 requestId = _latestPendingDiscovery[account];
        if (requestId != bytes32(0)) {
            PendingDiscovery storage pending = _pendingDiscovery[requestId];
            if (!pending.active || pending.recipient != account) {
                revert BackingInvariantBroken(account);
            }
            pending.active = false;
            _removePendingDiscovery(account, requestId);
            _removePendingBackingSlot(account, requestId);
            --pendingDiscoveryCount[account];
            --totalPendingDiscoveryCount;
            emit DiscoveryCancelled(account, requestId);
            return;
        }

        uint16 identityId = _latestTransientIdentity[account];
        if (identityId == 0) revert BackingInvariantBroken(account);
        _removeTransientIdentity(account, identityId);
        identityState[identityId] = IdentityState.Available;
        delete identityOwner[identityId];
        --totalTransientCount;
        --collectibleBalanceOf[account];

        _availablePool[availableIdentityCount] = identityId;
        ++availableIdentityCount;
        mirror.syncTransfer(account, address(0), identityId);
    }

    function _removePendingBackingSlot(address account, bytes32 requestId) private {
        uint256 indexPlusOne = _requestBackingSlotIndexPlusOne[account][requestId];
        if (indexPlusOne == 0) revert BackingInvariantBroken(account);
        _removeBackingSlotAt(account, indexPlusOne - 1);
    }

    function _removeTransientIdentity(address account, uint16 identityId) private {
        _removeTransientIdentityFromList(account, identityId);
        uint256 indexPlusOne = _identityBackingSlotIndexPlusOne[account][identityId];
        if (indexPlusOne == 0) revert BackingInvariantBroken(account);
        _removeBackingSlotAt(account, indexPlusOne - 1);
    }

    function _removeTransientIdentityFromList(address account, uint16 identityId) private {
        uint16[] storage identities = _transientIdentities[account];
        uint256 indexPlusOne = _transientIdentityIndexPlusOne[account][identityId];
        if (indexPlusOne == 0) revert BackingInvariantBroken(account);
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = identities.length - 1;
        if (index != lastIndex) {
            uint16 movedIdentityId = identities[lastIndex];
            identities[index] = movedIdentityId;
            _transientIdentityIndexPlusOne[account][movedIdentityId] = indexPlusOne;
        }
        identities.pop();
        delete _transientIdentityIndexPlusOne[account][identityId];

        uint16 previousIdentityId = _previousTransientIdentity[account][identityId];
        uint16 nextIdentityId = _nextTransientIdentity[account][identityId];
        if (previousIdentityId != 0) {
            _nextTransientIdentity[account][previousIdentityId] = nextIdentityId;
        }
        if (nextIdentityId != 0) {
            _previousTransientIdentity[account][nextIdentityId] = previousIdentityId;
        } else {
            _latestTransientIdentity[account] = previousIdentityId;
        }
        delete _previousTransientIdentity[account][identityId];
        delete _nextTransientIdentity[account][identityId];
    }

    function _removePendingDiscovery(address account, bytes32 requestId) private {
        bytes32[] storage requests = _pendingDiscoveries[account];
        uint256 indexPlusOne = _pendingDiscoveryIndexPlusOne[account][requestId];
        if (indexPlusOne == 0) revert BackingInvariantBroken(account);
        uint256 index = indexPlusOne - 1;
        uint256 lastIndex = requests.length - 1;
        if (index != lastIndex) {
            bytes32 movedRequestId = requests[lastIndex];
            requests[index] = movedRequestId;
            _pendingDiscoveryIndexPlusOne[account][movedRequestId] = indexPlusOne;
        }
        requests.pop();
        delete _pendingDiscoveryIndexPlusOne[account][requestId];

        bytes32 previousRequestId = _previousPendingDiscovery[account][requestId];
        bytes32 nextRequestId = _nextPendingDiscovery[account][requestId];
        if (previousRequestId != bytes32(0)) {
            _nextPendingDiscovery[account][previousRequestId] = nextRequestId;
        }
        if (nextRequestId != bytes32(0)) {
            _previousPendingDiscovery[account][nextRequestId] = previousRequestId;
        } else {
            _latestPendingDiscovery[account] = previousRequestId;
        }
        delete _previousPendingDiscovery[account][requestId];
        delete _nextPendingDiscovery[account][requestId];
    }

    function _appendTransientIdentity(address account, uint16 identityId) private {
        uint16[] storage identities = _transientIdentities[account];
        identities.push(identityId);
        _transientIdentityIndexPlusOne[account][identityId] = identities.length;

        uint16 previousIdentityId = _latestTransientIdentity[account];
        if (previousIdentityId != 0) {
            _nextTransientIdentity[account][previousIdentityId] = identityId;
            _previousTransientIdentity[account][identityId] = previousIdentityId;
        }
        _latestTransientIdentity[account] = identityId;
    }

    function _appendPendingDiscovery(address account, bytes32 requestId) private {
        bytes32[] storage requests = _pendingDiscoveries[account];
        requests.push(requestId);
        _pendingDiscoveryIndexPlusOne[account][requestId] = requests.length;

        bytes32 previousRequestId = _latestPendingDiscovery[account];
        if (previousRequestId != bytes32(0)) {
            _nextPendingDiscovery[account][previousRequestId] = requestId;
            _previousPendingDiscovery[account][requestId] = previousRequestId;
        }
        _latestPendingDiscovery[account] = requestId;
    }

    function _appendIdentityBackingSlot(address account, uint16 identityId) private {
        BackingSlot[] storage slots = _backingSlots[account];
        slots.push(BackingSlot({identityId: identityId, requestId: bytes32(0)}));
        _identityBackingSlotIndexPlusOne[account][identityId] = slots.length;
    }

    function _appendRequestBackingSlot(address account, bytes32 requestId) private {
        BackingSlot[] storage slots = _backingSlots[account];
        slots.push(BackingSlot({identityId: 0, requestId: requestId}));
        _requestBackingSlotIndexPlusOne[account][requestId] = slots.length;
    }

    function _replaceRequestBackingWithIdentity(
        address account,
        bytes32 requestId,
        uint16 identityId
    ) private {
        uint256 indexPlusOne = _requestBackingSlotIndexPlusOne[account][requestId];
        if (indexPlusOne == 0) revert BackingInvariantBroken(account);
        _backingSlots[account][indexPlusOne - 1] =
            BackingSlot({identityId: identityId, requestId: bytes32(0)});
        delete _requestBackingSlotIndexPlusOne[account][requestId];
        _identityBackingSlotIndexPlusOne[account][identityId] = indexPlusOne;
    }

    function _removeBackingSlotAt(address account, uint256 index) private {
        BackingSlot[] storage slots = _backingSlots[account];
        uint256 lastIndex = slots.length - 1;
        BackingSlot memory removedSlot = slots[index];
        if (index != lastIndex) {
            BackingSlot memory movedSlot = slots[lastIndex];
            slots[index] = movedSlot;
            if (movedSlot.identityId != 0) {
                _identityBackingSlotIndexPlusOne[account][movedSlot.identityId] = index + 1;
            } else {
                _requestBackingSlotIndexPlusOne[account][movedSlot.requestId] = index + 1;
            }
        }
        slots.pop();
        if (removedSlot.identityId != 0) {
            delete _identityBackingSlotIndexPlusOne[account][removedSlot.identityId];
        } else {
            delete _requestBackingSlotIndexPlusOne[account][removedSlot.requestId];
        }
    }
}
