// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

import {ICollectibleMetadata} from "../interfaces/ICollectibleMetadata.sol";

interface IAttributeMetadataRegistry {
    function isSealed() external view returns (bool);

    function attributeOf(uint16 identityId)
        external
        view
        returns (uint8 track, uint8 tier, uint16 weight, uint8 collectibleKind);
}

/// @notice Immutable placeholder renderer whose traits come from the sealed assignment registry.
contract PlaceholderMetadataRenderer is ICollectibleMetadata {
    using Strings for uint256;

    struct IdentityConfiguration {
        string transientCollectible;
        string permanentCollectible;
        string basketRelic;
        string indicatorRelic;
        string metadataDescription;
        string transientImage;
        string permanentImage;
        string basketRelicImage;
        string indicatorRelicImage;
    }

    IAttributeMetadataRegistry public immutable attributeRegistry;
    string public transientCollectible;
    string public permanentCollectible;
    string public basketRelic;
    string public indicatorRelic;
    string public metadataDescription;
    string public transientImageLocation;
    string public permanentImageLocation;
    string public basketRelicImageLocation;
    string public indicatorRelicImageLocation;

    error EmptyMetadataLocation();
    error UnsealedAttributeRegistry();

    constructor(
        IAttributeMetadataRegistry attributeRegistry_,
        IdentityConfiguration memory identity
    ) {
        if (address(attributeRegistry_).code.length == 0 || !attributeRegistry_.isSealed()) {
            revert UnsealedAttributeRegistry();
        }
        if (
            bytes(identity.transientCollectible).length == 0
                || bytes(identity.permanentCollectible).length == 0
                || bytes(identity.basketRelic).length == 0
                || bytes(identity.indicatorRelic).length == 0
                || bytes(identity.metadataDescription).length == 0
                || bytes(identity.transientImage).length == 0
                || bytes(identity.permanentImage).length == 0
                || bytes(identity.basketRelicImage).length == 0
                || bytes(identity.indicatorRelicImage).length == 0
        ) {
            revert EmptyMetadataLocation();
        }
        attributeRegistry = attributeRegistry_;
        transientCollectible = identity.transientCollectible;
        permanentCollectible = identity.permanentCollectible;
        basketRelic = identity.basketRelic;
        indicatorRelic = identity.indicatorRelic;
        metadataDescription = identity.metadataDescription;
        transientImageLocation = identity.transientImage;
        permanentImageLocation = identity.permanentImage;
        basketRelicImageLocation = identity.basketRelicImage;
        indicatorRelicImageLocation = identity.indicatorRelicImage;
    }

    function tokenURI(uint16 identityId, bool permanent) external view returns (string memory) {
        (uint8 track, uint8 tier, uint16 weight, uint8 collectibleKind) =
            attributeRegistry.attributeOf(identityId);
        string memory state = permanent ? permanentCollectible : transientCollectible;
        string memory json = string.concat(
            '{"name":"',
            _name(identityId, permanent, collectibleKind),
            '","description":"',
            metadataDescription,
            '",',
            '"image":"',
            _image(permanent, collectibleKind),
            '","attributes":[',
            '{"display_type":"number","trait_type":"Identity ID","value":',
            uint256(identityId).toString(),
            "},",
            '{"trait_type":"State","value":"',
            state,
            '"},',
            '{"trait_type":"Reward Track","value":"',
            _track(track),
            '"},',
            '{"trait_type":"Rarity Tier","value":"',
            _tier(tier),
            '"},',
            '{"trait_type":"Reward Weight","value":',
            _weight(weight),
            "},",
            '{"trait_type":"Collectible Kind","value":"',
            _kind(collectibleKind),
            '"}]}'
        );
        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    function _name(uint16 identityId, bool permanent, uint8 kind)
        private
        view
        returns (string memory)
    {
        if (kind == 1) {
            return string.concat(basketRelic, " ", uint256(identityId - 4_440).toString());
        }
        if (kind == 2) return indicatorRelic;
        return string.concat(
            permanent ? permanentCollectible : transientCollectible,
            " #",
            uint256(identityId).toString()
        );
    }

    function _image(bool permanent, uint8 kind) private view returns (string memory) {
        if (kind == 1) return basketRelicImageLocation;
        if (kind == 2) return indicatorRelicImageLocation;
        return permanent ? permanentImageLocation : transientImageLocation;
    }

    function _track(uint8 track) private pure returns (string memory) {
        if (track == 1) return "AAPLc";
        if (track == 2) return "GOOGLc";
        if (track == 3) return "METAc";
        if (track == 4) return "NVDAc";
        return "All Reward Tracks";
    }

    function _tier(uint8 tier) private pure returns (string memory) {
        if (tier == 1) return "I";
        if (tier == 2) return "II";
        if (tier == 3) return "III";
        if (tier == 4) return "IV";
        return "Special";
    }

    function _weight(uint16 hundredths) private pure returns (string memory) {
        uint256 whole = hundredths / 100;
        uint256 fractional = hundredths % 100;
        if (fractional == 0) return whole.toString();
        if (fractional % 10 == 0) {
            return string.concat(whole.toString(), ".", (fractional / 10).toString());
        }
        return string.concat(whole.toString(), fractional < 10 ? ".0" : ".", fractional.toString());
    }

    function _kind(uint8 kind) private view returns (string memory) {
        if (kind == 1) return basketRelic;
        if (kind == 2) return indicatorRelic;
        return "Ordinary";
    }
}
