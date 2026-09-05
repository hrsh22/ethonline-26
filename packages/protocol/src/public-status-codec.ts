import * as Schema from "effect/Schema";

const NonnegativeInteger = Schema.Number.pipe(
  Schema.filter((value) => Number.isSafeInteger(value) && value >= 0),
);
const CachedBigInt = Schema.transform(
  Schema.Struct({
    __orbitPublicBigInt: Schema.String.pipe(
      Schema.pattern(/^(0|[1-9][0-9]*)$/u),
    ),
  }),
  Schema.NonNegativeBigIntFromSelf,
  {
    strict: true,
    decode: (value) => BigInt(value.__orbitPublicBigInt),
    encode: (value) => ({ __orbitPublicBigInt: value.toString() }),
  },
);
const OptionalBigInt = Schema.UndefinedOr(CachedBigInt);
const Count = Schema.UndefinedOr(
  Schema.Union(CachedBigInt, NonnegativeInteger),
);
const HexString = Schema.TemplateLiteral("0x", Schema.String);
const TransactionHash = HexString.pipe(Schema.pattern(/^0x[0-9a-fA-F]{64}$/u));
const Address = HexString.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/u));
const Track = Schema.Literal(1, 2, 3, 4);
const EventPosition = {
  blockNumber: CachedBigInt,
  logIndex: NonnegativeInteger,
  transactionIndex: NonnegativeInteger,
  transactionHash: TransactionHash,
};
const RewardOpening = Schema.Struct({
  ...EventPosition,
  type: Schema.Literal("reward-epoch"),
  epoch: Schema.Struct({
    epochNumber: CachedBigInt,
    openedWeth: CachedBigInt,
    equalTrackShare: CachedBigInt,
    finalTrackRemainder: CachedBigInt,
  }),
});
const RewardConversion = Schema.Struct({
  ...EventPosition,
  type: Schema.Literal("track-conversion"),
  track: Track,
  conversion: Schema.Struct({
    spentWeth: CachedBigInt,
    stockReceived: CachedBigInt,
    remainingQueue: CachedBigInt,
  }),
});
const RewardClaim = Schema.Struct({
  ...EventPosition,
  type: Schema.Literal("reward-claim"),
  track: Track,
  claim: Schema.Struct({
    amount: CachedBigInt,
    currentOwner: Address,
    identityId: NonnegativeInteger,
  }),
});

const PublicStatus = Schema.Struct({
  health: Schema.Literal("healthy", "degraded", "critical"),
  freshness: Schema.Literal("fresh", "stale", "unknown"),
  network: Schema.String,
  observedAt: NonnegativeInteger,
  observedBlock: CachedBigInt,
  priceWethPerLiquidTokenWei: Schema.optional(OptionalBigInt),
  collection: Schema.Struct({
    permanent: Count,
    transient: Count,
    pending: Count,
    available: Count,
  }),
  funds: Schema.Struct({
    creatorWeth: OptionalBigInt,
    liquidityLockedWeth: OptionalBigInt,
    liquidityQueuedWeth: Schema.optional(OptionalBigInt),
    liquidityWaitingWeth: OptionalBigInt,
    rewardPotWeth: Schema.optional(OptionalBigInt),
    rewardWethWaiting: OptionalBigInt,
  }),
  rewardActivity: Schema.Struct({
    epochCount: OptionalBigInt,
    historyStatus: Schema.Literal("complete", "partial", "unknown"),
    history: Schema.Array(
      Schema.Union(RewardOpening, RewardConversion, RewardClaim),
    ),
    latestOpening: Schema.UndefinedOr(RewardOpening),
    recentConversions: Schema.Array(RewardConversion),
    collectorLiability: Schema.Array(
      Schema.Struct({ track: Schema.String, amount: OptionalBigInt }),
    ),
  }),
});

export type PublicStatusModel = typeof PublicStatus.Type;
export const isPublicStatusModel = Schema.is(PublicStatus);

// Preserve the v1 cache representation so an upgrade can still show valid
// offline observations. The codec, not a generic JSON reviver, owns bigints.
const PublicStatusCache = Schema.parseJson(
  Schema.Struct({
    model: PublicStatus,
    savedAt: NonnegativeInteger,
  }),
);
export const decodePublicStatusCache =
  Schema.decodeUnknownSync(PublicStatusCache);
export const encodePublicStatusCache = Schema.encodeSync(PublicStatusCache);
