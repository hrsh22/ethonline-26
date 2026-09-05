import type { AdminConsoleRoleId } from "@orbit/config/admin-auth";

import { formatTokenAmount } from "@/lib/format";
import { applicationCopy } from "@/lib/identity";
import type { useProtocolClient } from "@/providers/protocol-client-provider";

/**
 * Shared vocabulary for the operator console's presentation components. The
 * protocol client stays the single source of truth; these types and formatters
 * only describe how its readings are rendered on the mission boards.
 */
export type ProtocolClient = ReturnType<typeof useProtocolClient>;
export type HealthSnapshot = ProtocolClient["health"];
export type TrackQueue =
  NonNullable<HealthSnapshot>["operations"]["trackQueues"][number];

/**
 * The pinned facts every privileged-action review renders: who acts, where,
 * against which observed block, with which capabilities, and whether another
 * submission is already in flight.
 */
export interface ReviewContext {
  readonly actor: string | undefined;
  readonly chainLabel: string;
  readonly observedBlock: bigint | undefined;
  readonly roles: readonly AdminConsoleRoleId[];
  readonly pending: boolean;
}

export const formatObserved = (value: unknown): string =>
  value === undefined || value === null
    ? applicationCopy.common.notObserved
    : String(value);

/**
 * A WETH balance as a headline, not as its exact decimal expansion.
 *
 * The console rendered the reader's `*Formatted` strings, which are a plain
 * `formatUnits(value, 18)` -- the exact expansion `formatTokenAmount` exists
 * to replace. An accrued creator fee reached the page as
 * `0.003718500000000005 WETH`, the very string the format module's docstring
 * cites as unreadable. Diagnostics still shows the raw expansion on purpose:
 * that view is raw protocol reads by definition.
 */
export const formatObservedWeth = (value: bigint | undefined): string =>
  value === undefined
    ? applicationCopy.common.notObserved
    : formatTokenAmount(value).display;

export const formatEpochTime = (
  value: bigint | undefined,
  readyLabel: string,
): string => {
  if (value === undefined) return applicationCopy.common.notObserved;
  if (value === 0n) return readyLabel;
  return new Date(Number(value) * 1_000)
    .toISOString()
    .replace("T", " ")
    .slice(0, 19);
};

/**
 * Boards render only for the capabilities the authenticated session actually
 * holds, so a creator-only operator never sees keeper, owner, or executor
 * controls and an owner never sees the creator withdrawal.
 */
export const holdsAny = (
  roles: readonly AdminConsoleRoleId[],
  required: readonly AdminConsoleRoleId[],
): boolean => required.some((role) => roles.includes(role));
