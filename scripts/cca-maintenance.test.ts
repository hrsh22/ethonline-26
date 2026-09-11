import { describe, expect, it } from "vitest";
import {
  planCcaMaintenance,
  runCcaMaintenance,
  submitCcaFromCanonicalObservation,
  type CcaObservation,
} from "./cca-maintenance.ts";

const settled: CcaObservation = {
  blockNumber: 102n,
  endBlock: 100n,
  migrationBlock: 101n,
  checkpointBlock: 99n,
  graduated: true,
  reservation: "auction",
  poolInitialized: false,
  canonicalPosition: false,
  ready: false,
  activated: false,
  launched: false,
};

describe("CCA lifecycle planning from restart observations", () => {
  it("blocks signing and submission when the observation block changes after simulation", async () => {
    const calls: string[] = [];
    await expect(
      submitCcaFromCanonicalObservation({
        observation: { number: 102n, hash: "0x11" },
        readBlockHash: async (number) => {
          expect(number).toBe(102n);
          return "0x22";
        },
        assertMaySign: () => {
          calls.push("signing guard");
        },
        submit: async () => {
          calls.push("submission");
          return "0x33";
        },
      }),
    ).rejects.toThrow("CCA observation block changed before signing");
    expect(calls).toEqual([]);
  });
  it("restarts through every lifecycle action without duplicating a confirmed step", async () => {
    let state = settled;
    const performed: string[] = [];
    const nextStates: CcaObservation[] = [
      { ...settled, checkpointBlock: 100n },
      { ...settled, checkpointBlock: 100n, reservation: "consumed" },
      {
        ...settled,
        checkpointBlock: 100n,
        reservation: "consumed",
        poolInitialized: true,
        positionToRegister: 42n,
      },
      {
        ...settled,
        checkpointBlock: 100n,
        reservation: "consumed",
        poolInitialized: true,
        canonicalPosition: true,
        ready: true,
      },
      {
        ...settled,
        checkpointBlock: 100n,
        reservation: "consumed",
        poolInitialized: true,
        canonicalPosition: true,
        ready: true,
        activated: true,
        launched: true,
      },
    ];
    for (const next of nextStates) {
      const result = await runCcaMaintenance({
        execute: true,
        chain: {
          observe: async (minimum) => {
            expect(minimum === undefined || minimum <= state.blockNumber).toBe(
              true,
            );
            return state;
          },
          attempt: async (action) => {
            performed.push(action.kind);
            state = next;
            return { status: "confirmed", blockNumber: 102n };
          },
        },
      });
      expect(result.status).toBe("confirmed");
    }
    expect(performed).toEqual([
      "checkpoint",
      "migrate",
      "recover-and-seed",
      "register-position",
      "activate",
    ]);
    const completed = await runCcaMaintenance({
      execute: true,
      chain: {
        observe: async () => state,
        attempt: async () => {
          throw new Error("Completed launch must not submit again");
        },
      },
    });
    expect(completed.complete).toBe(true);
  });
  it.each(["simulated", "failed", "submitted-unknown"] as const)(
    "does not advance on %s",
    async (status) => {
      let observations = 0;
      const result = await runCcaMaintenance({
        execute: status !== "simulated",
        chain: {
          observe: async () => {
            observations++;
            return settled;
          },
          attempt: async () => ({ status }),
        },
      });
      expect(result.complete).toBe(false);
      expect(result.status).toBe(status);
      expect(observations).toBe(1);
    },
  );
  it("checkpoints before trusting graduation and waits for migration", () => {
    expect(planCcaMaintenance(settled)).toEqual({ kind: "checkpoint" });
    expect(
      planCcaMaintenance({
        ...settled,
        checkpointBlock: 100n,
        blockNumber: 100n,
      }),
    ).toMatchObject({ kind: "wait" });
    expect(planCcaMaintenance({ ...settled, checkpointBlock: 100n })).toEqual({
      kind: "migrate",
    });
  });
  it("resumes a consumed migration through recovery, registration, and readiness", () => {
    const state = {
      ...settled,
      checkpointBlock: 100n,
      reservation: "consumed" as const,
    };
    expect(planCcaMaintenance(state)).toEqual({ kind: "recover-and-seed" });
    expect(
      planCcaMaintenance({
        ...state,
        poolInitialized: true,
        positionToRegister: 42n,
      }),
    ).toEqual({ kind: "register-position", tokenId: 42n });
    expect(
      planCcaMaintenance({
        ...state,
        poolInitialized: true,
        canonicalPosition: true,
      }),
    ).toMatchObject({ kind: "wait" });
    expect(
      planCcaMaintenance({
        ...state,
        poolInitialized: true,
        canonicalPosition: true,
        ready: true,
      }),
    ).toEqual({ kind: "activate" });
    expect(planCcaMaintenance({ ...state, activated: true })).toMatchObject({
      kind: "wait",
    });
    expect(
      planCcaMaintenance({ ...state, activated: true, launched: true }),
    ).toMatchObject({ kind: "complete" });
    expect(planCcaMaintenance({ ...state, graduated: false })).toMatchObject({
      kind: "terminal",
    });
  });
  it("takes only one action and uses post-receipt state before reporting completion", async () => {
    let reads = 0;
    const result = await runCcaMaintenance({
      execute: true,
      chain: {
        observe: async () =>
          ++reads === 1
            ? { ...settled, checkpointBlock: 100n }
            : { ...settled, checkpointBlock: 100n, reservation: "consumed" },
        attempt: async () => ({ status: "confirmed", blockNumber: 103n }),
      },
    });
    expect(result.status).toBe("confirmed");
    expect("next" in result && result.next).toEqual({
      kind: "recover-and-seed",
    });
    expect(result.complete).toBe(false);
    expect(reads).toBe(2);
  });
});
