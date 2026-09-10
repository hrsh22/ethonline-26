// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    CcaLaunchCoordinator,
    ICcaLaunchFuel,
    ICcaLaunchReadiness
} from "../src/launch/CcaLaunchCoordinator.sol";
import {PermanentPositionRecipient} from "../src/launch/PermanentPositionRecipient.sol";
import {IHooks} from "v4-core/interfaces/IHooks.sol";
import {Currency} from "v4-core/types/Currency.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

contract CcaLaunchFuelHarness is ICcaLaunchFuel {
    address public owner = msg.sender;
    address public pendingOwner;
    bool public launched;
    mapping(address => bool) public discoveryExempt;
    mapping(address => bool) public protectedAccount;

    function offer(address nominee) external {
        require(msg.sender == owner, "only owner");
        pendingOwner = nominee;
    }

    function acceptOwnership() external {
        require(msg.sender == pendingOwner, "not pending owner");
        owner = msg.sender;
        pendingOwner = address(0);
    }

    function transferOwnership(address nominee) external {
        require(msg.sender == owner, "only owner");
        pendingOwner = nominee;
    }

    function setDiscoveryExempt(address account, bool exempt) external {
        require(msg.sender == owner && !launched, "configuration locked");
        discoveryExempt[account] = exempt;
    }

    function setProtectedAccount(address account, bool protected_) external {
        require(msg.sender == owner && !launched, "configuration locked");
        protectedAccount[account] = protected_;
    }

    function launch() external {
        require(msg.sender == owner, "only owner");
        launched = true;
    }
}

contract CcaLaunchReadinessHarness is ICcaLaunchReadiness {
    bool public ready;

    function setReady(bool ready_) external {
        ready = ready_;
    }

    function isReady() external view returns (bool) {
        return ready;
    }
}

contract CcaEscrowFactoryCaller {
    function register(CcaLaunchCoordinator coordinator, address escrow) external {
        coordinator.registerLaunchEscrow(escrow);
    }
}

contract CcaEscrowCodeHarness {}

contract PositionManagerHarness {
    using PoolIdLibrary for PoolKey;

    mapping(uint256 => PoolKey) private _keys;
    mapping(uint256 => uint128) private _liquidities;
    mapping(uint256 => address) private _owners;

    function configure(uint256 tokenId, PoolKey calldata key, uint128 liquidity) external {
        _keys[tokenId] = key;
        _liquidities[tokenId] = liquidity;
    }

    function setOwner(uint256 tokenId, address owner) external {
        _owners[tokenId] = owner;
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        return _owners[tokenId];
    }

    function deliver(PermanentPositionRecipient recipient, uint256 tokenId)
        external
        returns (bytes4)
    {
        return recipient.onERC721Received(address(this), address(0), tokenId, bytes(""));
    }

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory, uint256)
    {
        return (_keys[tokenId], 0);
    }

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128) {
        return _liquidities[tokenId];
    }
}

contract CcaLaunchCoordinatorTest {
    function testCoordinatorProtectsEscrowsAndCannotLaunchBeforeReadiness() external {
        CcaLaunchFuelHarness fuel = new CcaLaunchFuelHarness();
        CcaLaunchReadinessHarness readiness = new CcaLaunchReadinessHarness();
        address governanceOwner = address(0xB0B);
        CcaLaunchCoordinator coordinator =
            new CcaLaunchCoordinator(fuel, readiness, address(this), governanceOwner);
        CcaEscrowFactoryCaller factory = new CcaEscrowFactoryCaller();
        CcaEscrowCodeHarness escrow = new CcaEscrowCodeHarness();

        coordinator.configureEscrowFactory(address(factory));
        coordinator.sealConfiguration();
        fuel.offer(address(coordinator));
        coordinator.acceptFuelOwnership();
        factory.register(coordinator, address(escrow));

        require(fuel.discoveryExempt(address(escrow)), "escrow triggers discovery");
        require(fuel.protectedAccount(address(escrow)), "escrow is recovery movable");

        (bool premature,) = address(coordinator).call(abi.encodeCall(coordinator.activate, ()));
        require(!premature && !fuel.launched(), "premature launch succeeded");

        readiness.setReady(true);
        coordinator.activate();
        require(fuel.launched(), "ready launch failed");
        require(fuel.owner() == address(coordinator), "ownership moved before acceptance");
        require(fuel.pendingOwner() == governanceOwner, "governance handover missing");

        (bool lateRegistration,) = address(factory)
            .call(
                abi.encodeCall(factory.register, (coordinator, address(new CcaEscrowCodeHarness())))
            );
        require(!lateRegistration, "post-launch escrow registered");
    }

    function testCoordinatorRejectsIncompleteOrUnauthorizedConfiguration() external {
        CcaLaunchFuelHarness fuel = new CcaLaunchFuelHarness();
        CcaLaunchReadinessHarness readiness = new CcaLaunchReadinessHarness();
        CcaLaunchCoordinator coordinator =
            new CcaLaunchCoordinator(fuel, readiness, address(this), address(0xB0B));

        (bool incomplete,) =
            address(coordinator).call(abi.encodeCall(coordinator.sealConfiguration, ()));
        require(!incomplete, "incomplete configuration sealed");

        CcaEscrowCodeHarness unregistered = new CcaEscrowCodeHarness();
        (bool unauthorized,) = address(coordinator)
            .call(abi.encodeCall(coordinator.registerLaunchEscrow, (address(unregistered))));
        require(!unauthorized, "unauthorized escrow registered");
    }

    function testPermanentPositionRecipientAcceptsOnlyPositionManagerAndNeverExposesExit()
        external
    {
        PositionManagerHarness manager = new PositionManagerHarness();
        PoolKey memory key = PoolKey({
            currency0: Currency.wrap(address(1)),
            currency1: Currency.wrap(address(2)),
            fee: 3_000,
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });
        PermanentPositionRecipient recipient =
            new PermanentPositionRecipient(address(manager), key.toId());

        bytes4 accepted = manager.deliver(recipient, 7);
        require(accepted == recipient.onERC721Received.selector, "position callback rejected");
        require(recipient.receivedPosition(7), "position not recorded");
        require(recipient.receivedPositionCount() == 1, "wrong position count");
        require(!recipient.hasCanonicalPosition(), "unconfigured position counted as liquidity");
        manager.configure(7, key, 1);
        require(recipient.hasCanonicalPosition(), "canonical liquidity not recognized");

        manager.configure(9, key, 1);
        manager.setOwner(9, address(recipient));
        recipient.registerPosition(9);
        require(recipient.receivedPosition(9), "non-safe mint was not registered");

        (bool spoofed,) = address(recipient)
            .call(
                abi.encodeCall(
                    recipient.onERC721Received, (address(this), address(0), 8, bytes(""))
                )
            );
        require(!spoofed, "spoofed position accepted");

        (bool arbitraryExit,) = address(recipient)
            .call(
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256)", address(recipient), address(this), 7
                )
            );
        require(!arbitraryExit, "position recipient exposed an exit");
    }
}
