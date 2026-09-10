import { ethereum } from "@graphprotocol/graph-ts";
import {
  BidSubmitted,
  BidExited,
  TokensClaimed,
} from "../generated/ContinuousClearingAuction/ContinuousClearingAuction";
import {
  Migrated,
  MigrationFailed,
  FundsRecovered,
} from "../generated/CcaStrategy/CcaStrategy";
import { FuelActivated } from "../generated/CcaLaunchCoordinator/CcaLaunchCoordinator";
import { EscrowDeployed } from "../generated/CcaBidEscrowFactory/CcaBidEscrowFactory";
import { CcaBidEscrow as CcaBidEscrowTemplate } from "../generated/templates";
import {
  AuctionBidSubmission,
  AuctionBidExit,
  AuctionTokenClaim,
  CcaMigration,
  CcaMigrationFailure,
  CcaFundsRecovery,
  CcaActivation,
  CcaEscrow,
} from "../generated/schema";

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

export function handleBidSubmitted(event: BidSubmitted): void {
  let entity = new AuctionBidSubmission(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.bidId = event.params.id;
  entity.owner = event.params.owner;
  entity.priceQ96 = event.params.priceQ96;
  entity.amount = event.params.amount;
  entity.save();
}

export function handleBidExited(event: BidExited): void {
  let entity = new AuctionBidExit(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.bidId = event.params.bidId;
  entity.owner = event.params.owner;
  entity.tokensFilled = event.params.tokensFilled;
  entity.currencyRefunded = event.params.currencyRefunded;
  entity.save();
}

export function handleTokensClaimed(event: TokensClaimed): void {
  let entity = new AuctionTokenClaim(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.bidId = event.params.bidId;
  entity.owner = event.params.owner;
  entity.tokensFilled = event.params.tokensFilled;
  entity.save();
}

export function handleMigrated(event: Migrated): void {
  let entity = new CcaMigration(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.initializer = event.params.initializer;
  entity.poolKeyHash = event.parameters[1].value.toBytes();
  entity.initialSqrtPriceX96 = event.params.initialSqrtPriceX96;
  entity.plan = event.params.plan;
  entity.save();
}

export function handleMigrationFailed(event: MigrationFailed): void {
  let entity = new CcaMigrationFailure(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.initializer = event.params.initializer;
  entity.reason = event.params.reason;
  entity.save();
}

export function handleFundsRecovered(event: FundsRecovered): void {
  let entity = new CcaFundsRecovery(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.initializer = event.params.initializer;
  entity.recipient = event.params.recipient;
  entity.amount = event.params.amount;
  entity.save();
}

export function handleFuelActivated(event: FuelActivated): void {
  let entity = new CcaActivation(eventId(event));
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.governanceOwner = event.params.governanceOwner;
  entity.save();
}

export function handleEscrowDeployed(event: EscrowDeployed): void {
  let entity = new CcaEscrow(event.params.escrow.toHexString());
  entity.beneficiary = event.params.beneficiary;
  entity.createdHash = event.transaction.hash.toHexString();
  entity.createdLogIndex = event.logIndex.toI32();
  entity.createdBlockNumber = event.block.number;
  entity.createdTimestamp = event.block.timestamp;
  entity.save();
  CcaBidEscrowTemplate.create(event.params.escrow);
}
