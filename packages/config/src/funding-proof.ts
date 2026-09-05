import { Schema } from "effect";
import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { createSiweMessage, parseSiweMessage } from "viem/siwe";

/**
 * Public funding requires proof that the caller controls the recipient wallet.
 * Per-recipient cooldowns alone cannot stop one actor cycling fresh addresses,
 * so the request is bound to a single-use nonce, the domain, the chain, the
 * exact recipient, the request purpose, and an expiry.
 */
export const FUNDING_PROOF_STATEMENT =
  "Prove control of this wallet to request bounded Base Sepolia test assets. This signature authorizes no transfer, approval, or protocol action.";

export const FUNDING_PROOF_NONCE_BYTES = 16;
export const FUNDING_PROOF_TTL_SECONDS = 300;
export const FUNDING_PROOF_RESOURCE = "orbit:testnet-funding";

export interface FundingProofChallenge {
  readonly domain: string;
  readonly recipient: Address;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly uri: string;
  readonly message: string;
}

export interface FundingProofChallengeInput {
  readonly chainId: number;
  readonly domain: string;
  readonly issuedAtMilliseconds: number;
  readonly nonce: string;
  readonly recipient: Address;
  readonly uri: string;
}

const nonceIsWellFormed = (nonce: string): boolean =>
  /^[0-9a-f]{32}$/u.test(nonce);

/** Builds the exact message a recipient signs. Both sides derive it here. */
export const createFundingProofChallenge = ({
  chainId,
  domain,
  issuedAtMilliseconds,
  nonce,
  recipient,
  uri,
}: FundingProofChallengeInput): FundingProofChallenge => {
  if (!nonceIsWellFormed(nonce)) {
    throw new TypeError("Funding proof nonce must be 32 lowercase hex digits");
  }
  const address = getAddress(recipient);
  if (address === zeroAddress) {
    throw new TypeError("Funding recipient must not be zero");
  }
  const issuedAt = new Date(issuedAtMilliseconds);
  const expiresAt = new Date(
    issuedAtMilliseconds + FUNDING_PROOF_TTL_SECONDS * 1_000,
  );
  const message = createSiweMessage({
    address,
    chainId,
    domain,
    expirationTime: expiresAt,
    issuedAt,
    nonce,
    resources: [FUNDING_PROOF_RESOURCE],
    statement: FUNDING_PROOF_STATEMENT,
    uri,
    version: "1",
  });
  return {
    chainId,
    domain,
    expiresAt: expiresAt.toISOString(),
    issuedAt: issuedAt.toISOString(),
    message,
    nonce,
    recipient: address,
    uri,
  };
};

const PublicFundingProofInput = Schema.Struct({
  message: Schema.String,
  signature: Schema.String,
});

export interface PublicFundingProof {
  readonly message: string;
  readonly signature: Hex;
}

const HEX_SIGNATURE = /^0x[0-9a-fA-F]+$/u;

export const decodePublicFundingProof = (
  value: unknown,
): PublicFundingProof => {
  const decoded = Schema.decodeUnknownSync(PublicFundingProofInput)(value);
  if (!HEX_SIGNATURE.test(decoded.signature)) {
    throw new TypeError("Funding proof signature must be hex");
  }
  if (decoded.message.length > 2_000) {
    throw new TypeError("Funding proof message is too large");
  }
  return {
    message: decoded.message,
    signature: decoded.signature as Hex,
  };
};

export type FundingProofRejection =
  | "malformed"
  | "domain-mismatch"
  | "chain-mismatch"
  | "recipient-mismatch"
  | "purpose-mismatch"
  | "expired"
  | "not-yet-valid";

export interface FundingProofFields {
  readonly nonce: string;
  readonly recipient: Address;
}

export interface FundingProofExpectation {
  readonly chainId: number;
  readonly domain: string;
  readonly nowMilliseconds: number;
  readonly recipient: Address;
}

export type FundingProofFieldResult =
  | { readonly ok: true; readonly fields: FundingProofFields }
  | { readonly ok: false; readonly reason: FundingProofRejection };

const parsedFields = (message: string) => {
  try {
    return parseSiweMessage(message);
  } catch {
    return undefined;
  }
};

const sameAddress = (left: string, right: string): boolean =>
  left.toLowerCase() === right.toLowerCase();

/**
 * Validates every deployment-bound field before any signature work, so a
 * tampered or replayed message is rejected without spending verification.
 */
type ParsedProof = NonNullable<ReturnType<typeof parsedFields>> & {
  readonly address: Address;
  readonly chainId: number;
  readonly domain: string;
  readonly nonce: string;
};

const completeProof = (
  parsed: ReturnType<typeof parsedFields>,
): ParsedProof | undefined => {
  if (
    parsed === undefined ||
    parsed.address === undefined ||
    parsed.nonce === undefined ||
    parsed.chainId === undefined ||
    parsed.domain === undefined ||
    !nonceIsWellFormed(parsed.nonce)
  ) {
    return undefined;
  }
  return parsed as ParsedProof;
};

/** Deployment binding: the proof must name this site, chain, and recipient. */
const bindingRejection = (
  parsed: ParsedProof,
  expectation: FundingProofExpectation,
): FundingProofRejection | undefined => {
  if (parsed.domain !== expectation.domain) return "domain-mismatch";
  if (parsed.chainId !== expectation.chainId) return "chain-mismatch";
  if (!sameAddress(parsed.address, expectation.recipient)) {
    return "recipient-mismatch";
  }
  if (
    parsed.statement !== FUNDING_PROOF_STATEMENT ||
    parsed.resources?.[0] !== FUNDING_PROOF_RESOURCE
  ) {
    return "purpose-mismatch";
  }
  return undefined;
};

/** Lifetime binding: the proof must be current, not future-dated. */
const lifetimeRejection = (
  parsed: ParsedProof,
  nowMilliseconds: number,
): FundingProofRejection | undefined => {
  if (
    parsed.expirationTime === undefined ||
    parsed.expirationTime.getTime() <= nowMilliseconds
  ) {
    return "expired";
  }
  if (
    parsed.issuedAt !== undefined &&
    parsed.issuedAt.getTime() > nowMilliseconds + 60_000
  ) {
    return "not-yet-valid";
  }
  return undefined;
};

export const verifyFundingProofFields = (
  message: string,
  expectation: FundingProofExpectation,
): FundingProofFieldResult => {
  const parsed = completeProof(parsedFields(message));
  if (parsed === undefined) return { ok: false, reason: "malformed" };
  const rejection =
    bindingRejection(parsed, expectation) ??
    lifetimeRejection(parsed, expectation.nowMilliseconds);
  if (rejection !== undefined) return { ok: false, reason: rejection };
  return {
    ok: true,
    fields: { nonce: parsed.nonce, recipient: getAddress(parsed.address) },
  };
};

export const fundingProofRejectionMessage: Readonly<
  Record<FundingProofRejection, string>
> = {
  malformed: "The wallet-control proof could not be read. Request a new one.",
  "domain-mismatch":
    "The wallet-control proof was issued for a different site. Request a new one.",
  "chain-mismatch":
    "The wallet-control proof was issued for a different network. Switch networks and request a new one.",
  "recipient-mismatch":
    "The wallet-control proof does not match the requested recipient.",
  "purpose-mismatch":
    "The signed message is not a funding wallet-control proof.",
  expired:
    "The wallet-control proof expired. Request a new one and sign again.",
  "not-yet-valid":
    "The wallet-control proof is dated in the future. Check the device clock and request a new one.",
};
