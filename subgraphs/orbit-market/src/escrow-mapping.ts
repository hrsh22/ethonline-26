import { ethereum } from "@graphprotocol/graph-ts";
import { Withdrawal } from "../generated/templates/CcaBidEscrow/CcaBidEscrow";
import { CcaEscrow, CcaEscrowWithdrawal } from "../generated/schema";

function eventId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

export function handleEscrowWithdrawal(event: Withdrawal): void {
  let escrowId = event.address.toHexString();
  let escrow = CcaEscrow.load(escrowId);
  assert(
    escrow != null,
    "Withdrawal source must be a factory-created CCA escrow",
  );
  let entity = new CcaEscrowWithdrawal(eventId(event));
  entity.escrow = escrowId;
  entity.hash = event.transaction.hash.toHexString();
  entity.logIndex = event.logIndex.toI32();
  entity.blockNumber = event.block.number;
  entity.timestamp = event.block.timestamp;
  entity.token = event.params.token;
  entity.beneficiary = event.params.beneficiary;
  entity.amount = event.params.amount;
  entity.save();
}
