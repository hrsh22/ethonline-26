"use client";

import { useQuery } from "@tanstack/react-query";

import { useOptionalAdminSession } from "@/components/admin/admin-session-boundary";
import type { OperatorControlReading } from "@/lib/admin-cockpit";
import {
  readOperatorControlState,
  type OperatorControlStateDTO,
} from "@/lib/operator-control-client";

/**
 * One control-plane read, shared by every panel that describes the operator
 * service. The key is shared deliberately: the cockpit and the automation
 * controls render side by side, so two independent reads (or, worse, one read
 * and one hardcoded assumption) could show the operator two different answers
 * to "is the operator service running?" at the same moment.
 */
export const OPERATOR_CONTROL_STATE_QUERY_KEY = [
  "operator-control-state",
] as const;

export interface OperatorControlQuery extends OperatorControlReading {
  readonly refetch: () => Promise<unknown>;
  readonly state: OperatorControlStateDTO | undefined;
}

export const useOperatorControlState = (): OperatorControlQuery => {
  const adminSession = useOptionalAdminSession();
  const query = useQuery({
    enabled: adminSession !== undefined,
    queryFn: () => readOperatorControlState(),
    queryKey: OPERATOR_CONTROL_STATE_QUERY_KEY,
    refetchInterval: false,
    retry: false,
  });
  return {
    refetch: () => query.refetch(),
    state: query.data,
    // Pending is not failure: only a rejected read proves the control plane
    // could not be reached.
    unreachable: query.error !== null,
  };
};
