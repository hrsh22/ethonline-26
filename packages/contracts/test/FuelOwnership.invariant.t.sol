// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {DeferredTestDiscoveryAdapter} from "../src/discovery/DeferredTestDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";
import {RewardLedgerCallbackHarness} from "./helpers/RewardLedgerCallbackHarness.sol";

contract InvariantRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }

    function setFrozen(FuelCore core, address account, bool frozen) external {
        core.setFrozen(account, frozen);
    }

    function recoverLiquid(FuelCore core, address from, address to, uint256 amount) external {
        core.recoverLiquid(from, to, amount);
    }

    function recoverCollectible(FuelCore core, address from, address to, uint16 identityId)
        external
    {
        core.recoverCollectible(from, to, identityId);
    }
}

contract InvariantGuardianHarness {
    function freeze(FuelCore core, address account) external {
        core.guardianFreeze(account);
    }
}

contract InvariantFuelActor {
    function transferLiquid(FuelCore core, address to, uint256 amount) external {
        require(core.transfer(to, amount), "liquid transfer failed");
    }

    function commitIdentity(FuelCore core, uint16 identityId) external {
        core.commit(identityId);
    }

    function approveCollectible(FuelMirror mirror, address operator, uint16 identityId) external {
        mirror.approve(operator, identityId);
    }

    function transferCollectible(FuelMirror mirror, address to, uint16 identityId) external {
        mirror.transferFrom(address(this), to, identityId);
    }
}

contract OwnershipInvariantHandler {
    /// @dev Ownership is two-step, so the fixture only becomes owner once it
    ///      accepts for itself. `fail_on_revert = false`, so the fuzzer
    ///      re-calling this after acceptance is harmless.
    function acceptOwnership() external {
        FuelCore(_core).acceptOwnership();
    }

    FuelCore private immutable _core;
    FuelMirror private immutable _mirror;
    DeferredTestDiscoveryAdapter private immutable _adapter;
    InvariantRecoveryHarness private immutable _recovery;
    InvariantGuardianHarness private immutable _guardian;
    address[5] private _actors;
    mapping(uint16 identityId => bool permanent) private _wasPermanent;

    constructor(
        FuelCore core_,
        FuelMirror mirror_,
        DeferredTestDiscoveryAdapter adapter_,
        InvariantRecoveryHarness recovery_,
        InvariantGuardianHarness guardian_,
        address[5] memory actors_
    ) {
        _core = core_;
        _mirror = mirror_;
        _adapter = adapter_;
        _recovery = recovery_;
        _guardian = guardian_;
        _actors = actors_;
    }

    function wasPermanent(uint16 identityId) external view returns (bool) {
        return _wasPermanent[identityId];
    }

    function launch() external {
        try _core.launch() {} catch {}
    }

    function configureExemption(uint256 actorSeed, bool exempt) external {
        address account = _actors[actorSeed % _actors.length];
        try _core.setDiscoveryExempt(account, exempt) {} catch {}
    }

    function configureProtection(uint256 actorSeed, bool protected_) external {
        address account = _actors[actorSeed % _actors.length];
        try _core.setProtectedAccount(account, protected_) {} catch {}
    }

    function setPaused(bool paused) external {
        try _core.setPaused(paused) {} catch {}
    }

    function guardianFreeze(uint256 actorSeed) external {
        address account = _actors[actorSeed % _actors.length];
        try _guardian.freeze(_core, account) {} catch {}
    }

    function recoveryFreeze(uint256 actorSeed, bool frozen) external {
        address account = _actors[actorSeed % _actors.length];
        try _recovery.setFrozen(_core, account, frozen) {} catch {}
    }

    function moveLiquid(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        InvariantFuelActor from = InvariantFuelActor(_actors[fromSeed % _actors.length]);
        address to = _actors[toSeed % _actors.length];
        uint256 balance = _core.balanceOf(address(from));
        uint256 maximumAmount = balance < 5 ether ? balance : 5 ether;
        uint256 amount = amountSeed % (maximumAmount + 1);
        try from.transferLiquid(_core, to, amount) {} catch {}
    }

    function fulfill(uint256 actorSeed, uint256 requestSeed, bytes32 entropy) external {
        address account = _actors[1 + actorSeed % (_actors.length - 1)];
        uint256 count = _core.pendingDiscoveryCount(account);
        if (count == 0) return;
        bytes32 requestId = _core.pendingDiscoveryAt(account, requestSeed % count);
        try _adapter.fulfill(requestId, entropy) {} catch {}
    }

    function commit(uint256 actorSeed, uint256 identitySeed) external {
        InvariantFuelActor actor = InvariantFuelActor(_actors[1 + actorSeed % (_actors.length - 1)]);
        uint256 count = _core.transientCount(address(actor));
        if (count == 0) return;
        uint16 identityId = _core.transientIdentityAt(address(actor), identitySeed % count);
        try actor.commitIdentity(_core, identityId) {
            _wasPermanent[identityId] = true;
        } catch {}
    }

    function approveCollectible(uint256 identitySeed, uint256 operatorSeed) external {
        // The modulo bounds the value to the collection's 1..4,444 uint16 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 identityId = uint16(1 + identitySeed % 4_444);
        address identityOwner = _core.identityOwner(identityId);
        if (identityOwner == address(0)) return;
        address operator = _actors[operatorSeed % _actors.length];
        try InvariantFuelActor(identityOwner).approveCollectible(_mirror, operator, identityId) {}
            catch {}
    }

    function moveCollectible(uint256 identitySeed, uint256 recipientSeed) external {
        // The modulo bounds the value to the collection's 1..4,444 uint16 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 identityId = uint16(1 + identitySeed % 4_444);
        address identityOwner = _core.identityOwner(identityId);
        if (identityOwner == address(0)) return;
        address recipient = _actors[recipientSeed % _actors.length];
        try InvariantFuelActor(identityOwner).transferCollectible(_mirror, recipient, identityId) {}
            catch {}
    }

    function recoverLiquid(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        address from = _actors[fromSeed % _actors.length];
        address to = _actors[toSeed % _actors.length];
        uint256 balance = _core.balanceOf(from);
        uint256 maximumAmount = balance < 3 ether ? balance : 3 ether;
        uint256 amount = amountSeed % (maximumAmount + 1);
        try _recovery.recoverLiquid(_core, from, to, amount) {} catch {}
    }

    function recoverCollectible(uint256 identitySeed, uint256 recipientSeed) external {
        // The modulo bounds the value to the collection's 1..4,444 uint16 range.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint16 identityId = uint16(1 + identitySeed % 4_444);
        address from = _core.identityOwner(identityId);
        if (from == address(0)) return;
        address to = _actors[recipientSeed % _actors.length];
        try _recovery.recoverCollectible(_core, from, to, identityId) {} catch {}
    }
}

contract FuelOwnershipInvariantTest {
    bool public constant IS_TEST = true;

    FuelCore private _core;
    FuelMirror private _mirror;
    OwnershipInvariantHandler private _handler;
    address[5] private _actors;

    function setUp() external {
        for (uint256 index = 0; index < _actors.length; ++index) {
            _actors[index] = address(new InvariantFuelActor());
        }
        DeferredTestDiscoveryAdapter adapter = new DeferredTestDiscoveryAdapter();
        InvariantRecoveryHarness recovery = new InvariantRecoveryHarness();
        InvariantGuardianHarness guardian = new InvariantGuardianHarness();
        _core = new FuelCore(
            "Invariant Liquid Token",
            "INV",
            "Invariant Collectible",
            "INVC",
            _actors[0],
            adapter,
            address(guardian),
            recovery
        );
        _core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(_core)));
        _core.setRewardLedger(
            IRewardLedgerCallbacks(address(new RewardLedgerCallbackHarness(address(_core))))
        );
        _mirror = _core.mirror();
        _handler =
            new OwnershipInvariantHandler(_core, _mirror, adapter, recovery, guardian, _actors);
        _core.transferOwnership(address(_handler));
        _handler.acceptOwnership();
    }

    function targetContracts() external view returns (address[] memory targets) {
        targets = new address[](1);
        targets[0] = address(_handler);
    }

    function invariantLiquidBackingMatchesTransientPlusPending() external view {
        uint256 summedBalances;
        uint256 summedTransient;
        uint256 summedPending;
        for (uint256 index = 0; index < _actors.length; ++index) {
            address account = _actors[index];
            uint256 transient = _core.transientCount(account);
            uint256 pending = _core.pendingDiscoveryCount(account);
            summedBalances += _core.balanceOf(account);
            summedTransient += transient;
            summedPending += pending;
            if (!_core.isDiscoveryExempt(account)) {
                require(
                    transient + pending == _core.balanceOf(account) / 1 ether,
                    "wallet backing invariant broken"
                );
            }
        }
        require(summedBalances == _core.totalSupply(), "liquid balances do not sum to supply");
        require(summedTransient == _core.totalTransientCount(), "transient total drifted");
        require(summedPending == _core.totalPendingDiscoveryCount(), "pending total drifted");
    }

    function invariantEveryIdentityHasExactlyOneState() external view {
        uint256 available;
        uint256 transient;
        uint256 permanent;
        uint256[5] memory collectibleBalances;

        for (uint16 identityId = 1; identityId <= 4_444; ++identityId) {
            FuelCore.IdentityState state = _core.identityState(identityId);
            address identityOwner = _core.identityOwner(identityId);
            if (_handler.wasPermanent(identityId)) {
                require(state == FuelCore.IdentityState.Permanent, "permanent identity regressed");
            }
            if (state == FuelCore.IdentityState.Available) {
                require(identityOwner == address(0), "available identity has owner");
                ++available;
                continue;
            }

            require(identityOwner != address(0), "owned identity has no owner");
            bool knownOwner;
            for (uint256 index = 0; index < _actors.length; ++index) {
                if (_actors[index] == identityOwner) {
                    ++collectibleBalances[index];
                    knownOwner = true;
                    break;
                }
            }
            require(knownOwner, "identity escaped modeled accounts");
            if (state == FuelCore.IdentityState.Transient) {
                ++transient;
            } else {
                require(state == FuelCore.IdentityState.Permanent, "invalid identity state");
                ++permanent;
            }
        }

        require(available == _core.availableIdentityCount(), "available total drifted");
        require(transient == _core.totalTransientCount(), "transient partition drifted");
        require(permanent == _core.permanentCount(), "permanent total drifted");
        require(available + transient + permanent == 4_444, "identity partition broken");
        for (uint256 index = 0; index < _actors.length; ++index) {
            require(
                collectibleBalances[index] == _mirror.balanceOf(_actors[index]),
                "mirror balance drifted"
            );
        }
    }

    function invariantLiquidSupplyPlusPermanentBackingEqualsCap() external view {
        require(
            _core.totalSupply() + uint256(_core.permanentCount()) * 1 ether
                == _core.MAX_LIQUID_SUPPLY(),
            "supply plus Commitment invariant broken"
        );
    }
}
