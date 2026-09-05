import type {
  OperatorCommandName,
  OperatorControlState,
} from "@orbit/config/operator-control";

import { adminProtectedFetch } from "@/lib/admin-protected-fetch";
import { decodeOperatorControlEnvelope } from "@/lib/operator-control-contract";

/**
 * Operator control goes through the same-origin admin relay like every other
 * admin call. Calling the public API origin directly could never work from a
 * browser: the admin session cookie is SameSite=Strict on this origin, so the
 * cross-origin request arrived unauthenticated, and the resulting 401 tripped
 * the session-invalidation handler -- opening the console signed the operator
 * out in a loop.
 */
const OPERATOR_RELAY_PATHS = {
  command: "/api/admin/operator/command",
  state: "/api/admin/operator/state",
} as const;

export type OperatorControlStateDTO = OperatorControlState;

export class OperatorControlError extends Error {
  override readonly name = "OperatorControlError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const parse = async (response: Response): Promise<Record<string, unknown>> => {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const failure = async (response: Response): Promise<OperatorControlError> => {
  const body = await parse(response);
  const error = body.error as
    { readonly code?: string; readonly message?: string } | undefined;
  return new OperatorControlError(
    response.status,
    error?.code ?? "operator-unavailable",
    error?.message ??
      "The operator control plane is unavailable. Retry before changing policy.",
  );
};

export const readOperatorControlState = async (
  fetcher: typeof fetch = fetch,
): Promise<OperatorControlStateDTO> => {
  const response = await adminProtectedFetch(
    OPERATOR_RELAY_PATHS.state,
    undefined,
    fetcher,
  );
  if (!response.ok) throw await failure(response);
  return decodedState(await parse(response));
};

const decodedState = (
  body: Record<string, unknown>,
): OperatorControlStateDTO => {
  try {
    return decodeOperatorControlEnvelope(body).state;
  } catch {
    throw new OperatorControlError(
      502,
      "operator-unavailable",
      "The operator control plane returned an unreadable state. Retry before changing policy.",
    );
  }
};

/**
 * A client-generated id makes a retry safe: the control plane returns the
 * stored result instead of applying the command twice.
 */
export const newOperatorCommandId = (): string => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const sendOperatorCommand = async (
  input: {
    readonly command: OperatorCommandName;
    readonly commandId: string;
    readonly csrfToken: string;
    readonly signedCommand?:
      | { readonly message: string; readonly signature: `0x${string}` }
      | undefined;
  },
  fetcher: typeof fetch = fetch,
): Promise<OperatorControlStateDTO> => {
  const response = await adminProtectedFetch(
    OPERATOR_RELAY_PATHS.command,
    {
      body: JSON.stringify({
        command: input.command,
        commandId: input.commandId,
        ...(input.signedCommand === undefined
          ? {}
          : { signedCommand: input.signedCommand }),
      }),
      headers: {
        "content-type": "application/json",
        "x-csrf-token": input.csrfToken,
      },
      method: "POST",
    },
    fetcher,
  );
  if (!response.ok) throw await failure(response);
  return decodedState(await parse(response));
};
