// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {FuelCore} from "../FuelCore.sol";
import {IThresholdRecovery} from "../interfaces/IThresholdRecovery.sol";

/// @notice Two-party recovery authority for the valueless Base Sepolia POC.
/// @dev Each action is approved onchain by both configured signers before it is forwarded.
contract TestnetThresholdRecoveryAuthority is IThresholdRecovery {
    uint256 private constant BASE_SEPOLIA_CHAIN_ID = 84_532;
    bytes32 private constant SET_FROZEN_ACTION = keccak256("SET_FROZEN");
    bytes32 private constant RECOVER_LIQUID_ACTION = keccak256("RECOVER_LIQUID");
    bytes32 private constant RECOVER_COLLECTIBLE_ACTION = keccak256("RECOVER_COLLECTIBLE");

    address public immutable signerOne;
    address public immutable signerTwo;

    mapping(bytes32 actionId => uint8 approvalMask) public approvalMask;
    mapping(bytes32 actionId => bool consumed) public consumed;

    error ActionAlreadyExecuted(bytes32 actionId);
    error ApprovalExpired(uint64 validUntilBlock);
    error DuplicateApproval(bytes32 actionId, address signer);
    error InvalidConfiguration();
    error NotBaseSepolia(uint256 chainId);
    error Unauthorized(address caller);

    event ActionApproved(bytes32 indexed actionId, address indexed signer, uint8 approvalMask);
    event ActionExecuted(bytes32 indexed actionId);

    constructor(address signerOne_, address signerTwo_) {
        if (block.chainid != BASE_SEPOLIA_CHAIN_ID) revert NotBaseSepolia(block.chainid);
        if (signerOne_ == address(0) || signerTwo_ == address(0) || signerOne_ == signerTwo_) {
            revert InvalidConfiguration();
        }
        signerOne = signerOne_;
        signerTwo = signerTwo_;
    }

    function getThreshold() external pure returns (uint256) {
        return 2;
    }

    function approveSetFrozen(
        FuelCore core,
        address account,
        bool frozen,
        bytes32 salt,
        uint64 validUntilBlock
    ) external {
        bytes32 actionId = keccak256(
            abi.encode(
                SET_FROZEN_ACTION,
                block.chainid,
                address(this),
                address(core),
                account,
                frozen,
                salt,
                validUntilBlock
            )
        );
        if (_approve(actionId, validUntilBlock)) {
            core.setFrozen(account, frozen);
            emit ActionExecuted(actionId);
        }
    }

    function approveRecoverLiquid(
        FuelCore core,
        address from,
        address to,
        uint256 amount,
        bytes32 salt,
        uint64 validUntilBlock
    ) external {
        bytes32 actionId = keccak256(
            abi.encode(
                RECOVER_LIQUID_ACTION,
                block.chainid,
                address(this),
                address(core),
                from,
                to,
                amount,
                salt,
                validUntilBlock
            )
        );
        if (_approve(actionId, validUntilBlock)) {
            core.recoverLiquid(from, to, amount);
            emit ActionExecuted(actionId);
        }
    }

    function approveRecoverCollectible(
        FuelCore core,
        address from,
        address to,
        uint16 identityId,
        bytes32 salt,
        uint64 validUntilBlock
    ) external {
        bytes32 actionId = keccak256(
            abi.encode(
                RECOVER_COLLECTIBLE_ACTION,
                block.chainid,
                address(this),
                address(core),
                from,
                to,
                identityId,
                salt,
                validUntilBlock
            )
        );
        if (_approve(actionId, validUntilBlock)) {
            core.recoverCollectible(from, to, identityId);
            emit ActionExecuted(actionId);
        }
    }

    function _approve(bytes32 actionId, uint64 validUntilBlock) private returns (bool executable) {
        if (block.number > validUntilBlock) revert ApprovalExpired(validUntilBlock);
        if (consumed[actionId]) revert ActionAlreadyExecuted(actionId);

        uint8 signerBit;
        if (msg.sender == signerOne) {
            signerBit = 1;
        } else if (msg.sender == signerTwo) {
            signerBit = 2;
        } else {
            revert Unauthorized(msg.sender);
        }

        uint8 currentMask = approvalMask[actionId];
        if (currentMask & signerBit != 0) revert DuplicateApproval(actionId, msg.sender);
        uint8 updatedMask = currentMask | signerBit;
        emit ActionApproved(actionId, msg.sender, updatedMask);
        if (updatedMask != 3) {
            approvalMask[actionId] = updatedMask;
            return false;
        }

        delete approvalMask[actionId];
        consumed[actionId] = true;
        return true;
    }
}
