import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";
import {
  decodeErrorResult,
  encodeErrorResult,
  parseAbi,
  UserRejectedRequestError,
  type Hex,
} from "viem";

export interface DomainProtocolError {
  code: string;
  message: string;
}

const discoveryErrorAbi = parseAbi([
  "error DiscoveryMutationLimitExceeded(uint256 requested,uint256 maximum)",
  "error WrappedError(address target,bytes4 selector,bytes reason,bytes details)",
]);
const maximumErrorTraversalDepth = 8;
const maximumErrorTraversalNodes = 32;
const maximumDomainErrorMessageCharacters = 512;
const maximumProtocolOperationCharacters = 256;
const maximumRevertDataCharacters = 8_194;
const maximumWrappedErrorDepth = 4;
const maximumUint256 = (1n << 256n) - 1n;
const chainIdDecimalPattern = /^(?:0|[1-9][0-9]{0,15})$/u;
const revertDataPattern = /^0x[0-9a-fA-F]*$/u;
const uint256DecimalPattern = /^(?:0|[1-9][0-9]{0,77})$/u;

interface DiscoveryMutationLimit {
  readonly maximum: bigint;
  readonly requested: bigint;
}

interface ErrorTraversalState {
  readonly seen: Set<object>;
  visited: number;
}

interface ExactDecodedError {
  readonly data: Hex;
  readonly decoded: ReturnType<typeof decodeErrorResult>;
}

interface WrappedErrorArguments {
  readonly details: Hex;
  readonly reason: Hex;
  readonly selector: Hex;
  readonly target: Hex;
}

type DomainErrorDefinition = readonly [
  needle: string,
  code: string,
  message: string,
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const boundedNonEmptyString = (
  value: unknown,
  maximumCharacters: number,
): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= maximumCharacters;

const canonicalUint256 = (value: unknown): bigint | undefined => {
  if (typeof value !== "string" || !uint256DecimalPattern.test(value)) {
    return undefined;
  }
  const parsed = BigInt(value);
  return parsed <= maximumUint256 ? parsed : undefined;
};

const canonicalChainId = (value: unknown): number | undefined => {
  if (typeof value !== "string" || !chainIdDecimalPattern.test(value)) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
};

const canonicalDiscoveryDomainError = (
  code: string,
  message: string,
  liquidTokenName: string,
): DomainProtocolError | undefined => {
  if (code !== "discovery-mutation-limit") return undefined;
  const prefix = "This trade crosses ";
  const separator =
    " whole-unit discovery boundaries, but one transfer can cross at most ";
  const suffix = `. Reduce the ${liquidTokenName} amount and request a new quote.`;
  if (!message.startsWith(prefix) || !message.endsWith(suffix)) {
    return undefined;
  }
  const boundary = message.slice(prefix.length, -suffix.length);
  const parts = boundary.split(separator);
  if (parts.length !== 2) return undefined;
  const requested = canonicalUint256(parts[0]);
  const maximum = canonicalUint256(parts[1]);
  if (
    requested === undefined ||
    maximum === undefined ||
    requested <= maximum
  ) {
    return undefined;
  }
  return { code: "discovery-mutation-limit", message };
};

const canonicalWrongChainDomainError = (
  code: string,
  message: string,
): DomainProtocolError | undefined => {
  if (code !== "wrong-chain") return undefined;
  const match = /^Expected chain ([0-9]+), received ([0-9]+)\.$/u.exec(message);
  if (match === null) return undefined;
  const expected = canonicalChainId(match[1]);
  const observed = canonicalChainId(match[2]);
  if (
    expected === undefined ||
    observed === undefined ||
    expected <= 0 ||
    expected === observed
  ) {
    return undefined;
  }
  return { code: "wrong-chain", message };
};

const protocolQueryDomainPayload = (
  cause: unknown,
): DomainProtocolError | undefined => {
  if (!isRecord(cause)) return undefined;
  if (cause.name !== "ProtocolQueryError") return undefined;
  if (
    !boundedNonEmptyString(cause.operation, maximumProtocolOperationCharacters)
  ) {
    return undefined;
  }
  const domainError = cause.domainError;
  if (!isRecord(domainError)) return undefined;
  const code = domainError.code;
  const message = domainError.message;
  if (!boundedNonEmptyString(code, 64)) return undefined;
  if (!boundedNonEmptyString(message, maximumDomainErrorMessageCharacters)) {
    return undefined;
  }
  return cause.message === message ? { code, message } : undefined;
};

const canonicalDomainErrorFromProtocolQuery = (
  cause: unknown,
  domainErrors: ReadonlyArray<DomainErrorDefinition>,
  liquidTokenName: string,
): DomainProtocolError | undefined => {
  const domainError = protocolQueryDomainPayload(cause);
  if (domainError === undefined) return undefined;
  const canonical = domainErrors.find(
    ([, code, message]) =>
      code === domainError.code && message === domainError.message,
  );
  if (canonical !== undefined) {
    return { code: canonical[1], message: canonical[2] };
  }
  return (
    canonicalDiscoveryDomainError(
      domainError.code,
      domainError.message,
      liquidTokenName,
    ) ?? canonicalWrongChainDomainError(domainError.code, domainError.message)
  );
};

const collectErrorSignals = (
  cause: unknown,
  depth = 0,
  seen = new Set<object>(),
): string => {
  if (depth > maximumErrorTraversalDepth) return "";
  if (typeof cause === "string") return cause;
  if (typeof cause !== "object" || cause === null) return "";
  if (seen.has(cause)) return "";
  seen.add(cause);
  const record = cause as Record<string, unknown>;
  const ownSignals = [record.shortMessage, record.errorName]
    .filter((signal): signal is string => typeof signal === "string")
    .join(" ");
  return [
    ownSignals,
    collectErrorSignals(record.data, depth + 1, seen),
    collectErrorSignals(record.cause, depth + 1, seen),
  ].join(" ");
};

const boundedHex = (value: unknown, minimumCharacters = 2): value is Hex =>
  typeof value === "string" &&
  value.length >= minimumCharacters &&
  value.length <= maximumRevertDataCharacters &&
  value.length % 2 === 0 &&
  revertDataPattern.test(value);

const sameBytes = (left: Hex, right: Hex): boolean =>
  left.toLowerCase() === right.toLowerCase();

const decodeExactError = (value: unknown): ExactDecodedError | undefined => {
  if (!boundedHex(value, 10)) return undefined;
  try {
    return {
      data: value,
      decoded: decodeErrorResult({ abi: discoveryErrorAbi, data: value }),
    };
  } catch {
    return undefined;
  }
};

const discoveryArguments = (
  decoded: ReturnType<typeof decodeErrorResult>,
): DiscoveryMutationLimit | undefined => {
  if (decoded.errorName !== "DiscoveryMutationLimitExceeded") return undefined;
  const args = Array.isArray(decoded.args) ? decoded.args : [];
  if (args.length !== 2) return undefined;
  const [requested, maximum] = args;
  if (typeof requested !== "bigint") return undefined;
  if (typeof maximum !== "bigint") return undefined;
  return requested > maximum ? { maximum, requested } : undefined;
};

const exactDiscoveryLimit = (
  candidate: ExactDecodedError,
): DiscoveryMutationLimit | undefined => {
  const limit = discoveryArguments(candidate.decoded);
  if (limit === undefined) return undefined;
  const reencoded = encodeErrorResult({
    abi: discoveryErrorAbi,
    errorName: "DiscoveryMutationLimitExceeded",
    args: [limit.requested, limit.maximum],
  });
  return sameBytes(candidate.data, reencoded) ? limit : undefined;
};

const fixedHex = (value: unknown, characters: number): value is Hex =>
  boundedHex(value, characters) && value.length === characters;

const wrappedArguments = (
  decoded: ReturnType<typeof decodeErrorResult>,
): WrappedErrorArguments | undefined => {
  if (decoded.errorName !== "WrappedError") return undefined;
  const args = Array.isArray(decoded.args) ? decoded.args : [];
  if (args.length !== 4) return undefined;
  const [target, selector, reason, details] = args;
  if (!fixedHex(target, 42)) return undefined;
  if (!fixedHex(selector, 10)) return undefined;
  if (!boundedHex(reason, 10)) return undefined;
  if (!boundedHex(details)) return undefined;
  return { details, reason, selector, target };
};

const exactWrappedReason = (candidate: ExactDecodedError): Hex | undefined => {
  const wrapped = wrappedArguments(candidate.decoded);
  if (wrapped === undefined) return undefined;
  const reencoded = encodeErrorResult({
    abi: discoveryErrorAbi,
    errorName: "WrappedError",
    args: [wrapped.target, wrapped.selector, wrapped.reason, wrapped.details],
  });
  return sameBytes(candidate.data, reencoded) ? wrapped.reason : undefined;
};

function decodeDiscoveryMutationLimit(
  value: unknown,
  wrappedDepth = 0,
): DiscoveryMutationLimit | undefined {
  const candidate = decodeExactError(value);
  if (candidate === undefined) return undefined;
  const direct = exactDiscoveryLimit(candidate);
  if (direct !== undefined) return direct;
  if (wrappedDepth >= maximumWrappedErrorDepth) return undefined;
  const reason = exactWrappedReason(candidate);
  return reason === undefined
    ? undefined
    : decodeDiscoveryMutationLimit(reason, wrappedDepth + 1);
}

function findDiscoveryInChildren(
  record: Record<string, unknown>,
  depth: number,
  state: ErrorTraversalState,
): DiscoveryMutationLimit | undefined {
  for (const child of [record.data, record.raw, record.cause]) {
    const result = findDiscoveryMutationLimit(child, depth, state);
    if (result !== undefined) return result;
  }
  return undefined;
}

function findDiscoveryMutationLimit(
  cause: unknown,
  depth = 0,
  state: ErrorTraversalState = { seen: new Set<object>(), visited: 0 },
): DiscoveryMutationLimit | undefined {
  if (
    depth > maximumErrorTraversalDepth ||
    typeof cause !== "object" ||
    cause === null ||
    state.seen.has(cause)
  ) {
    return undefined;
  }
  state.seen.add(cause);
  state.visited += 1;
  if (state.visited > maximumErrorTraversalNodes) return undefined;
  const record = cause as Record<string, unknown>;
  const direct =
    decodeDiscoveryMutationLimit(record.data) ??
    decodeDiscoveryMutationLimit(record.raw);
  if (direct !== undefined) return direct;
  return findDiscoveryInChildren(record, depth + 1, state);
}

/**
 * The mirror's `UnknownIdentity(identityId)` revert is the collection's way of
 * saying an identity has never been discovered. It is a definite observation,
 * not a read failure, so it is matched by exact revert bytes: any other revert
 * data, and any transport failure, stays a failure.
 */
const unknownIdentityErrorAbi = parseAbi([
  "error UnknownIdentity(uint256 identityId)",
]);

const ownRevertData = (
  record: Record<string, unknown>,
  matches: (data: Hex) => boolean,
): boolean =>
  [record.data, record.raw].some(
    (value) => boundedHex(value, 10) && matches(value),
  );

function findRevertData(
  cause: unknown,
  matches: (data: Hex) => boolean,
  depth = 0,
  state: ErrorTraversalState = { seen: new Set<object>(), visited: 0 },
): boolean {
  if (
    depth > maximumErrorTraversalDepth ||
    typeof cause !== "object" ||
    cause === null ||
    state.seen.has(cause)
  ) {
    return false;
  }
  state.seen.add(cause);
  state.visited += 1;
  if (state.visited > maximumErrorTraversalNodes) return false;
  const record = cause as Record<string, unknown>;
  if (ownRevertData(record, matches)) return true;
  return [record.data, record.raw, record.cause].some((child) =>
    findRevertData(child, matches, depth + 1, state),
  );
}

export const isUnknownIdentityRevert = (
  cause: unknown,
  identityId: number,
): boolean => {
  if (!Number.isSafeInteger(identityId) || identityId < 0) return false;
  try {
    const expected = encodeErrorResult({
      abi: unknownIdentityErrorAbi,
      errorName: "UnknownIdentity",
      args: [BigInt(identityId)],
    });
    return findRevertData(cause, (data) => sameBytes(data, expected));
  } catch {
    return false;
  }
};

const discoveryMutationLimitMessage = (
  limit: DiscoveryMutationLimit,
  liquidTokenName: string,
): string => {
  const boundary = `This trade crosses ${limit.requested.toString()} whole-unit discovery boundaries, but one transfer can cross at most ${limit.maximum.toString()}.`;
  return `${boundary} Reduce the ${liquidTokenName} amount and request a new quote.`;
};

const isWalletRequestRejected = (cause: unknown): boolean => {
  for (
    let depth = 0;
    depth <= maximumErrorTraversalDepth && isRecord(cause);
    depth += 1
  ) {
    if (cause.code === UserRejectedRequestError.code) return true;
    cause = cause.cause;
  }
  return false;
};

export const normalizeProtocolError = (
  cause: unknown,
  identity: IdentityConfiguration,
): DomainProtocolError => {
  const copy = createIdentityProtocolCopy(identity).errors;
  const domainErrors: ReadonlyArray<DomainErrorDefinition> = [
    ["TradingLocked", "trading-locked", copy.tradingLocked],
    ["NotIdentityOwner", "invalid-ownership", copy.invalidOwnership],
    ["ClaimDenied", "claim-denied", copy.claimDenied],
    ["ClaimBatchTooLarge", "claim-batch-too-large", copy.claimBatchTooLarge],
    ["RewardNotificationsArePaused", "rewards-paused", copy.rewardsPaused],
    ["Paused", "module-paused", copy.modulePaused],
    ["FrozenAccount", "account-frozen", copy.accountFrozen],
    ["UnauthorizedKeeper", "unsupported-role", copy.unauthorizedKeeper],
    ["UnauthorizedExecutor", "unsupported-role", copy.unauthorizedExecutor],
    ["UnauthorizedOwner", "unsupported-role", copy.unauthorizedOwner],
    ["ConfigurationAlreadySealed", "sealed-mutation", copy.configurationSealed],
    ["EmptyTrackQueue", "empty-track-queue", copy.emptyTrackQueue],
    ["RewardEpochIntervalPending", "epoch-interval-pending", copy.epochPending],
    [
      "RewardPotBelowMinimum",
      "reward-pot-below-minimum",
      copy.rewardPotBelowMinimum,
    ],
    ["DeadlineExpired", "deadline-expired", copy.deadlineExpired],
  ];
  const rpcFailure = {
    code: "rpc-failure",
    message: copy.rpcFailure,
  };
  try {
    if (isWalletRequestRejected(cause)) {
      return { code: "wallet-rejected", message: copy.walletRejected };
    }
    const preserved = canonicalDomainErrorFromProtocolQuery(
      cause,
      domainErrors,
      identity.liquidToken.displayName,
    );
    if (preserved !== undefined) return preserved;
    const text = collectErrorSignals(cause);
    const discoveryMutationLimit = findDiscoveryMutationLimit(cause);
    if (discoveryMutationLimit !== undefined) {
      return {
        code: "discovery-mutation-limit",
        message: discoveryMutationLimitMessage(
          discoveryMutationLimit,
          identity.liquidToken.displayName,
        ),
      };
    }
    const known = domainErrors.find(([needle]) => text.includes(needle));
    if (known !== undefined) {
      return { code: known[1], message: known[2] };
    }
  } catch {
    return rpcFailure;
  }
  return rpcFailure;
};
