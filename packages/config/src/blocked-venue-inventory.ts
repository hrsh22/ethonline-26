import { Schema } from "effect";

const EvmAddress = Schema.String.pipe(Schema.pattern(/^0x[0-9a-fA-F]{40}$/));
const Codehash = Schema.String.pipe(Schema.pattern(/^0x[0-9a-f]{64}$/));
const NonEmpty = Schema.String.pipe(Schema.minLength(1));

/**
 * One venue this deployment refuses to let the liquid token reach, together
 * with the provenance a reviewer needs to re-derive it. A bare codehash is not
 * reviewable: it says nothing about which contract it belongs to, where the
 * address came from, or why blocking that contract is the right unit.
 */
export const BlockedVenueEntrySchema = Schema.Struct({
  label: Schema.String.pipe(Schema.pattern(/^[a-z0-9]+(-[a-z0-9]+)*$/)),
  address: EvmAddress,
  codehash: Codehash,
  source: NonEmpty,
  verifiedBy: NonEmpty,
  rationale: NonEmpty,
});

/**
 * A deployment input. `FuelCore.setBlockedVenueCodehash` reverts once the token
 * launches, so this file is the complete and final inventory for the deployment
 * it is used with -- anything omitted can never be added afterwards.
 */
export const BlockedVenueInventorySchema = Schema.Struct({
  $schema: Schema.Literal("./blocked-venue-schema.json"),
  $comment: Schema.optional(Schema.String),
  schemaVersion: Schema.Literal(1),
  chainId: Schema.Int.pipe(Schema.positive()),
  network: NonEmpty,
  /**
   * A codehash only means anything against the runtime code of a specific
   * contract at a specific time, so the reading is dated.
   */
  observedAtBlock: Schema.String.pipe(Schema.pattern(/^[0-9]+$/)),
  entries: Schema.Array(BlockedVenueEntrySchema),
});

export type BlockedVenueEntry = typeof BlockedVenueEntrySchema.Type;
export type BlockedVenueInventory = typeof BlockedVenueInventorySchema.Type;

export const decodeBlockedVenueInventory = Schema.decodeUnknownSync(
  BlockedVenueInventorySchema,
);
