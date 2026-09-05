import { describe, expect, it } from "vitest";

import {
  advanceTransaction,
  createTransactionState,
  isTransactionInFlight,
} from "./transaction-state";

describe("collector transaction lifecycle", () => {
  it("reports a transaction from wallet approval through confirmation", () => {
    const pending = advanceTransaction(createTransactionState(), {
      type: "prepare",
      label: "Launch Grounded Craft #42",
    });
    const simulated = advanceTransaction(pending, { type: "simulate" });
    const submitted = advanceTransaction(simulated, {
      type: "submit",
      hash: "0x1234",
    });
    const confirmed = advanceTransaction(submitted, { type: "confirm" });

    expect(pending).toEqual({
      status: "pending",
      label: "Launch Grounded Craft #42",
    });
    expect(simulated).toEqual({
      status: "simulated",
      label: "Launch Grounded Craft #42",
    });
    expect(submitted).toEqual({
      status: "submitted",
      label: "Launch Grounded Craft #42",
      hash: "0x1234",
    });
    expect(confirmed).toEqual({
      status: "confirmed",
      label: "Launch Grounded Craft #42",
      hash: "0x1234",
    });
  });

  it("distinguishes terminal failures from operations that can be retried", () => {
    const pending = advanceTransaction(createTransactionState(), {
      type: "prepare",
      label: "Claim attached rewards",
    });
    const failed = advanceTransaction(pending, {
      type: "fail",
      message: "Claim gate rejected this wallet",
      retriable: false,
    });
    const retriable = advanceTransaction(pending, {
      type: "fail",
      message: "Quote expired",
      retriable: true,
    });
    const retrying = advanceTransaction(retriable, { type: "retry" });

    expect(failed).toEqual({
      status: "failed",
      label: "Claim attached rewards",
      message: "Claim gate rejected this wallet",
    });
    expect(retriable).toEqual({
      status: "retriable",
      label: "Claim attached rewards",
      message: "Quote expired",
    });
    expect(retrying).toEqual({
      status: "pending",
      label: "Claim attached rewards",
    });
  });

  it("retains the transaction hash when a submitted transaction fails", () => {
    const submitted = advanceTransaction(
      { status: "simulated", label: "Buy $FUEL" },
      { type: "submit", hash: "0x1234" },
    );

    expect(
      advanceTransaction(submitted, {
        type: "fail",
        message: "The transaction reverted on Base Sepolia.",
        retriable: false,
      }),
    ).toEqual({
      status: "failed",
      label: "Buy $FUEL",
      message: "The transaction reverted on Base Sepolia.",
      hash: "0x1234",
    });
  });

  it("reconciles an unknown submitted outcome without making it replayable", () => {
    const submitted = advanceTransaction(
      { status: "simulated", label: "Buy $FUEL" },
      { type: "submit", hash: "0x1234" },
    );
    const outcomeUnknown = advanceTransaction(submitted, {
      type: "fail",
      message: "Base Sepolia did not return a receipt.",
      retriable: true,
    });

    expect(outcomeUnknown).toEqual({
      status: "outcome-unknown",
      label: "Buy $FUEL",
      message: "Base Sepolia did not return a receipt.",
      hash: "0x1234",
    });
    expect(advanceTransaction(outcomeUnknown, { type: "retry" })).toBe(
      outcomeUnknown,
    );
    expect(
      advanceTransaction(outcomeUnknown, {
        type: "fail",
        message: "The submitted transaction reverted.",
        retriable: false,
      }),
    ).toEqual({
      status: "failed",
      label: "Buy $FUEL",
      message: "The submitted transaction reverted.",
      hash: "0x1234",
    });
  });

  it("keeps confirmed transactions terminal when a follow-up refresh fails", () => {
    const confirmed = {
      status: "confirmed",
      label: "Buy $FUEL",
      hash: "0x1234",
    } as const;

    expect(
      advanceTransaction(confirmed, {
        type: "fail",
        message: "The wallet snapshot could not refresh.",
        retriable: true,
      }),
    ).toBe(confirmed);
  });

  it("treats every pre-confirmation and unknown-outcome state as in flight", () => {
    expect(isTransactionInFlight({ status: "idle" })).toBe(false);
    expect(
      isTransactionInFlight({ status: "pending", label: "Buy $FUEL" }),
    ).toBe(true);
    expect(
      isTransactionInFlight({ status: "simulated", label: "Buy $FUEL" }),
    ).toBe(true);
    expect(
      isTransactionInFlight({
        status: "submitted",
        label: "Buy $FUEL",
        hash: "0x1234",
      }),
    ).toBe(true);
    expect(
      isTransactionInFlight({
        status: "outcome-unknown",
        label: "Buy $FUEL",
        message: "Base Sepolia did not return a receipt.",
        hash: "0x1234",
      }),
    ).toBe(true);
    expect(
      isTransactionInFlight({
        status: "confirmed",
        label: "Buy $FUEL",
        hash: "0x1234",
      }),
    ).toBe(false);
  });
});
