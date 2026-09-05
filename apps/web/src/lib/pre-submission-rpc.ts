type ErrorRecord = Readonly<{
  cause?: unknown;
  code?: unknown;
  details?: unknown;
  message?: unknown;
  name?: unknown;
  shortMessage?: unknown;
  status?: unknown;
}>;

const deterministicErrorNames = new Set([
  "ContractFunctionRevertedError",
  "ExecutionRevertedError",
  "InvalidInputRpcError",
  "InvalidParamsRpcError",
  "InvalidRequestRpcError",
  "MethodNotFoundRpcError",
  "MethodNotSupportedRpcError",
  "ParseRpcError",
  "ResponseBodyTooLargeError",
  "TransactionRejectedRpcError",
]);

const transientErrorNames = new Set([
  "HttpRequestError",
  "InternalRpcError",
  "LimitExceededRpcError",
  "ResourceUnavailableRpcError",
  "RpcRequestError",
  "SocketClosedError",
  "TimeoutError",
  "WebSocketRequestError",
]);

const deterministicRpcCodes = new Set([
  3, -32_700, -32_600, -32_601, -32_602, -32_000, -32_001, -32_003, -32_004,
  -32_006,
]);
const transientRpcCodes = new Set([-1, 429, -32_603, -32_002, -32_005]);
const transientSystemCodes = new Set([
  "EAI_AGAIN",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const transientRpcMessage =
  /(?:bad gateway|connection (?:closed|refused|reset)|fetch failed|gateway timeout|network (?:error|failure)|over rate limit|rate.?limit|service unavailable|socket (?:closed|hang up)|temporar(?:ily|y)|timed?\s*out|too many requests)/i;

const errorRecords = (
  cause: unknown,
  depth = 0,
  seen = new Set<object>(),
): ErrorRecord[] => {
  if (depth > 6 || typeof cause !== "object" || cause === null) return [];
  if (seen.has(cause)) return [];
  seen.add(cause);
  const record = cause as ErrorRecord;
  return [record, ...errorRecords(record.cause, depth + 1, seen)];
};

const recordText = (record: ErrorRecord): string =>
  [record.message, record.shortMessage, record.details]
    .filter((value): value is string => typeof value === "string")
    .join(" ");

const hasTransientHttpStatus = (status: unknown): boolean =>
  typeof status === "number" &&
  (status === 408 || status === 429 || status >= 500);

const recordName = (record: ErrorRecord): string | undefined =>
  typeof record.name === "string" ? record.name : undefined;

const isDeterministicRecord = (record: ErrorRecord): boolean => {
  const name = recordName(record);
  return (
    (name !== undefined && deterministicErrorNames.has(name)) ||
    (typeof record.code === "number" && deterministicRpcCodes.has(record.code))
  );
};

const isTransientTransportRecord = (record: ErrorRecord): boolean => {
  const name = recordName(record);
  return (
    name === "TimeoutError" ||
    name === "SocketClosedError" ||
    name === "WebSocketRequestError"
  );
};

const isTransientHttpRecord = (record: ErrorRecord): boolean => {
  if (recordName(record) !== "HttpRequestError") return false;
  return record.status === undefined || hasTransientHttpStatus(record.status);
};

const hasTransientSystemCode = (record: ErrorRecord): boolean =>
  typeof record.code === "string" && transientSystemCodes.has(record.code);

const hasTransientRpcCode = (record: ErrorRecord): boolean =>
  typeof record.code === "number" && transientRpcCodes.has(record.code);

const hasTransientRpcMessage = (record: ErrorRecord): boolean => {
  const name = recordName(record);
  const rpcContext =
    (name !== undefined && transientErrorNames.has(name)) ||
    typeof record.code === "number";
  return rpcContext && transientRpcMessage.test(recordText(record));
};

const isTransientRecord = (record: ErrorRecord): boolean => {
  if (isTransientTransportRecord(record)) return true;
  if (isTransientHttpRecord(record)) return true;
  if (hasTransientSystemCode(record)) return true;
  if (hasTransientRpcCode(record)) return true;
  return hasTransientRpcMessage(record);
};

export const isTransientPreSubmissionRpcFailure = (cause: unknown): boolean => {
  const records = errorRecords(cause);
  if (records.some(isDeterministicRecord)) return false;
  return records.some(isTransientRecord);
};

const PRE_SUBMISSION_RETRY_DELAY_MILLISECONDS = 250;

export const retryPreSubmissionPublicRpc = async <Value>({
  assertActive,
  request,
}: {
  readonly assertActive: () => void;
  readonly request: () => Promise<Value>;
}): Promise<Value> => {
  assertActive();
  try {
    const value = await request();
    assertActive();
    return value;
  } catch (cause) {
    if (!isTransientPreSubmissionRpcFailure(cause)) throw cause;
    assertActive();
  }
  // The transaction transport already permits seven wire attempts. One outer
  // retry caps this pre-submission read at fourteen without ever retrying the
  // wallet submission or any post-hash operation.
  await new Promise((resolve) =>
    setTimeout(resolve, PRE_SUBMISSION_RETRY_DELAY_MILLISECONDS),
  );
  assertActive();
  const value = await request();
  assertActive();
  return value;
};
