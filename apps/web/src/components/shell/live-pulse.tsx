"use client";

import { useProtocolClient } from "@/providers/protocol-client-provider";
import { formatCount } from "@/lib/format";

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

/**
 * The live readout in the status strip: protocol health and the observed
 * block. Not a live region — it changes with every refresh and announcing each
 * block would be noise. The dedicated status route carries the announced state.
 */
function HealthReadout({ status }: { readonly status: HealthTone }) {
  return (
    <span className={`flex items-center gap-1.5 ${toneClass[status]}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

function BlockReadout({ block }: { readonly block: bigint | number }) {
  return (
    <span className="text-ink-soft">
      Block{" "}
      <span className="text-ink tabular-nums">
        {formatCount(block).display}
      </span>
    </span>
  );
}

type ProtocolClient = ReturnType<typeof useProtocolClient>;

/** The freshest health and block the provider holds for this route. */
const readPulse = ({ health, publicStatus }: ProtocolClient) => ({
  status: healthTone(publicStatus?.health ?? health?.health.status),
  block: publicStatus?.observedBlock ?? health?.deployment.observedBlock,
});

export function LivePulse() {
  const { block, status } = readPulse(useProtocolClient());
  if (status === undefined && block === undefined) return null;
  return (
    <span
      className="flex min-w-0 items-center gap-3 font-mono text-label tracking-[0.1em] uppercase"
      data-live-pulse
    >
      {status === undefined ? null : <HealthReadout status={status} />}
      {block === undefined ? null : <BlockReadout block={block} />}
    </span>
  );
}
