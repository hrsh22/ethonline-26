// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";
import {Test} from "forge-std/Test.sol";

import {FuelCore} from "../src/FuelCore.sol";
import {DevelopmentRecoveryAuthority} from "../src/deployment/DevelopmentRecoveryAuthority.sol";
import {
    IAttributeMetadataRegistry,
    PlaceholderMetadataRenderer
} from "../src/metadata/PlaceholderMetadataRenderer.sol";

contract MetadataRegistryHarness is IAttributeMetadataRegistry {
    bool public isSealed = true;

    function setSealed(bool sealed_) external {
        isSealed = sealed_;
    }

    function attributeOf(uint16 identityId)
        external
        pure
        returns (uint8 track, uint8 tier, uint16 weight, uint8 collectibleKind)
    {
        if (identityId == 12) return (2, 3, 250, 0);
        if (identityId == 4_441) return (0, 0, 0, 1);
        if (identityId == 4_444) return (0, 0, 0, 2);
        revert("unexpected identity");
    }
}

contract RecoveryTargetHarness {
    address public lastAccount;
    address public lastRecipient;
    uint256 public lastAmount;
    bool public lastFrozen;

    function setFrozen(address account, bool frozen) external {
        lastAccount = account;
        lastFrozen = frozen;
    }

    function recoverLiquid(address from, address to, uint256 amount) external {
        lastAccount = from;
        lastRecipient = to;
        lastAmount = amount;
    }

    function recoverCollectible(address from, address to, uint16 identityId) external {
        lastAccount = from;
        lastRecipient = to;
        lastAmount = identityId;
    }
}

contract DeploymentComponentsTest is Test {
    function testMetadataRendererReadsOnlyASealedRegistryAndPublishesItsLocations() external {
        string memory conformance = vm.readFile("../config/collection/metadata-conformance.json");
        MetadataRegistryHarness registry = new MetadataRegistryHarness();
        PlaceholderMetadataRenderer renderer =
            new PlaceholderMetadataRenderer(registry, _identityConfiguration(conformance));

        require(address(renderer.attributeRegistry()) == address(registry), "wrong registry");
        require(
            keccak256(bytes(renderer.transientImageLocation()))
                == keccak256(bytes(vm.parseJsonString(conformance, ".identity.transientImage"))),
            "wrong transient location"
        );
        for (uint256 index; index < 3; ++index) {
            string memory path = string.concat(".cases[", vm.toString(index), "]");
            uint16 identityId =
                uint16(vm.parseJsonUint(conformance, string.concat(path, ".identityId")));
            bool permanent = vm.parseJsonBool(conformance, string.concat(path, ".permanent"));
            string memory expectedJson =
                vm.parseJsonString(conformance, string.concat(path, ".expectedJson"));
            string memory expectedUri =
                string.concat("data:application/json;base64,", Base64.encode(bytes(expectedJson)));
            require(
                keccak256(bytes(renderer.tokenURI(identityId, permanent)))
                    == keccak256(bytes(expectedUri)),
                "metadata did not match shared conformance vector"
            );
        }

        registry.setSealed(false);
        (bool deployed,) = address(this)
            .call(abi.encodeCall(this.deployRenderer, (IAttributeMetadataRegistry(registry))));
        require(!deployed, "renderer accepted an unsealed registry");
    }

    function _identityConfiguration(string memory conformance)
        private
        pure
        returns (PlaceholderMetadataRenderer.IdentityConfiguration memory)
    {
        return PlaceholderMetadataRenderer.IdentityConfiguration({
            transientCollectible: vm.parseJsonString(conformance, ".identity.transientCollectible"),
            permanentCollectible: vm.parseJsonString(conformance, ".identity.permanentCollectible"),
            basketRelic: vm.parseJsonString(conformance, ".identity.basketRelic"),
            indicatorRelic: vm.parseJsonString(conformance, ".identity.indicatorRelic"),
            metadataDescription: vm.parseJsonString(conformance, ".identity.metadataDescription"),
            transientImage: vm.parseJsonString(conformance, ".identity.transientImage"),
            permanentImage: vm.parseJsonString(conformance, ".identity.permanentImage"),
            basketRelicImage: vm.parseJsonString(conformance, ".identity.basketRelicImage"),
            indicatorRelicImage: vm.parseJsonString(conformance, ".identity.indicatorRelicImage")
        });
    }

    function testDevelopmentRecoveryIsLocalOnlyAndOperatorControlled() external {
        DevelopmentRecoveryAuthority recovery = new DevelopmentRecoveryAuthority(address(this), 2);
        RecoveryTargetHarness target = new RecoveryTargetHarness();

        require(recovery.getThreshold() == 2, "wrong development threshold");
        recovery.setFrozen(FuelCore(address(target)), address(0xA11CE), true);
        require(target.lastAccount() == address(0xA11CE), "freeze was not forwarded");
        require(target.lastFrozen(), "freeze value was not forwarded");
        recovery.recoverLiquid(FuelCore(address(target)), address(0xB0B), address(0xCAFE), 12 ether);
        require(target.lastAccount() == address(0xB0B), "recovery source mismatch");
        require(target.lastRecipient() == address(0xCAFE), "recovery recipient mismatch");
        require(target.lastAmount() == 12 ether, "recovery amount mismatch");

        RecoveryCaller caller = new RecoveryCaller();
        (bool unauthorized,) = address(caller)
            .call(
                abi.encodeCall(
                    RecoveryCaller.freeze, (recovery, FuelCore(address(target)), address(0xD00D))
                )
            );
        require(!unauthorized, "non-operator used development recovery");
    }

    function deployRenderer(IAttributeMetadataRegistry registry) external {
        new PlaceholderMetadataRenderer(
            registry,
            PlaceholderMetadataRenderer.IdentityConfiguration({
                transientCollectible: "a",
                permanentCollectible: "b",
                basketRelic: "c",
                indicatorRelic: "d",
                metadataDescription: "e",
                transientImage: "f",
                permanentImage: "g",
                basketRelicImage: "h",
                indicatorRelicImage: "i"
            })
        );
    }
}

contract RecoveryCaller {
    function freeze(DevelopmentRecoveryAuthority recovery, FuelCore core, address account)
        external
    {
        recovery.setFrozen(core, account, true);
    }
}
