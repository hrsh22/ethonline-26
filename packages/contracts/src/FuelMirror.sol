// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {ICollectibleMetadata} from "./interfaces/ICollectibleMetadata.sol";

interface IFuelMirrorCore {
    function collectibleBalanceOf(address owner) external view returns (uint256);
    function identityOwner(uint16 identityId) external view returns (address);
    function mirrorTransfer(address operator, address from, address to, uint16 identityId) external;
    function validateMirrorApproval(address identityOwner, address caller, address operator)
        external
        view;
    function isPermanentIdentity(uint16 identityId) external view returns (bool);
}

interface IERC721Receiver {
    function onERC721Received(
        address operator,
        address from,
        uint256 identityId,
        bytes calldata data
    ) external returns (bytes4);
}

contract FuelMirror {
    bytes4 private constant _ERC165_INTERFACE_ID = 0x01ffc9a7;
    bytes4 private constant _ERC721_INTERFACE_ID = 0x80ac58cd;
    bytes4 private constant _ERC721_METADATA_INTERFACE_ID = 0x5b5e139f;

    string public name;
    string public symbol;
    address public immutable core;
    ICollectibleMetadata public metadataRenderer;

    error InvalidOwner();
    error InvalidOperator();
    error InvalidRecipient();
    error UnsafeRecipient();
    error Unauthorized(address caller, uint256 identityId);
    error UnknownIdentity(uint256 identityId);
    error UnauthorizedCore(address caller);
    error MetadataUnavailable();

    event Transfer(address indexed from, address indexed to, uint256 indexed identityId);
    event Approval(address indexed owner, address indexed approved, uint256 indexed identityId);
    event ApprovalForAll(address indexed owner, address indexed operator, bool approved);

    mapping(uint256 identityId => address approved) private _tokenApproval;
    mapping(address owner => mapping(address operator => bool approved)) private _operatorApproval;

    constructor(string memory name_, string memory symbol_) {
        name = name_;
        symbol = symbol_;
        core = msg.sender;
    }

    modifier onlyCore() {
        if (msg.sender != core) revert UnauthorizedCore(msg.sender);
        _;
    }

    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert InvalidOwner();
        return IFuelMirrorCore(core).collectibleBalanceOf(owner);
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == _ERC165_INTERFACE_ID || interfaceId == _ERC721_INTERFACE_ID
            || interfaceId == _ERC721_METADATA_INTERFACE_ID;
    }

    function tokenURI(uint256 identityId) external view returns (string memory) {
        ownerOf(identityId);
        ICollectibleMetadata renderer = metadataRenderer;
        if (address(renderer) == address(0)) revert MetadataUnavailable();
        uint16 compactIdentityId = _compactIdentityId(identityId);
        return renderer.tokenURI(
            compactIdentityId, IFuelMirrorCore(core).isPermanentIdentity(compactIdentityId)
        );
    }

    function ownerOf(uint256 identityId) public view returns (address owner) {
        if (identityId == 0 || identityId > 4_444) {
            revert UnknownIdentity(identityId);
        }
        // The collection bound above makes this narrowing conversion safe.
        // forge-lint: disable-next-line(unsafe-typecast)
        owner = IFuelMirrorCore(core).identityOwner(uint16(identityId));
        if (owner == address(0)) revert UnknownIdentity(identityId);
    }

    function approve(address approved, uint256 identityId) external {
        address identityOwner_ = ownerOf(identityId);
        if (approved == identityOwner_) revert InvalidOperator();
        if (msg.sender != identityOwner_ && !_operatorApproval[identityOwner_][msg.sender]) {
            revert Unauthorized(msg.sender, identityId);
        }
        IFuelMirrorCore(core).validateMirrorApproval(identityOwner_, msg.sender, approved);
        _tokenApproval[identityId] = approved;
        emit Approval(identityOwner_, approved, identityId);
    }

    function getApproved(uint256 identityId) public view returns (address) {
        ownerOf(identityId);
        return _tokenApproval[identityId];
    }

    function setApprovalForAll(address operator, bool approved) external {
        if (operator == msg.sender) revert InvalidOperator();
        IFuelMirrorCore(core).validateMirrorApproval(msg.sender, msg.sender, operator);
        _operatorApproval[msg.sender][operator] = approved;
        emit ApprovalForAll(msg.sender, operator, approved);
    }

    function isApprovedForAll(address owner, address operator) external view returns (bool) {
        return _operatorApproval[owner][operator];
    }

    function transferFrom(address from, address to, uint256 identityId) public {
        if (to == address(0)) revert InvalidRecipient();
        address identityOwner_ = ownerOf(identityId);
        if (identityOwner_ != from) revert InvalidOwner();
        if (
            msg.sender != identityOwner_ && _tokenApproval[identityId] != msg.sender
                && !_operatorApproval[identityOwner_][msg.sender]
        ) {
            revert Unauthorized(msg.sender, identityId);
        }

        IFuelMirrorCore(core).mirrorTransfer(msg.sender, from, to, _compactIdentityId(identityId));
    }

    function safeTransferFrom(address from, address to, uint256 identityId) external {
        safeTransferFrom(from, to, identityId, "");
    }

    function safeTransferFrom(address from, address to, uint256 identityId, bytes memory data)
        public
    {
        transferFrom(from, to, identityId);
        if (
            to.code.length != 0
                && IERC721Receiver(to).onERC721Received(msg.sender, from, identityId, data)
                    != IERC721Receiver.onERC721Received.selector
        ) {
            revert UnsafeRecipient();
        }
    }

    function syncTransfer(address from, address to, uint16 identityId) external onlyCore {
        address approved = _tokenApproval[identityId];
        if (approved != address(0)) {
            delete _tokenApproval[identityId];
            emit Approval(from, address(0), identityId);
        }
        emit Transfer(from, to, identityId);
    }

    function clearApproval(address identityOwner_, uint16 identityId) external onlyCore {
        address approved = _tokenApproval[identityId];
        if (approved != address(0)) {
            delete _tokenApproval[identityId];
            emit Approval(identityOwner_, address(0), identityId);
        }
    }

    function setMetadataRenderer(ICollectibleMetadata renderer) external onlyCore {
        metadataRenderer = renderer;
    }

    function _compactIdentityId(uint256 identityId) private pure returns (uint16) {
        // ownerOf has already enforced the 1..4,444 collection range.
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint16(identityId);
    }
}
