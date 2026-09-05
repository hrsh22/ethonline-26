// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IPoolManager} from "v4-core/interfaces/IPoolManager.sol";
import {StateLibrary} from "v4-core/libraries/StateLibrary.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

import {AttributeRegistry} from "../src/AttributeRegistry.sol";
import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror} from "../src/FuelMirror.sol";
import {RewardLedger} from "../src/RewardLedger.sol";
import {EpochConverter} from "../src/conversion/EpochConverter.sol";
import {DeferredTestDiscoveryAdapter} from "../src/discovery/DeferredTestDiscoveryAdapter.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {ProtocolLiquidityVault} from "../src/liquidity/ProtocolLiquidityVault.sol";
import {CanonicalFeeHook} from "../src/market/CanonicalFeeHook.sol";
import {CanonicalRouter} from "../src/market/CanonicalRouter.sol";
import {MockWETH} from "../src/test-assets/MockWETH.sol";
import {
    ProtocolSystemActor,
    ProtocolSystemGuardian,
    ProtocolSystemRecoveryAuthority,
    ProtocolSystemTestBase
} from "./helpers/ProtocolSystemTestBase.sol";
import {TickSpacingTestHelper} from "./helpers/TickSpacingTestHelper.sol";

interface ProtocolInvariantVm {
    function warp(uint256 timestamp) external;
}

contract ProtocolSystemInvariantHandler {
    using StateLibrary for IPoolManager;

    ProtocolInvariantVm private constant _VM =
        ProtocolInvariantVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    FuelCore private immutable _fuel;
    FuelMirror private immutable _mirror;
    DeferredTestDiscoveryAdapter private immutable _discovery;
    ProtocolSystemRecoveryAuthority private immutable _recovery;
    ProtocolSystemGuardian private immutable _guardian;
    CanonicalRouter private immutable _router;
    MockWETH private immutable _weth;
    EpochConverter private immutable _converter;
    RewardLedger private immutable _ledger;
    ProtocolLiquidityVault private immutable _protocolLiquidityVault;
    CanonicalFeeHook private immutable _feeHook;
    IPoolManager private immutable _manager;
    PoolKey private _marketKey;
    ProtocolSystemActor[4] private _actors;
    uint16[] private _permanentIdentities;
    mapping(uint16 identityId => bool permanent) private _wasPermanent;

    bool public approvalViolation;
    bool public commitmentViolation;
    bool public pendingRewardTransferViolation;
    bool public trackIsolationViolation;

    constructor(FuelCore fuel_, ProtocolSystemActor[4] memory actors_) {
        _fuel = fuel_;
        _mirror = fuel_.mirror();
        _discovery = DeferredTestDiscoveryAdapter(address(fuel_.discoveryAdapter()));
        _recovery = ProtocolSystemRecoveryAuthority(address(fuel_.recoveryAuthority()));
        _guardian = ProtocolSystemGuardian(fuel_.guardian());
        ICanonicalMarketRegistry marketRegistry = fuel_.canonicalMarketRegistry();
        _router = CanonicalRouter(payable(marketRegistry.router()));
        _manager = marketRegistry.manager();
        _marketKey = marketRegistry.poolKey();
        _feeHook = CanonicalFeeHook(marketRegistry.hook());
        _converter = EpochConverter(_feeHook.rewardDestination());
        _weth = MockWETH(payable(_converter.weth()));
        _ledger = RewardLedger(_converter.rewardLedger());
        _protocolLiquidityVault = ProtocolLiquidityVault(_feeHook.liquidityDestination());
        _actors = actors_;
    }

    function actorAt(uint256 index) external view returns (address) {
        return address(_actors[index]);
    }

    function wasPermanent(uint16 identityId) external view returns (bool) {
        return _wasPermanent[identityId];
    }

    function buy(uint256 actorSeed, uint256 amountSeed) external {
        ProtocolSystemActor actor = _actor(actorSeed);
        uint256 balance = _weth.balanceOf(address(actor));
        uint256 maximum = balance < 0.2 ether ? balance : 0.2 ether;
        if (maximum == 0) return;
        uint256 amount = 1 + amountSeed % maximum;
        try actor.buy(_router, amount) {} catch {}
    }

    function sell(uint256 actorSeed, uint256 amountSeed) external {
        ProtocolSystemActor actor = _actor(actorSeed);
        uint256 balance = _fuel.balanceOf(address(actor));
        uint256 maximum = balance < 2 ether ? balance : 2 ether;
        if (maximum == 0) return;
        uint256 amount = 1 + amountSeed % maximum;
        try actor.sell(_router, amount) {} catch {}
    }

    function transferLiquid(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        ProtocolSystemActor from = _actor(fromSeed);
        address to = address(_actor(toSeed));
        uint256 balance = _fuel.balanceOf(address(from));
        uint256 maximum = balance < 2 ether ? balance : 2 ether;
        if (maximum == 0) return;
        uint256 amount = amountSeed % (maximum + 1);
        try from.transferLiquid(_fuel, to, amount) {} catch {}
    }

    function fulfillDiscovery(uint256 actorSeed, uint256 requestSeed, bytes32 entropy) external {
        address actor = address(_actor(actorSeed));
        uint256 count = _fuel.pendingDiscoveryCount(actor);
        if (count == 0) return;
        bytes32 requestId = _fuel.pendingDiscoveryAt(actor, requestSeed % count);
        try _discovery.fulfill(requestId, entropy) {} catch {}
    }

    function cancelDiscovery(uint256 fromSeed, uint256 toSeed) external {
        ProtocolSystemActor from = _actor(fromSeed);
        if (
            _fuel.pendingDiscoveryCount(address(from)) == 0
                || _fuel.balanceOf(address(from)) < 1 ether
        ) return;
        try from.transferLiquid(_fuel, address(_actor(toSeed)), 1 ether) {} catch {}
    }

    function commit(uint256 actorSeed, uint256 identitySeed, uint256 operatorSeed) external {
        ProtocolSystemActor actor = _actor(actorSeed);
        uint256 count = _fuel.transientCount(address(actor));
        if (count == 0) return;
        uint16 identityId = _fuel.transientIdentityAt(address(actor), identitySeed % count);
        ProtocolSystemActor operator = _actor(operatorSeed);
        try actor.approveCollectible(_mirror, address(operator), identityId) {} catch {}

        uint256 supplyBefore = _fuel.totalSupply();
        uint16 permanentBefore = _fuel.permanentCount();
        try actor.commit(_fuel, identityId) {
            if (
                _fuel.totalSupply() + 1 ether != supplyBefore
                    || _fuel.permanentCount() != permanentBefore + 1
                    || _mirror.getApproved(identityId) != address(0)
            ) commitmentViolation = true;
            if (!_wasPermanent[identityId]) {
                _wasPermanent[identityId] = true;
                _permanentIdentities.push(identityId);
            }
        } catch {}
    }

    function transferCollectible(uint256 identitySeed, uint256 recipientSeed, uint256 operatorSeed)
        external
    {
        uint16 identityId = _ownedIdentity(identitySeed);
        if (identityId == 0) return;
        address owner = _fuel.identityOwner(identityId);
        ProtocolSystemActor ownerActor = ProtocolSystemActor(payable(owner));
        ProtocolSystemActor operator = _actor(operatorSeed);
        address recipient = address(_actor(recipientSeed));
        uint256[4] memory pendingBefore = _ledger.pendingAll(identityId);

        try ownerActor.approveCollectible(_mirror, address(operator), identityId) {}
        catch {
            return;
        }
        try operator.transferCollectibleFrom(_mirror, owner, recipient, identityId) {
            if (_mirror.getApproved(identityId) != address(0)) approvalViolation = true;
            uint256[4] memory pendingAfter = _ledger.pendingAll(identityId);
            if (keccak256(abi.encode(pendingBefore)) != keccak256(abi.encode(pendingAfter))) {
                pendingRewardTransferViolation = true;
            }
        } catch {}
    }

    function setPaused(bool paused) external {
        try _fuel.setPaused(paused) {} catch {}
    }

    function guardianFreeze(uint256 actorSeed) external {
        try _guardian.freeze(_fuel, address(_actor(actorSeed))) {} catch {}
    }

    function recoveryFreeze(uint256 actorSeed, bool frozen) external {
        try _recovery.setFrozen(_fuel, address(_actor(actorSeed)), frozen) {} catch {}
    }

    function recoverLiquid(uint256 fromSeed, uint256 toSeed, uint256 amountSeed) external {
        address from = address(_actor(fromSeed));
        address to = address(_actor(toSeed));
        uint256 balance = _fuel.balanceOf(from);
        uint256 maximum = balance < 1 ether ? balance : 1 ether;
        uint256 amount = maximum == 0 ? 0 : amountSeed % (maximum + 1);
        try _recovery.recoverLiquid(_fuel, from, to, amount) {} catch {}
    }

    function recoverCollectible(uint256 identitySeed, uint256 recipientSeed, uint256 operatorSeed)
        external
    {
        uint16 identityId = _ownedIdentity(identitySeed);
        if (identityId == 0) return;
        address from = _fuel.identityOwner(identityId);
        ProtocolSystemActor ownerActor = ProtocolSystemActor(payable(from));
        try ownerActor.approveCollectible(_mirror, address(_actor(operatorSeed)), identityId) {}
            catch {}
        uint256[4] memory pendingBefore = _ledger.pendingAll(identityId);
        try _recovery.recoverCollectible(_fuel, from, address(_actor(recipientSeed)), identityId) {
            if (_mirror.getApproved(identityId) != address(0)) approvalViolation = true;
            uint256[4] memory pendingAfter = _ledger.pendingAll(identityId);
            if (keccak256(abi.encode(pendingBefore)) != keccak256(abi.encode(pendingAfter))) {
                pendingRewardTransferViolation = true;
            }
        } catch {}
    }

    function openRewardEpoch() external {
        try _converter.openRewardEpoch() {} catch {}
    }

    function executeTrack(uint256 trackSeed, uint256 minimumSeed) external {
        AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(1 + trackSeed % 4);
        uint256[4] memory beforeQueues = _trackQueues();
        uint256 minimumOutput = minimumSeed % 3 == 0 ? type(uint128).max : 0;
        try _converter.executeTrack(track, minimumOutput, block.timestamp) {
            uint256[4] memory afterQueues = _trackQueues();
            uint8 selected = uint8(track) - 1;
            for (uint8 index = 0; index < 4; ++index) {
                if (index == selected) {
                    if (afterQueues[index] >= beforeQueues[index]) trackIsolationViolation = true;
                } else if (afterQueues[index] != beforeQueues[index]) {
                    trackIsolationViolation = true;
                }
            }
        } catch {
            if (keccak256(abi.encode(beforeQueues)) != keccak256(abi.encode(_trackQueues()))) {
                trackIsolationViolation = true;
            }
        }
    }

    function claim(uint256 actorSeed, uint256 identitySeed) external {
        ProtocolSystemActor actor = _actor(actorSeed);
        uint16 identityId = _permanentOwnedBy(address(actor), identitySeed);
        if (identityId == 0) return;
        uint16[] memory identityIds = new uint16[](1);
        identityIds[0] = identityId;
        try actor.claim(_ledger, identityIds) {} catch {}
    }

    function addProtocolLiquidity() external {
        uint256 maximumWeth = _protocolLiquidityVault.queuedWeth() + _feeHook.liquidityPot();
        if (maximumWeth == 0) return;
        (, int24 currentTick,,) = _manager.getSlot0(_marketKey.toId());
        int24 tickLower;
        int24 tickUpper;
        if (_protocolLiquidityVault.wethIsCurrency0()) {
            tickLower = TickSpacingTestHelper.ceilToCanonicalSpacing(currentTick);
            tickUpper = tickLower + 600;
        } else {
            tickUpper = TickSpacingTestHelper.floorToCanonicalSpacing(currentTick);
            tickLower = tickUpper - 600;
        }
        try _protocolLiquidityVault.addLiquidityCycle(
            tickLower, tickUpper, 1_000_000_000_000_000, maximumWeth, block.timestamp
        ) {}
            catch {}
    }

    function advanceTime(uint256 secondsSeed) external {
        _VM.warp(block.timestamp + 1 + secondsSeed % 120);
    }

    function _actor(uint256 seed) private view returns (ProtocolSystemActor) {
        return _actors[seed % _actors.length];
    }

    function _ownedIdentity(uint256 seed) private view returns (uint16 identityId) {
        uint256 permanentLength = _permanentIdentities.length;
        for (uint256 offset = 0; offset < permanentLength; ++offset) {
            uint16 candidate = _permanentIdentities[(seed + offset) % permanentLength];
            if (_fuel.identityOwner(candidate) != address(0)) return candidate;
        }
        for (uint256 actorIndex = 0; actorIndex < _actors.length; ++actorIndex) {
            address actor = address(_actors[(seed + actorIndex) % _actors.length]);
            uint256 transientCount = _fuel.transientCount(actor);
            if (transientCount != 0) {
                return _fuel.transientIdentityAt(actor, seed % transientCount);
            }
        }
    }

    function _permanentOwnedBy(address owner, uint256 seed)
        private
        view
        returns (uint16 identityId)
    {
        uint256 length = _permanentIdentities.length;
        for (uint256 offset = 0; offset < length; ++offset) {
            uint16 candidate = _permanentIdentities[(seed + offset) % length];
            if (_fuel.identityOwner(candidate) == owner) return candidate;
        }
    }

    function _trackQueues() private view returns (uint256[4] memory queues) {
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            queues[trackIndex] =
                _converter.trackQueue(AttributeRegistry.RewardTrack(trackIndex + 1));
        }
    }
}

contract ProtocolSystemInvariantTest is ProtocolSystemTestBase {
    ProtocolSystemFixture private _fixture;
    ProtocolSystemInvariantHandler private _handler;
    ProtocolSystemActor[4] private _actors;

    function setUp() external {
        _fixture = _deployProtocolSystem();
        vm.deal(address(this), 400 ether);
        _fixture.weth.deposit{value: 400 ether}();
        for (uint256 index = 0; index < _actors.length; ++index) {
            _actors[index] = new ProtocolSystemActor();
            require(
                _fixture.weth.transfer(address(_actors[index]), 100 ether),
                "actor WETH funding failed"
            );
            _actors[index].approveToken(address(_fixture.weth), address(_fixture.router));
            _actors[index].approveToken(address(_fixture.fuel), address(_fixture.router));
            _fixture.claimGate.setClaimAllowed(address(_actors[index]), true);
        }

        _handler = new ProtocolSystemInvariantHandler(_fixture.fuel, _actors);
        _fixture.converter.setKeeper(address(_handler));
        _fixture.protocolLiquidityVault.setExecutor(address(_handler));
        _fixture.fuel.transferOwnership(address(_handler));
        vm.prank(address(_handler));
        _fixture.fuel.acceptOwnership();
        targetContract(address(_handler));
    }

    function invariantComposedProtocolPreservesRequiredAccountingAndOwnership() external view {
        require(!_handler.approvalViolation(), "ownership path retained token approval");
        require(!_handler.commitmentViolation(), "Commitment did not burn exactly one unit");
        require(
            !_handler.pendingRewardTransferViolation(),
            "Pending Reward changed during identity transfer"
        );
        require(!_handler.trackIsolationViolation(), "track execution contaminated another queue");
        require(
            _fixture.fuel.totalSupply() + uint256(_fixture.fuel.permanentCount()) * 1 ether
                == _fixture.fuel.MAX_LIQUID_SUPPLY(),
            "economic unit invariant broken"
        );

        _assertWalletBacking();
        _assertIdentityPartitionAndAttributes();
        _assertRewardAndFeeConservation();
        require(_fixture.genesisVault.seeded(), "Genesis Liquidity lost seeded state");
        require(
            _fixture.fuel.balanceOf(address(_fixture.protocolLiquidityVault)) == 0,
            "POL acquired Liquid Token"
        );
        require(_fixture.attributes.isSealed(), "attribute registry became mutable");
        require(_fixture.converter.configurationSealed(), "converter routes became mutable");
        require(
            _fixture.protocolLiquidityVault.configurationSealed(), "POL destination became mutable"
        );
    }

    function _assertWalletBacking() private view {
        for (uint256 index = 0; index < _actors.length; ++index) {
            address actor = address(_actors[index]);
            require(!_fixture.fuel.isDiscoveryExempt(actor), "modeled actor became exempt");
            require(
                _fixture.fuel.transientCount(actor) + _fixture.fuel.pendingDiscoveryCount(actor)
                    == _fixture.fuel.balanceOf(actor) / 1 ether,
                "wallet backing invariant broken"
            );
        }
    }

    function _assertIdentityPartitionAndAttributes() private view {
        uint256 available;
        uint256 transient;
        uint256 permanent;
        uint256[4] memory mirrorBalances;
        uint256[4][4] memory tierCounts;
        uint256[4][4] memory tierWeights;

        for (uint16 identityId = 1; identityId <= 4_444; ++identityId) {
            FuelCore.IdentityState state = _fixture.fuel.identityState(identityId);
            address owner = _fixture.fuel.identityOwner(identityId);
            if (_handler.wasPermanent(identityId)) {
                require(state == FuelCore.IdentityState.Permanent, "permanent identity regressed");
            }
            if (state == FuelCore.IdentityState.Available) {
                require(owner == address(0), "available identity has owner");
                ++available;
            } else {
                require(owner != address(0), "owned identity has no owner");
                bool modeledOwner;
                for (uint256 actorIndex = 0; actorIndex < _actors.length; ++actorIndex) {
                    if (owner == address(_actors[actorIndex])) {
                        ++mirrorBalances[actorIndex];
                        modeledOwner = true;
                        break;
                    }
                }
                require(modeledOwner, "identity escaped modeled actors");
                if (state == FuelCore.IdentityState.Transient) ++transient;
                else if (state == FuelCore.IdentityState.Permanent) ++permanent;
                else revert("invalid identity state");
            }

            AttributeRegistry.Attributes memory attributes =
                _fixture.attributes.attributeOf(identityId);
            if (identityId <= 4_440) {
                uint8 trackIndex = uint8(attributes.track) - 1;
                uint8 tierIndex = uint8(attributes.tier) - 1;
                ++tierCounts[trackIndex][tierIndex];
                tierWeights[trackIndex][tierIndex] += attributes.weight;
                require(
                    attributes.collectibleKind == AttributeRegistry.CollectibleKind.Ordinary,
                    "ordinary identity kind drifted"
                );
            } else if (identityId < 4_444) {
                require(
                    attributes.collectibleKind == AttributeRegistry.CollectibleKind.BasketRelic,
                    "Basket Relic kind drifted"
                );
            } else {
                require(
                    attributes.collectibleKind == AttributeRegistry.CollectibleKind.IndicatorRelic,
                    "Indicator Relic kind drifted"
                );
            }
        }

        require(available == _fixture.fuel.availableIdentityCount(), "available count drifted");
        require(transient == _fixture.fuel.totalTransientCount(), "transient count drifted");
        require(permanent == _fixture.fuel.permanentCount(), "permanent count drifted");
        require(available + transient + permanent == 4_444, "identity partition broken");
        uint256[4] memory expectedCounts = [uint256(612), 333, 133, 32];
        uint256[4] memory expectedWeights = [uint256(61_200), 49_950, 33_250, 16_000];
        for (uint256 actorIndex = 0; actorIndex < _actors.length; ++actorIndex) {
            require(
                mirrorBalances[actorIndex]
                    == _fixture.mirror.balanceOf(address(_actors[actorIndex])),
                "mirror balance drifted"
            );
        }
        for (uint256 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            for (uint256 tierIndex = 0; tierIndex < 4; ++tierIndex) {
                require(
                    tierCounts[trackIndex][tierIndex] == expectedCounts[tierIndex],
                    "tier count drifted"
                );
                require(
                    tierWeights[trackIndex][tierIndex] == expectedWeights[tierIndex],
                    "tier weight drifted"
                );
            }
        }
    }

    function _assertRewardAndFeeConservation() private view {
        uint256 hookPots = _fixture.feeHook.rewardPot() + _fixture.feeHook.liquidityPot()
            + _fixture.feeHook.creatorPot();
        require(
            _fixture.weth.balanceOf(address(_fixture.feeHook)) == hookPots,
            "sealed fee pots do not match hook WETH"
        );
        require(
            _fixture.feeHook.rewardDestination() == address(_fixture.converter),
            "reward destination changed"
        );
        require(
            _fixture.feeHook.liquidityDestination() == address(_fixture.protocolLiquidityVault),
            "liquidity destination changed"
        );
        require(_fixture.feeHook.creatorDestination() == address(this), "creator changed");

        uint256 queuedWeth;
        for (uint8 trackIndex = 0; trackIndex < 4; ++trackIndex) {
            AttributeRegistry.RewardTrack track = AttributeRegistry.RewardTrack(trackIndex + 1);
            queuedWeth += _fixture.converter.trackQueue(track);
            require(
                _fixture.stocks[trackIndex].balanceOf(address(_fixture.ledger))
                    >= _fixture.ledger.totalLiability(track),
                "Pending Rewards exceed RewardLedger token balance"
            );
        }
        require(
            _fixture.weth.balanceOf(address(_fixture.converter)) == queuedWeth,
            "converter WETH and per-track queues diverged"
        );
        require(
            _fixture.weth.balanceOf(address(_fixture.protocolLiquidityVault))
                == _fixture.protocolLiquidityVault.queuedWeth(),
            "POL queued WETH diverged from its balance"
        );
        require(
            _fixture.ledger.epochConverter() == address(_fixture.converter),
            "unauthorized converter replaced sealed converter"
        );
    }
}
