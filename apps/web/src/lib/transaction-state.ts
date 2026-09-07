export type TransactionState =
  | { readonly status: "idle" }
  | { readonly status: "pending"; readonly label: string }
  | { readonly status: "simulated"; readonly label: string }
  | {
      readonly status: "submission-unknown";
      readonly label: string;
      readonly message: string;
    }
  | {
      readonly status: "submitted";
      readonly label: string;
      readonly hash: `0x${string}`;
      readonly replacement?: "cancelled" | "replaced";
    }
  | {
      readonly status: "confirmed";
      readonly label: string;
      readonly hash: `0x${string}`;
      readonly message?: string;
    }
  | {
      readonly status: "outcome-unknown";
      readonly label: string;
      readonly message: string;
      readonly hash: `0x${string}`;
      readonly reconciling?: boolean;
      readonly replacement?: "cancelled" | "replaced";
    }
  | {
      readonly status: "failed" | "retriable";
      readonly label: string;
      readonly message: string;
      readonly hash?: `0x${string}`;
    };

export type TransactionEvent =
  | { readonly type: "prepare"; readonly label: string }
  | { readonly type: "simulate" }
  | { readonly type: "submit"; readonly hash: `0x${string}` }
  | {
      readonly type: "replace";
      readonly hash: `0x${string}`;
      readonly reason: "repriced" | "cancelled" | "replaced";
    }
  | { readonly type: "confirm" }
  | {
      readonly type: "fail";
      readonly message: string;
      readonly retriable: boolean;
    }
  | { readonly type: "retry" };

export const createTransactionState = (): TransactionState => ({
  status: "idle",
});

const simulate = (state: TransactionState): TransactionState =>
  state.status === "pending"
    ? { status: "simulated", label: state.label }
    : state;

const submit = (
  state: TransactionState,
  hash: `0x${string}`,
): TransactionState =>
  state.status === "simulated"
    ? { status: "submitted", label: state.label, hash }
    : state;

const confirm = (state: TransactionState): TransactionState =>
  state.status === "submitted" || state.status === "outcome-unknown"
    ? { status: "confirmed", label: state.label, hash: state.hash }
    : state;

const receiptHash = (state: TransactionState) =>
  state.status === "submitted" || state.status === "outcome-unknown"
    ? { hash: state.hash }
    : {};

const fail = (
  state: TransactionState,
  event: Extract<TransactionEvent, { type: "fail" }>,
): TransactionState =>
  state.status === "idle" || state.status === "confirmed"
    ? state
    : event.retriable &&
        (state.status === "outcome-unknown" || state.status === "submitted")
      ? {
          status: "outcome-unknown",
          label: state.label,
          message: event.message,
          hash: state.hash,
          ...(state.replacement === undefined
            ? {}
            : { replacement: state.replacement }),
        }
      : {
          status: event.retriable ? "retriable" : "failed",
          label: state.label,
          message: event.message,
          ...receiptHash(state),
        };

const retry = (state: TransactionState): TransactionState =>
  state.status === "retriable"
    ? { status: "pending", label: state.label }
    : state;

const replace = (
  state: TransactionState,
  event: Extract<TransactionEvent, { type: "replace" }>,
): TransactionState =>
  state.status === "submitted" || state.status === "outcome-unknown"
    ? {
        ...state,
        hash: event.hash,
        ...(event.reason === "repriced" ? {} : { replacement: event.reason }),
      }
    : state;

export const advanceTransaction = (
  state: TransactionState,
  event: TransactionEvent,
): TransactionState => {
  switch (event.type) {
    case "prepare":
      return { status: "pending", label: event.label };
    case "simulate":
      return simulate(state);
    case "submit":
      return submit(state, event.hash);
    case "replace":
      return replace(state, event);
    case "confirm":
      return confirm(state);
    case "fail":
      return fail(state, event);
    case "retry":
      return retry(state);
  }
};

export const isTransactionInFlight = (state: TransactionState): boolean =>
  state.status === "pending" ||
  state.status === "simulated" ||
  state.status === "submitted" ||
  state.status === "submission-unknown" ||
  state.status === "outcome-unknown";
