// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {TwoStepOwnable} from "../src/governance/TwoStepOwnable.sol";
import {ICanonicalFeeHook} from "../src/interfaces/ICanonicalFeeHook.sol";
import {ICanonicalMarketRegistry} from "../src/interfaces/ICanonicalMarketRegistry.sol";
import {ProtocolLiquidityVault} from "../src/liquidity/ProtocolLiquidityVault.sol";
import {ProtocolLiquidityTestBase} from "./helpers/ProtocolLiquidityTestBase.sol";

contract ProtocolLiquidityVaultTest is ProtocolLiquidityTestBase {
    function testBindsTheCanonicalMarketBeforeItsDestinationIsSealed() external {
        Fixture memory fixture = _deployUnregisteredFixture(address(0xBEEF), true);

        require(
            address(fixture.vault.registry()) == address(fixture.registry), "wrong Canonical Market"
        );
        require(address(fixture.vault.manager()) == address(fixture.manager), "wrong PoolManager");
        require(fixture.vault.fuel() == address(fixture.fuel), "wrong Liquid Token");
        require(fixture.vault.weth() == address(fixture.weth), "wrong Settlement Asset");
        require(fixture.vault.owner() == address(this), "wrong owner");
        require(fixture.vault.executor() == address(0xBEEF), "wrong executor");
        require(!fixture.vault.configurationSealed(), "unregistered destination sealed early");
    }

    function testSealsOnlyTheRegisteredCanonicalHookAndLiquidityDestination() external {
        Fixture memory fixture = _registerFixture(_deployUnregisteredFixture(address(this), true));

        require(fixture.vault.configurationSealed(), "liquidity destination not sealed");
        require(
            address(fixture.vault.canonicalFeeHook()) == address(fixture.hook),
            "wrong Canonical Fee Hook"
        );
        (bool redirected,) = address(fixture.vault)
            .call(
                abi.encodeCall(
                    ProtocolLiquidityVault.configureCanonicalFeeHook,
                    (ICanonicalFeeHook(address(0xBAD)))
                )
            );
        require(!redirected, "sealed liquidity destination was redirected");
    }

    function testConstructorReportsTheActualInvalidAuthority() external {
        Fixture memory fixture = _deployUnregisteredFixture(address(this), true);
        ICanonicalMarketRegistry registry = ICanonicalMarketRegistry(address(fixture.registry));

        // A zero owner is now rejected by the shared ownership base, which
        // names the invalid candidate through its own error.
        try new ProtocolLiquidityVault(registry, address(0), address(this)) returns (
            ProtocolLiquidityVault
        ) {
            revert("zero owner accepted");
        } catch (bytes memory reason) {
            require(
                keccak256(reason)
                    == keccak256(
                        abi.encodeWithSelector(
                            TwoStepOwnable.OwnableInvalidOwner.selector, address(0)
                        )
                    ),
                "invalid owner diagnostic was misleading"
            );
        }
        try new ProtocolLiquidityVault(registry, address(this), address(0)) returns (
            ProtocolLiquidityVault
        ) {
            revert("zero executor accepted");
        } catch (bytes memory reason) {
            _requireZeroConfigurationError(reason);
        }
    }

    function _requireZeroConfigurationError(bytes memory reason) private pure {
        require(
            keccak256(reason)
                == keccak256(
                    abi.encodeWithSelector(
                        ProtocolLiquidityVault.InvalidConfiguration.selector, address(0)
                    )
                ),
            "invalid authority diagnostic was misleading"
        );
    }
}
