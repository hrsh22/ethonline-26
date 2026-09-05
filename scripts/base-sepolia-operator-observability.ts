import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, join } from "node:path";

import { Schema } from "effect";

export const DEFAULT_POL_STALE_QUEUE_SECONDS = 900n;

const PreviousOperatorEvidenceSchema = Schema.Struct({
  observedState: Schema.Struct({
    protocolOwnedLiquidity: Schema.optional(
      Schema.Struct({
        firstEligibleQueueObservedAt: Schema.optional(
          Schema.NullOr(Schema.String),
        ),
      }),
    ),
  }),
});

interface EligiblePolQueueInput {
  readonly availableWeth: bigint;
  readonly minimumQueueWeth: bigint;
  readonly observedAt: bigint;
  readonly previousFirstObservedAt?: bigint;
  readonly staleAfterSeconds: bigint;
}

export interface EligiblePolQueueObservation {
  readonly firstEligibleQueueObservedAt: bigint | null;
  readonly eligibleQueueAgeSeconds: bigint;
  readonly staleAfterSeconds: bigint;
  readonly eligibleQueueStale: boolean;
}

const validateObservationInput = (input: EligiblePolQueueInput): void => {
  if (input.availableWeth < 0n || input.observedAt < 0n) {
    throw new RangeError("POL queue observations cannot be negative.");
  }
  if (input.minimumQueueWeth <= 0n || input.staleAfterSeconds <= 0n) {
    throw new RangeError("POL queue observation thresholds must be positive.");
  }
};

export const observeEligiblePolQueue = (
  input: EligiblePolQueueInput,
): EligiblePolQueueObservation => {
  validateObservationInput(input);
  if (input.availableWeth < input.minimumQueueWeth) {
    return {
      firstEligibleQueueObservedAt: null,
      eligibleQueueAgeSeconds: 0n,
      staleAfterSeconds: input.staleAfterSeconds,
      eligibleQueueStale: false,
    };
  }
  const previous = input.previousFirstObservedAt;
  const firstEligibleQueueObservedAt =
    previous !== undefined && previous >= 0n && previous <= input.observedAt
      ? previous
      : input.observedAt;
  const eligibleQueueAgeSeconds =
    input.observedAt - firstEligibleQueueObservedAt;
  return {
    firstEligibleQueueObservedAt,
    eligibleQueueAgeSeconds,
    staleAfterSeconds: input.staleAfterSeconds,
    eligibleQueueStale: eligibleQueueAgeSeconds >= input.staleAfterSeconds,
  };
};

export const previousPolQueueFirstObservedAt = (
  serializedEvidence: string,
): bigint | undefined => {
  const decoded = Schema.decodeUnknownSync(PreviousOperatorEvidenceSchema)(
    JSON.parse(serializedEvidence),
  );
  const encoded =
    decoded.observedState.protocolOwnedLiquidity?.firstEligibleQueueObservedAt;
  if (encoded === undefined || encoded === null) return undefined;
  if (!/^\d+$/.test(encoded)) {
    throw new RangeError(
      "Prior POL queue first-observed timestamp is invalid.",
    );
  }
  return BigInt(encoded);
};

export const writeOperatorEvidenceAtomically = (
  evidencePath: string,
  serializedEvidence: string,
): void => {
  const directory = dirname(evidencePath);
  const temporaryPath = join(
    directory,
    `.${basename(evidencePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  mkdirSync(directory, { recursive: true });
  try {
    writeFileSync(temporaryPath, serializedEvidence, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporaryPath, evidencePath);
  } catch (cause) {
    try {
      unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created or may already be gone.
    }
    throw cause;
  }
};
