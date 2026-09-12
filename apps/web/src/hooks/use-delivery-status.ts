"use client";

import { useQuery } from "@tanstack/react-query";
import {
  decodeDeliveryStatus,
  PUBLIC_API_PATHS,
} from "@orbit/config/public-api";
import {
  protocolDeploymentFingerprint,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { publicApiUrl } from "@/lib/public-api";
import { useObservationExpiry } from "./use-observation-expiry";

export type DeliveryCondition =
  "running" | "stopped" | "checking" | "offline" | "delayed" | "unknown";

/** Consumers share cached evidence; visible surfaces explicitly own refresh. */
export const useDeliveryStatus = ({
  poll = false,
}: { readonly poll?: boolean } = {}) => {
  const query = useQuery({
    queryKey: ["delivery-status", protocolDeploymentFingerprint],
    enabled: protocolDeploymentManifest !== undefined,
    queryFn: async ({ signal }) => {
      const response = await fetch(
        publicApiUrl(PUBLIC_API_PATHS.delivery.status),
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5_000)]) },
      );
      if (!response.ok) throw new Error("Delivery status unavailable");
      const status = decodeDeliveryStatus(await response.json());
      if (
        status.chainId !== protocolDeploymentManifest?.chainId ||
        status.deploymentFingerprint !== protocolDeploymentFingerprint ||
        status.observedAt > Date.now() + 5_000 ||
        status.expiresAt <= status.observedAt ||
        status.expiresAt - status.observedAt > 30_000
      )
        throw new Error(
          "Delivery status does not match this deployment or observation window",
        );
      return status;
    },
    staleTime: 30_000,
    refetchInterval: poll ? 30_000 : false,
    retry: false,
  });
  const expired = useObservationExpiry(query.data?.expiresAt);
  const heartbeatExpired = useObservationExpiry(query.data?.liveness.expiresAt);
  const data = query.isError || expired ? undefined : query.data;
  const state = deliveryCondition(data, heartbeatExpired);
  return { data, state, refresh: query.refetch } as const;
};

type DeliveryStatus = ReturnType<typeof decodeDeliveryStatus>;
const onlineCondition = (data: DeliveryStatus): DeliveryCondition => {
  if (
    data.policy.oneShot === "dry-run" ||
    (data.policy.mode === "dry-run" && data.policy.oneShot !== "live")
  )
    return "checking";
  return data.latestRun?.outcome === "failed" ? "delayed" : "running";
};
const deliveryCondition = (
  data: DeliveryStatus | undefined,
  heartbeatExpired: boolean,
): DeliveryCondition => {
  if (data === undefined) return "unknown";
  if (data.policy.mode === "stopped" && data.policy.oneShot === "none")
    return "stopped";
  if (data.liveness.state === "offline") return "offline";
  return data.liveness.state === "online" && !heartbeatExpired
    ? onlineCondition(data)
    : "unknown";
};
