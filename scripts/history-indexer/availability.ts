export interface HistoryAvailabilityFailure {
  readonly code: string;
  readonly message: string;
}

export type HistoryAvailabilitySnapshot =
  | { readonly state: "ready" }
  | ({ readonly state: "error" } & HistoryAvailabilityFailure);

export interface HistoryAvailability {
  readonly read: () => HistoryAvailabilitySnapshot;
  readonly markReady: () => void;
  readonly markFailed: (failure: HistoryAvailabilityFailure) => void;
}

export const createHistoryAvailability = (): HistoryAvailability => {
  let snapshot: HistoryAvailabilitySnapshot = {
    state: "error",
    code: "history-not-synchronized",
    message: "Indexed history has not completed its initial synchronization",
  };
  return {
    read: () => snapshot,
    markReady: () => {
      snapshot = { state: "ready" };
    },
    markFailed: (failure) => {
      snapshot = { state: "error", ...failure };
    },
  };
};
