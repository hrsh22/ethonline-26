import type { TransactionState } from "./transaction-state";

export type SubmittedTransactionPhase =
  { readonly kind: "action" } | { readonly kind: "approval" };

export interface PreparedCollectorCall {
  readonly chainId: number;
  readonly from: `0x${string}`;
  readonly to: `0x${string}`;
  readonly dataHash: `0x${string}`;
  readonly value: string;
  readonly afterBlock: string;
}

export interface CollectorTransactionMetadata {
  readonly preparedCall?: PreparedCollectorCall;
  readonly recoveredHash?: `0x${string}`;

  readonly operationId: string;
  readonly identityIds: readonly number[];
  readonly affectedIdentityIds: readonly number[];
  readonly actionType: string;
  readonly createdAt: number;
}

interface CollectorTransactionRecord extends CollectorTransactionMetadata {
  readonly version: 1;
  readonly state: TransactionState;
  readonly phase: SubmittedTransactionPhase;
  readonly savedAt: number;
}

export type CompletedCollectorTransaction = CollectorTransactionRecord & {
  readonly state: Extract<TransactionState, { status: "confirmed" }>;
};
const completedKeyFor = (scope: string) =>
  `orbit:collector-completed:v1:${scope}`;

const keyFor = (scope: string) => `orbit:collector-transaction:v1:${scope}`;
const validIds = (ids: unknown): ids is readonly number[] =>
  Array.isArray(ids) &&
  ids.length <= 64 &&
  ids.every(
    (id: unknown) =>
      typeof id === "number" &&
      Number.isSafeInteger(id) &&
      id >= 1 &&
      id <= 4444,
  );
const hashPattern = /^0x[0-9a-fA-F]{64}$/u;

/** One latest operation per wallet/deployment. This is a receipt bookmark,
 * never a stored action that can authorize or repeat a wallet submission. */
export const writeCollectorTransaction = (
  scope: string,
  state: TransactionState,
  phase: SubmittedTransactionPhase | undefined,
  metadata: CollectorTransactionMetadata,
  start = false,
): boolean => {
  try {
    const storage = window.localStorage;
    const record: CollectorTransactionRecord = {
      ...metadata,
      version: 1,
      state,
      phase: phase ?? { kind: "action" },
      savedAt: Date.now(),
    };
    const existing = storage.getItem(keyFor(scope));
    if (ignoreLateRecoveryWrite(existing, metadata, start)) return true;
    if (
      !start &&
      existing !== null &&
      JSON.parse(existing).operationId !== metadata.operationId
    ) {
      rememberCompletedTransaction(scope, record);
      return true;
    }
    storage.setItem(
      keyFor(scope),
      JSON.stringify({ ...record, state: persistedTransactionState(state) }),
    );
    rememberCompletedTransaction(scope, record);
    return true;
  } catch {
    return false;
  }
};

const validTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const validText = (value: unknown, pattern: RegExp): value is string =>
  typeof value === "string" && pattern.test(value);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const validPreparedCall = (value: unknown): value is PreparedCollectorCall =>
  isObject(value) &&
  validTime(value.chainId) &&
  value.chainId > 0 &&
  validText(value.from, /^0x[0-9a-fA-F]{40}$/u) &&
  validText(value.to, /^0x[0-9a-fA-F]{40}$/u) &&
  validText(value.dataHash, hashPattern) &&
  validText(value.value, /^(0|[1-9][0-9]{0,77})$/u) &&
  validText(value.afterBlock, /^(0|[1-9][0-9]{0,19})$/u);

const validMetadata = (value: Record<string, unknown>): boolean =>
  validText(value.operationId, /^[a-zA-Z0-9-]{1,80}$/u) &&
  validText(value.actionType, /^[a-z-]{1,64}$/u) &&
  validIds(value.identityIds) &&
  validIds(value.affectedIdentityIds) &&
  validTime(value.createdAt);

const restoreReceipt = (
  value: Record<string, unknown>,
  label: string,
): TransactionState | undefined => {
  if (!validText(value.hash, hashPattern)) return;
  const hash = value.hash as `0x${string}`;
  switch (value.status) {
    case "submitted":
    case "outcome-unknown": {
      const replacement = value.replacement;
      if (
        replacement !== undefined &&
        replacement !== "cancelled" &&
        replacement !== "replaced"
      )
        return;
      return {
        status: "outcome-unknown",
        label,
        hash,
        message:
          "Checking the submitted transaction automatically. No new wallet action is needed.",
        ...(replacement === undefined ? {} : { replacement }),
      };
    }
    case "confirmed":
      return { status: "confirmed", label, hash };
    case "failed":
      return {
        status: "failed",
        label,
        hash,
        message:
          "This transaction did not complete. Check its onchain record before reviewing another action.",
      };
    default:
      return;
  }
};

const restoreState = (value: unknown): TransactionState | undefined => {
  if (!isObject(value)) return;
  if (value.status === "idle" || value.status === "pending")
    return { status: "idle" };
  if (typeof value.label !== "string" || value.label.length > 256) return;
  if (value.status === "simulated" || value.status === "submission-unknown")
    return {
      status: "submission-unknown",
      label: value.label,
      message:
        "The app closed while waiting for your wallet. Check your wallet activity before trying again; no transaction hash was received.",
    };
  return restoreReceipt(value, value.label);
};

const validEnvelope = (
  value: unknown,
): value is Record<string, unknown> & {
  savedAt: number;
  phase: Record<string, unknown>;
} =>
  isObject(value) &&
  value.version === 1 &&
  validTime(value.savedAt) &&
  isObject(value.phase) &&
  validMetadata(value);

const parseCollectorRecord = (
  value: unknown,
): CollectorTransactionRecord | undefined => {
  try {
    if (!validEnvelope(value)) return;
    const kind = value.phase.kind;
    if (kind !== "action" && kind !== "approval") return;
    let state = restoreState(value.state);
    if (state === undefined) return;
    if (kind === "approval" && state.status === "confirmed")
      state = {
        ...state,
        message:
          "Approval confirmed. Review the trade again; no exchange was submitted.",
      };
    return {
      version: 1,
      state,
      phase: { kind },
      savedAt: value.savedAt,
      operationId: value.operationId as string,
      identityIds: value.identityIds as number[],
      affectedIdentityIds: value.affectedIdentityIds as number[],
      actionType: value.actionType as string,
      createdAt: value.createdAt as number,
      ...(validText(value.recoveredHash, hashPattern)
        ? { recoveredHash: value.recoveredHash as `0x${string}` }
        : {}),
      ...(validPreparedCall(value.preparedCall)
        ? { preparedCall: value.preparedCall }
        : {}),
    };
  } catch {
    return undefined;
  }
};

export const readCollectorTransaction = (
  scope: string,
): CollectorTransactionRecord | undefined => {
  try {
    const raw = window.localStorage.getItem(keyFor(scope));
    if (raw === null || raw.length > 4096) return;
    return parseCollectorRecord(JSON.parse(raw));
  } catch {
    return undefined;
  }
};

export const readCompletedCollectorTransactions = (
  scope: string,
): readonly CompletedCollectorTransaction[] => {
  try {
    const raw = window.localStorage.getItem(completedKeyFor(scope));
    if (raw === null || raw.length > 81920) return [];
    const values: unknown = JSON.parse(raw);
    if (!Array.isArray(values) || values.length > 20) return [];
    return values
      .map(parseCollectorRecord)
      .filter(
        (record): record is CompletedCollectorTransaction =>
          record?.state.status === "confirmed" &&
          record.phase.kind === "action",
      );
  } catch {
    return [];
  }
};

const rememberCompletedTransaction = (
  scope: string,
  record: CollectorTransactionRecord,
): void => {
  if (record.state.status !== "confirmed" || record.phase.kind !== "action")
    return;
  // ponytail: the latest 20 completed actions stay on this device; an explorer provides older history.
  const completed = readCompletedCollectorTransactions(scope).filter(
    (previous) => previous.operationId !== record.operationId,
  );
  window.localStorage.setItem(
    completedKeyFor(scope),
    JSON.stringify([...completed, record].slice(-20)),
  );
};

/** A late SDK completion cannot replace a manually recovered operation's proof. */
export const isObsoleteRecoveryCallback = (
  incoming: CollectorTransactionMetadata | undefined,
  current: CollectorTransactionMetadata | undefined,
): boolean =>
  current?.recoveredHash !== undefined &&
  incoming?.operationId === current.operationId &&
  incoming?.recoveredHash !== current.recoveredHash;

function ignoreLateRecoveryWrite(
  existing: string | null,
  metadata: CollectorTransactionMetadata,
  start: boolean,
): boolean {
  if (start || existing === null) return false;
  const saved = JSON.parse(existing) as Record<string, unknown>;
  return (
    saved.operationId === metadata.operationId &&
    validText(saved.recoveredHash, hashPattern) &&
    saved.recoveredHash !== metadata.recoveredHash
  );
}

const persistedTransactionState = (
  state: TransactionState,
): TransactionState =>
  (state.status === "failed" || state.status === "retriable") &&
  state.hash === undefined
    ? { status: "idle" }
    : state;
