import { decodeOperatorControlState } from "@orbit/config/operator-control";
import type { OperatorControlState } from "@orbit/config/operator-control";

export interface OperatorControlEnvelope {
  readonly state: OperatorControlState;
}

/**
 * The relay decodes the upstream envelope instead of passing it through: a
 * malformed control-plane payload must become a handled 503 here, not a
 * TypeError inside the panel whose crash would take down the whole admin
 * console (the app has no error boundary between them).
 */
export const decodeOperatorControlEnvelope = (
  value: unknown,
): OperatorControlEnvelope => {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    throw new TypeError("Operator control response omitted its state");
  }
  return { state: decodeOperatorControlState(value.state) };
};
