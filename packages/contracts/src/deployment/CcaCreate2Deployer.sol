// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Explicit CREATE2 origin for mined launch contracts across script and broadcast execution.
/// @dev Creation code is supplied as calldata so this deployer stays below the EIP-170 size limit.
contract CcaCreate2Deployer {
    address public immutable deploymentAuthority;

    error Unauthorized();
    error DeploymentFailed();

    constructor(address authority) {
        require(authority != address(0), "zero authority");
        deploymentAuthority = authority;
    }

    function deploy(bytes32 salt, bytes calldata creationCode) external returns (address deployed) {
        if (msg.sender != deploymentAuthority) revert Unauthorized();
        bytes memory code = creationCode;
        assembly ("memory-safe") { deployed := create2(0, add(code, 32), mload(code), salt) }
        if (deployed == address(0)) revert DeploymentFailed();
    }
}
