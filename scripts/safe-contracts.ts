import { parseAbi } from "viem";

/**
 * Safe v1.4.1 canonical deployments. Safe publishes these at the same address
 * on every chain it supports, so they are constants rather than configuration --
 * but a script must still confirm each one has code on the chain it is talking
 * to, because "canonical everywhere" is not the same as "deployed here".
 *
 * `SafeL2` rather than `Safe`: the L2 singleton emits the events Safe's own
 * indexing depends on, which the mainnet singleton omits to save gas.
 */
export const SAFE_PROXY_FACTORY =
  "0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67" as const;
export const SAFE_L2_SINGLETON =
  "0x29fcB43b46531BcA003ddC8FCB67FFE91900C762" as const;
export const SAFE_FALLBACK_HANDLER =
  "0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99" as const;
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;

export const safeProxyFactoryAbi = parseAbi([
  "function createProxyWithNonce(address singleton,bytes initializer,uint256 saltNonce) returns (address proxy)",
]);

export const safeAbi = parseAbi([
  "function setup(address[] owners,uint256 threshold,address to,bytes data,address fallbackHandler,address paymentToken,uint256 payment,address paymentReceiver)",
  "function getOwners() view returns (address[])",
  "function getThreshold() view returns (uint256)",
  "function VERSION() view returns (string)",
  "function nonce() view returns (uint256)",
  "function execTransaction(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,bytes signatures) returns (bool)",
]);
