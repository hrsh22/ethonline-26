// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import {PoolId, PoolIdLibrary} from "v4-core/types/PoolId.sol";
import {PoolKey} from "v4-core/types/PoolKey.sol";

interface IPositionManagerLaunchView {
    function ownerOf(uint256 tokenId) external view returns (address owner);

    function getPoolAndPositionInfo(uint256 tokenId)
        external
        view
        returns (PoolKey memory poolKey, uint256 positionInfo);

    function getPositionLiquidity(uint256 tokenId) external view returns (uint128 liquidity);
}

/// @notice Terminal custody for the v4 positions created by the FUEL launch.
/// @dev It deliberately exposes no approval, transfer, rescue, ownership, or arbitrary-call surface.
contract PermanentPositionRecipient is IERC721Receiver {
    using PoolIdLibrary for PoolKey;

    address public immutable positionManager;
    PoolId public immutable expectedPoolId;
    uint256 public receivedPositionCount;
    mapping(uint256 tokenId => bool received) public receivedPosition;
    uint256[] private _receivedTokenIds;

    error InvalidPositionManager(address configured);
    error UnauthorizedPositionManager(address caller);
    error DuplicatePosition(uint256 tokenId);
    error PositionNotOwned(uint256 tokenId, address owner);
    error InvalidCanonicalPosition(uint256 tokenId);

    event PositionPermanentlyReceived(uint256 indexed tokenId);

    constructor(address positionManager_, PoolId expectedPoolId_) {
        if (positionManager_.code.length == 0 || PoolId.unwrap(expectedPoolId_) == bytes32(0)) {
            revert InvalidPositionManager(positionManager_);
        }
        positionManager = positionManager_;
        expectedPoolId = expectedPoolId_;
    }

    function onERC721Received(address, address, uint256 tokenId, bytes calldata)
        external
        returns (bytes4)
    {
        if (msg.sender != positionManager) revert UnauthorizedPositionManager(msg.sender);
        if (receivedPosition[tokenId]) revert DuplicatePosition(tokenId);
        receivedPosition[tokenId] = true;
        _receivedTokenIds.push(tokenId);
        ++receivedPositionCount;
        emit PositionPermanentlyReceived(tokenId);
        return IERC721Receiver.onERC721Received.selector;
    }

    /// @notice Records an official PositionManager mint, which does not invoke ERC-721 callbacks.
    function registerPosition(uint256 tokenId) external {
        IPositionManagerLaunchView manager = IPositionManagerLaunchView(positionManager);
        address positionOwner = manager.ownerOf(tokenId);
        if (positionOwner != address(this)) revert PositionNotOwned(tokenId, positionOwner);
        if (receivedPosition[tokenId]) revert DuplicatePosition(tokenId);
        if (!_isCanonicalPosition(manager, tokenId)) revert InvalidCanonicalPosition(tokenId);
        receivedPosition[tokenId] = true;
        _receivedTokenIds.push(tokenId);
        ++receivedPositionCount;
        emit PositionPermanentlyReceived(tokenId);
    }

    /// @notice Confirms at least one received NFT currently represents live canonical liquidity.
    function hasCanonicalPosition() external view returns (bool) {
        IPositionManagerLaunchView manager = IPositionManagerLaunchView(positionManager);
        uint256 count = _receivedTokenIds.length;
        for (uint256 index; index < count; ++index) {
            uint256 tokenId = _receivedTokenIds[index];
            if (_isCanonicalPosition(manager, tokenId)) return true;
        }
        return false;
    }

    function _isCanonicalPosition(IPositionManagerLaunchView manager, uint256 tokenId)
        private
        view
        returns (bool)
    {
        try manager.getPoolAndPositionInfo(tokenId) returns (PoolKey memory key, uint256) {
            if (PoolId.unwrap(key.toId()) != PoolId.unwrap(expectedPoolId)) return false;
            try manager.getPositionLiquidity(tokenId) returns (uint128 liquidity) {
                return liquidity != 0;
            } catch {
                return false;
            }
        } catch {
            return false;
        }
    }
}
