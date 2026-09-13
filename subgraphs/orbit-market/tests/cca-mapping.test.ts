import {
  assert,
  clearStore,
  newMockEvent,
  test,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  FundsRecovered,
  MigrationFailed,
} from "../generated/CcaStrategy/CcaStrategy";
import {
  handleFundsRecovered,
  handleMigrationFailed,
} from "../src/cca-mapping";
import { CCA_INITIALIZER } from "../src/constants";

const FOREIGN_INITIALIZER = "0x0000000000000000000000000000000000000001";
const RECIPIENT = "0x0000000000000000000000000000000000000002";

function uint(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(
    name,
    ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(value)),
  );
}

function bytes(name: string, value: string): ethereum.EventParam {
  return new ethereum.EventParam(
    name,
    ethereum.Value.fromBytes(Bytes.fromHexString(value)),
  );
}

function migrationFailed(initializer: string, logIndex: i32): MigrationFailed {
  let event = changetype<MigrationFailed>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = [
    new ethereum.EventParam(
      "initializer",
      ethereum.Value.fromAddress(Address.fromString(initializer)),
    ),
    bytes("reason", "0x1234"),
  ];
  return event;
}

function fundsRecovered(initializer: string, logIndex: i32): FundsRecovered {
  let event = changetype<FundsRecovered>(newMockEvent());
  event.logIndex = BigInt.fromI32(logIndex);
  event.parameters = [
    new ethereum.EventParam(
      "initializer",
      ethereum.Value.fromAddress(Address.fromString(initializer)),
    ),
    new ethereum.EventParam(
      "recipient",
      ethereum.Value.fromAddress(Address.fromString(RECIPIENT)),
    ),
    uint("amount", 42),
  ];
  return event;
}

test("shared strategy handlers ignore foreign initializers", () => {
  clearStore();
  handleMigrationFailed(migrationFailed(FOREIGN_INITIALIZER, 1));
  handleFundsRecovered(fundsRecovered(FOREIGN_INITIALIZER, 2));
  assert.entityCount("CcaMigrationFailure", 0);
  assert.entityCount("CcaFundsRecovery", 0);
});

test("failure and recovery records accept the canonical initializer", () => {
  clearStore();
  handleMigrationFailed(migrationFailed(CCA_INITIALIZER, 1));
  handleFundsRecovered(fundsRecovered(CCA_INITIALIZER, 2));
  assert.entityCount("CcaMigrationFailure", 1);
  assert.entityCount("CcaFundsRecovery", 1);
});
