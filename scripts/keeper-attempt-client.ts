import type {
  KeeperActionKind,
  KeeperAttemptFailureClass,
  KeeperAttemptOutcome,
  KeeperAttemptReceipt,
  KeeperTrack,
} from "./history-indexer/keeper-attempt-store.ts";
import {
  parseHistoryLoopbackUrl,
  parseHistoryCredential,
} from "@orbit/config/history-runtime";

interface KeeperRunIdentity {
  readonly runId: string;
  readonly observedBlock: bigint;
  readonly observedAt: bigint;
}

export interface KeeperRunStartedMilestone extends KeeperRunIdentity {
  readonly type: "run-started";
}

export interface KeeperRunCompletedMilestone extends KeeperRunIdentity {
  readonly type: "run-completed";
}

export interface KeeperAttemptMilestone {
  readonly type: "attempt-observed";
  readonly attemptId: string;
  readonly runId: string;
  readonly actionKind: KeeperActionKind;
  readonly track?: KeeperTrack;
  readonly observedBlock: bigint;
  readonly observedAt: bigint;
  readonly outcome: KeeperAttemptOutcome;
  readonly failureClass?: KeeperAttemptFailureClass;
  readonly transactionHash?: `0x${string}`;
  readonly receipt?: KeeperAttemptReceipt;
}

export interface KeeperAttemptRecorder {
  readonly startRun: (milestone: KeeperRunStartedMilestone) => Promise<void>;
  readonly observeAttempt: (milestone: KeeperAttemptMilestone) => Promise<void>;
  readonly completeRun: (
    milestone: KeeperRunCompletedMilestone,
  ) => Promise<void>;
}

interface KeeperAttemptRecorderOptions {
  readonly ingestApiToken: string;
  readonly baseUrl: string;
  readonly fetcher?: typeof fetch;
  readonly maximumAttempts?: number;
  readonly timeoutMilliseconds?: number;
}

const serializeMilestone = (milestone: unknown): string =>
  JSON.stringify(milestone, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value,
  );

const keeperAttemptEndpoint = (baseUrl: string): string => {
  return `${parseHistoryLoopbackUrl(baseUrl)}/internal/v1/keeper-attempts`;
};

const retryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

export const createKeeperAttemptRecorder = (
  options: KeeperAttemptRecorderOptions,
): KeeperAttemptRecorder => {
  const maximumAttempts = options.maximumAttempts ?? 3;
  const timeoutMilliseconds = options.timeoutMilliseconds ?? 10_000;
  if (
    !Number.isInteger(maximumAttempts) ||
    maximumAttempts < 1 ||
    maximumAttempts > 5
  ) {
    throw new RangeError("maximumAttempts must be from 1 to 5");
  }
  const fetcher = options.fetcher ?? fetch;
  const endpoint = keeperAttemptEndpoint(options.baseUrl);
  const ingestApiToken = parseHistoryCredential(
    options.ingestApiToken,
    "HISTORY_INGEST_API_TOKEN",
  );
  const post = async (milestone: unknown): Promise<void> => {
    let lastFailure = "request failed";
    for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
      try {
        const response = await fetcher(endpoint, {
          method: "POST",
          redirect: "error",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${ingestApiToken}`,
          },
          body: serializeMilestone(milestone),
          signal: AbortSignal.timeout(timeoutMilliseconds),
        });
        if (response.status === 204) return;
        lastFailure = `status ${response.status}`;
        if (!retryableStatus(response.status)) break;
      } catch {
        lastFailure = "network request failed";
      }
    }
    throw new Error(`Keeper-attempt journal ${lastFailure}`);
  };
  return {
    startRun: post,
    observeAttempt: post,
    completeRun: post,
  };
};
