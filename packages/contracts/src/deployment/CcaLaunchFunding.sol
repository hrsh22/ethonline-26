// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {
    IAllowanceTransfer
} from "../../lib/liquidity-launcher/lib/permit2/src/interfaces/IAllowanceTransfer.sol";
import {FuelCore} from "../FuelCore.sol";
import {CcaLaunchCoordinator} from "../launch/CcaLaunchCoordinator.sol";
import {CcaRecoverySeeder} from "../launch/CcaRecoverySeeder.sol";
import {LiquidityLauncher} from "liquidity-launcher/src/LiquidityLauncher.sol";
import {Distribution} from "liquidity-launcher/src/types/Distribution.sol";

/// @notice Atomic finalization of the fresh auction funding and temporary ownership handoff.
/// @dev No recovery or arbitrary-call surface exists. Before funding, all FUEL remains with the
/// deployer. Failed execution rolls ownership, tokens, auction creation and recovery binding back.
contract CcaLaunchFunding {
    uint128 public constant TOTAL_SUPPLY = 4_444 ether;
    FuelCore public immutable fuel;
    LiquidityLauncher public immutable launcher;
    address public immutable strategy;
    IAllowanceTransfer public immutable permit2;
    address public immutable deploymentOwner;

    CcaRecoverySeeder public recovery;
    CcaLaunchCoordinator public coordinator;
    address public auction;
    bytes32 public distributionConfigHash;
    bytes32 public distributionSalt;
    uint64 public startBlock;
    bool public configured;
    bool public funded;

    error Unauthorized();
    error InvalidConfiguration();
    error FundingUnavailable();
    event FundingConfigured(address indexed auction, bytes32 distributionConfigHash);
    event AuctionFunded(address indexed auction, address indexed coordinator);

    constructor(
        FuelCore fuel_,
        LiquidityLauncher launcher_,
        address strategy_,
        address permit2_,
        address owner_
    ) {
        if (
            address(fuel_).code.length == 0 || address(launcher_).code.length == 0
                || strategy_.code.length == 0 || permit2_.code.length == 0 || owner_ == address(0)
        ) revert InvalidConfiguration();
        fuel = fuel_;
        launcher = launcher_;
        strategy = strategy_;
        permit2 = IAllowanceTransfer(permit2_);
        deploymentOwner = owner_;
    }

    function configure(
        CcaRecoverySeeder recovery_,
        CcaLaunchCoordinator coordinator_,
        address auction_,
        bytes32 configHash_,
        bytes32 salt_,
        uint64 startBlock_
    ) external {
        if (msg.sender != deploymentOwner) revert Unauthorized();
        if (
            configured || address(recovery_).code.length == 0
                || address(coordinator_).code.length == 0 || auction_ == address(0)
                || auction_.code.length != 0 || configHash_ == bytes32(0)
                || startBlock_ <= block.number
                || recovery_.configurationAuthority() != address(this)
                || address(recovery_.strategy()) != strategy
                || address(recovery_.registry()) != address(fuel.canonicalMarketRegistry())
                || address(coordinator_.fuel()) != address(fuel)
                || !coordinator_.configurationSealed()
        ) revert InvalidConfiguration();
        recovery = recovery_;
        coordinator = coordinator_;
        auction = auction_;
        distributionConfigHash = configHash_;
        distributionSalt = salt_;
        startBlock = startBlock_;
        configured = true;
        emit FundingConfigured(auction_, configHash_);
    }

    function fund(bytes calldata distributionConfig) external {
        if (msg.sender != deploymentOwner) revert Unauthorized();
        if (
            !configured || funded || block.number >= startBlock
                || keccak256(distributionConfig) != distributionConfigHash || fuel.launched()
                || fuel.balanceOf(deploymentOwner) != TOTAL_SUPPLY
                || fuel.pendingOwner() != address(this)
        ) revert FundingUnavailable();
        funded = true;
        fuel.acceptOwnership();
        require(
            fuel.transferFrom(deploymentOwner, address(this), TOTAL_SUPPLY),
            "initial supply transfer failed"
        );
        require(fuel.approve(address(permit2), TOTAL_SUPPLY), "Permit2 approval failed");
        permit2.approve(address(fuel), address(launcher), TOTAL_SUPPLY, type(uint48).max);
        bytes[] memory calls = new bytes[](2);
        calls[0] =
            abi.encodeCall(LiquidityLauncher.depositToken, (address(fuel), uint160(TOTAL_SUPPLY)));
        calls[1] = abi.encodeCall(
            LiquidityLauncher.distributeToken,
            (
                address(fuel),
                Distribution({
                    strategy: strategy, amount: TOTAL_SUPPLY, configData: distributionConfig
                }),
                distributionSalt
            )
        );
        launcher.multicall(calls);
        recovery.configureAuction(auction);
        require(
            fuel.balanceOf(address(this)) == 0 && fuel.balanceOf(address(launcher)) == 0
                && fuel.allowance(address(launcher), strategy) == 0
                && fuel.allowance(address(this), address(permit2)) == 0,
            "funding residue"
        );
        fuel.setDiscoveryExempt(deploymentOwner, false);
        fuel.transferOwnership(address(coordinator));
        coordinator.acceptFuelOwnership();
        emit AuctionFunded(auction, address(coordinator));
    }
}
