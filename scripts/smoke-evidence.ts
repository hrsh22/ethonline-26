import { Schema } from "effect";

const ForkSmokeEvidenceSchema = Schema.Struct({
  healthSnapshots: Schema.Array(
    Schema.Struct({
      rpcFailures: Schema.Array(Schema.String),
    }),
  ),
  failedTrack: Schema.Struct({ retainedQueue: Schema.String }),
  invariants: Schema.Struct({ polFuelAfter: Schema.String }),
});

export const decodeForkSmokeEvidence = Schema.decodeUnknownSync(
  ForkSmokeEvidenceSchema,
);
