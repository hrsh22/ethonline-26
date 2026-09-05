// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../src/FuelCore.sol";
import {FuelMirror, IERC721Receiver} from "../src/FuelMirror.sol";
import {DeterministicDiscoveryAdapter} from "../src/discovery/DeterministicDiscoveryAdapter.sol";
import {IRewardLedgerCallbacks} from "../src/interfaces/IRewardLedgerCallbacks.sol";
import {IThresholdRecovery} from "../src/interfaces/IThresholdRecovery.sol";
import {CanonicalMarketRegistryHarness} from "./helpers/CanonicalMarketRegistryHarness.sol";
import {RewardLedgerCallbackHarness} from "./helpers/RewardLedgerCallbackHarness.sol";

contract ReceiverRecoveryHarness is IThresholdRecovery {
    function getThreshold() external pure returns (uint256) {
        return 2;
    }
}

contract SafeTransferHolder {
    function safeTransfer(FuelMirror mirror, address recipient, uint16 identityId) external {
        mirror.safeTransferFrom(address(this), recipient, identityId);
    }
}

contract RejectingCollectibleReceiver is IERC721Receiver {
    function onERC721Received(address, address, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return bytes4(0);
    }
}

contract ForwardingCollectibleReceiver is IERC721Receiver {
    FuelMirror public immutable mirror;
    address public immutable finalRecipient;

    constructor(FuelMirror mirror_, address finalRecipient_) {
        mirror = mirror_;
        finalRecipient = finalRecipient_;
    }

    function onERC721Received(address, address, uint256 identityId, bytes calldata)
        external
        returns (bytes4)
    {
        mirror.transferFrom(address(this), finalRecipient, identityId);
        return IERC721Receiver.onERC721Received.selector;
    }
}

contract FuelReceiverAdversarialTest {
    function testRejectingReceiverRollsBackEveryTransientOwnershipMutation() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        SafeTransferHolder holder = new SafeTransferHolder();
        RejectingCollectibleReceiver receiver = new RejectingCollectibleReceiver();
        require(core.transfer(address(holder), 1 ether), "holder funding failed");

        (bool transferred,) = address(holder)
            .call(
                abi.encodeCall(
                    SafeTransferHolder.safeTransfer, (mirror, address(receiver), uint16(101))
                )
            );

        require(!transferred, "rejecting ERC-721 receiver accepted identity");
        require(mirror.ownerOf(101) == address(holder), "failed safe transfer changed owner");
        require(core.balanceOf(address(holder)) == 1 ether, "failed safe transfer moved backing");
        require(core.balanceOf(address(receiver)) == 0, "receiver retained backing after revert");
        require(core.transientCount(address(holder)) == 1, "failed transfer changed sender state");
        require(
            core.transientCount(address(receiver)) == 0, "failed transfer changed recipient state"
        );
    }

    function testReceiverReentryCanOnlyForwardAConsistentIdentityAndBackingPair() external {
        (FuelCore core, FuelMirror mirror) = _deploy();
        SafeTransferHolder holder = new SafeTransferHolder();
        address finalRecipient = address(0xCAFE);
        ForwardingCollectibleReceiver receiver =
            new ForwardingCollectibleReceiver(mirror, finalRecipient);
        require(core.transfer(address(holder), 1 ether), "holder funding failed");

        holder.safeTransfer(mirror, address(receiver), 101);

        require(mirror.ownerOf(101) == finalRecipient, "forwarded identity has wrong owner");
        require(core.balanceOf(address(holder)) == 0, "sender retained backing");
        require(core.balanceOf(address(receiver)) == 0, "receiver retained backing");
        require(core.balanceOf(finalRecipient) == 1 ether, "final owner missed backing");
        require(core.transientCount(finalRecipient) == 1, "final owner missed transient state");
        require(mirror.getApproved(101) == address(0), "receiver reentry retained approval");
    }

    function _deploy() private returns (FuelCore core, FuelMirror mirror) {
        core = new FuelCore(
            "Receiver Liquid Token",
            "RCV",
            "Receiver Collectible",
            "RCVC",
            address(this),
            new DeterministicDiscoveryAdapter(bytes32(uint256(100))),
            address(0xBEEF),
            new ReceiverRecoveryHarness()
        );
        core.setCanonicalMarketRegistry(new CanonicalMarketRegistryHarness(address(core)));
        core.setRewardLedger(
            IRewardLedgerCallbacks(address(new RewardLedgerCallbackHarness(address(core))))
        );
        core.launch();
        mirror = core.mirror();
    }
}
