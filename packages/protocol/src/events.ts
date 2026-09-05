import {
  createIdentityProtocolCopy,
  type IdentityConfiguration,
} from "@orbit/config/identity";

import type { OperationalEvent } from "./reader.js";

const operationTypes = [
  "reward-epoch",
  "conversion",
  "retry",
  "claim",
  "pol-execution",
] as const;

type Track = 1 | 2 | 3 | 4;
type TrackState = "fresh" | "retryable" | "unknown";
type TrackCoverage = {
  fromBlock: bigint;
  completeFromStart: boolean;
  truncated: boolean;
  truncatedAt?: bigint;
  initialTrackState?: Readonly<Record<Track, TrackState>>;
};

const tracks = [1, 2, 3, 4] as const;

const initialStateForTrack = (
  track: Track,
  coverage: TrackCoverage,
): TrackState => {
  if (coverage.truncated) return "unknown";
  return (
    coverage.initialTrackState?.[track] ??
    (coverage.completeFromStart ? "fresh" : "unknown")
  );
};

const createInitialTrackState = (
  coverage: TrackCoverage,
): Record<Track, TrackState> =>
  Object.fromEntries(
    tracks.map((track) => [track, initialStateForTrack(track, coverage)]),
  ) as Record<Track, TrackState>;

const isOutsideKnownCoverage = (
  event: OperationalEvent,
  coverage: TrackCoverage,
): boolean =>
  event.blockNumber < coverage.fromBlock ||
  (coverage.truncated &&
    (coverage.truncatedAt === undefined ||
      event.blockNumber <= coverage.truncatedAt));

const classifyTrackEvent = (
  event: OperationalEvent,
  coverage: TrackCoverage,
  trackState: Record<Track, TrackState>,
  copy: ReturnType<typeof createIdentityProtocolCopy>["events"],
): OperationalEvent => {
  if (event.type !== "track-execution" || event.track === undefined) {
    return event;
  }
  if (isOutsideKnownCoverage(event, coverage)) {
    return {
      ...event,
      type: "track-execution-unknown",
      explanation: copy.trackAttemptUnknown,
    };
  }
  const priorState = trackState[event.track];
  trackState[event.track] = event.successful ? "fresh" : "retryable";
  if (priorState === "unknown") {
    return {
      ...event,
      type: "track-execution-unknown",
      explanation: copy.trackAttemptUnknown,
    };
  }
  const retry = priorState === "retryable";
  const explanation = retry
    ? event.successful
      ? copy.retrySucceeded
      : copy.retryFailed
    : event.successful
      ? copy.conversionSucceeded
      : copy.initialConversionFailed;
  return {
    ...event,
    type: retry ? "retry" : "conversion",
    explanation,
  };
};

export const classifyTrackAttempts = (
  events: readonly OperationalEvent[],
  identity: IdentityConfiguration,
  coverage: TrackCoverage = {
    fromBlock: 0n,
    completeFromStart: true,
    truncated: false,
  },
): OperationalEvent[] => {
  const copy = createIdentityProtocolCopy(identity).events;
  const trackState = createInitialTrackState(coverage);
  return [...events]
    .sort(
      (left, right) =>
        Number(left.blockNumber - right.blockNumber) ||
        (left.transactionIndex ?? 0) - (right.transactionIndex ?? 0),
    )
    .map((event) => classifyTrackEvent(event, coverage, trackState, copy));
};

export const retainOperationalSummaryEvents = (
  events: readonly OperationalEvent[],
  limit: number,
): OperationalEvent[] => {
  if (limit <= 0) return [];
  const seenTransactions = new Set<string>();
  const sorted = [...events]
    .sort(
      (left, right) =>
        Number(right.blockNumber - left.blockNumber) ||
        (right.transactionIndex ?? 0) - (left.transactionIndex ?? 0),
    )
    .filter((event) => {
      const key = `${event.type}:${event.transactionHash}`;
      if (seenTransactions.has(key)) return false;
      seenTransactions.add(key);
      return true;
    });
  const summaryKeys = new Set<string>();
  const selected = sorted.filter((event) => {
    const trackKey =
      event.type === "conversion" || event.type === "retry"
        ? `:${event.track ?? "unknown-track"}`
        : "";
    const key = `${event.type}${trackKey}:${event.successful ? "success" : "failure"}`;
    if (summaryKeys.has(key)) return false;
    summaryKeys.add(key);
    return true;
  });
  for (const event of sorted) {
    if (selected.length >= limit) break;
    if (!selected.includes(event)) selected.push(event);
  }
  return selected
    .sort(
      (left, right) =>
        Number(right.blockNumber - left.blockNumber) ||
        (right.transactionIndex ?? 0) - (left.transactionIndex ?? 0),
    )
    .slice(0, limit);
};

export const summarizeOperationalEvents = (
  events: readonly OperationalEvent[],
) =>
  Object.fromEntries(
    operationTypes.map((type) => {
      const matching = events
        .filter((event) => event.type === type)
        .sort((left, right) => Number(right.blockNumber - left.blockNumber));
      return [
        type,
        {
          lastSuccessful: matching.find((event) => event.successful),
          lastFailed: matching.find((event) => !event.successful),
        },
      ];
    }),
  ) as Record<
    (typeof operationTypes)[number],
    {
      lastSuccessful: OperationalEvent | undefined;
      lastFailed: OperationalEvent | undefined;
    }
  >;

export const summarizeTrackOutcomes = (events: readonly OperationalEvent[]) =>
  Object.fromEntries(
    ([1, 2, 3, 4] as const).map((track) => [
      track,
      {
        latest: [...events]
          .filter(
            (event) =>
              event.track === track &&
              (event.type === "conversion" || event.type === "retry"),
          )
          .sort(
            (left, right) =>
              Number(right.blockNumber - left.blockNumber) ||
              (right.transactionIndex ?? 0) - (left.transactionIndex ?? 0),
          )[0],
      },
    ]),
  ) as Record<1 | 2 | 3 | 4, { readonly latest: OperationalEvent | undefined }>;
