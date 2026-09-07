"use client";

import Link from "next/link";
import { useProtocolClient } from "@/providers/protocol-client-provider";
import { formatCount } from "@/lib/format";
import { WEB_QUERY_STALE_TIME_MILLISECONDS } from "@/lib/query-client";
import { useDeliveryStatus } from "@/hooks/use-delivery-status";
import { useObservationExpiry } from "@/hooks/use-observation-expiry";

type HealthTone = "healthy" | "degraded" | "critical";
const toneClass: Record<HealthTone, string> = {
  healthy: "text-[var(--status-success-text)]",
  degraded: "text-[var(--status-warning-text)]",
  critical: "text-[var(--status-danger-text)]",
};
const healthTone = (status: string | undefined): HealthTone | undefined =>
  status === "healthy" || status === "degraded" || status === "critical"
    ? status
    : undefined;

const publicStatusIsStale = (
  status: ReturnType<typeof useProtocolClient>["publicStatus"],
) => status !== undefined && status.freshness !== "fresh";

const onchainObservation = ({
  health,
  publicStatus,
}: ReturnType<typeof useProtocolClient>) => ({
  status: healthTone(publicStatus?.health ?? health?.health.status),
  block: publicStatus?.observedBlock ?? health?.deployment.observedBlock,
  observedAt: publicStatus?.observedAt ?? health?.deployment.observedAt,
  stale: publicStatusIsStale(publicStatus),
});

function OnchainIndicator({
  status,
  observedAt,
  stale,
}: {
  readonly status: HealthTone | undefined;
  readonly observedAt: number | undefined;
  readonly stale: boolean;
}) {
  const label =
    status === undefined
      ? "Onchain unknown"
      : stale
        ? `Last checked: ${status} (${new Date((observedAt ?? 0) * 1_000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})`
        : `Onchain ${status}`;
  return (
    <span
      className={
        stale || status === undefined ? "text-ink-soft" : toneClass[status]
      }
      title={
        observedAt === undefined
          ? "Onchain status unavailable"
          : `Checked ${new Date(observedAt * 1_000).toISOString()}`
      }
    >
      {label}
    </span>
  );
}

/** The clock changes labels locally; only the shared service evidence has a poll. */
export function LivePulse() {
  const observation = onchainObservation(useProtocolClient());
  const { status, block, observedAt } = observation;
  const expired = useObservationExpiry(
    observedAt === undefined
      ? undefined
      : observedAt * 1_000 + WEB_QUERY_STALE_TIME_MILLISECONDS,
  );
  const stale = expired || observation.stale;
  const delivery = useDeliveryStatus({ poll: true });
  return (
    <span
      className="grid min-w-0 gap-x-3 gap-y-1 font-mono text-label tracking-[0.1em] uppercase tablet:flex tablet:flex-wrap tablet:items-center"
      data-live-pulse
    >
      <OnchainIndicator status={status} observedAt={observedAt} stale={stale} />
      {block === undefined ? null : (
        <span className="hidden text-ink-soft tablet:inline">
          Block {formatCount(block).display}
        </span>
      )}
      <Link
        className="text-ink-soft underline-offset-4 hover:underline"
        href="/status"
      >
        Delivery {delivery.state}
      </Link>
    </span>
  );
}
