"use client";

import Link from "next/link";

import { StateFeedback } from "@/components/state-feedback";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Section } from "@/components/ui/section";
import { Amount, Count, Rate, Unavailable } from "@/components/ui/value";
import { applicationCopy } from "@/lib/identity";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { useProtocolClient } from "@/providers/protocol-client-provider";

/**
 * The census: what is true of the collection and its market right now.
 *
 * This is the first board on the home page. Counts and balances come through
 * the value primitives, a read that has not resolved says so once instead of
 * six times, and block-level proof stays on the status route.
 */
type ProtocolClient = ReturnType<typeof useProtocolClient>;
type PublicStatus = NonNullable<ProtocolClient["publicStatus"]>;

const readState = ({
  deploymentAvailable,
  publicStatus,
  publicStatusError,
  publicStatusPending,
  publicStatusRefreshing,
}: ProtocolClient) => {
  if (!deploymentAvailable) {
    return {
      description:
        "The configured protocol deployment is not available in this environment.",
      title: applicationCopy.shell.deploymentPending,
      tone: "blocked",
    } as const;
  }
  if (publicStatusError !== null && publicStatusError !== undefined) {
    return {
      description:
        publicStatus === undefined
          ? "The public protocol snapshot could not be read. No private connection detail is shown."
          : "The latest refresh failed. The figures below remain from the last successful public snapshot.",
      title:
        publicStatus === undefined
          ? applicationCopy.common.readFailed
          : "Showing last-known snapshot",
      tone: publicStatus === undefined ? "error" : "stale",
    } as const;
  }
  if (publicStatusPending || publicStatusRefreshing) {
    return {
      description: "Reading the latest public Base Sepolia protocol snapshot.",
      title:
        publicStatus === undefined
          ? "Loading protocol health"
          : "Refreshing protocol health",
      tone: "loading",
    } as const;
  }
  return undefined;
};

const countValue = (
  value: number | bigint | undefined,
  unreadable: string,
): React.ReactElement =>
  value === undefined ? (
    <Unavailable reason={unreadable} />
  ) : (
    <Count value={value} />
  );

const wethValue = (
  value: bigint | undefined,
  unreadable: string,
): React.ReactElement =>
  value === undefined ? (
    <Unavailable reason={unreadable} />
  ) : (
    <Amount unit="WETH" value={value} />
  );

const healthBadge = (model: PublicStatus | undefined) => {
  if (model === undefined) return undefined;
  const status = model.health;
  const tone =
    status === "healthy"
      ? "success"
      : status === "degraded"
        ? "warning"
        : "danger";
  return (
    <Badge dot tone={tone}>
      {applicationCopy.status.health[status]}
    </Badge>
  );
};

const unreadableLiveCounts = (
  protocol: ProtocolClient,
  reason: string,
): React.ReactElement =>
  protocol.publicStatusPending || protocol.publicStatusRefreshing ? (
    <span>Refreshing…</span>
  ) : (
    <Unavailable reason={reason} />
  );

/** Known deployment facts while the live read is in flight: never a row of dashes. */
function DeploymentBoard({
  protocol,
  unreadable,
}: {
  readonly protocol: ProtocolClient;
  readonly unreadable: string;
}) {
  return (
    <MetricGroup columns={4} label={applicationCopy.home.census}>
      <Metric
        label={applicationCopy.home.collectionSize}
        value={<Count value={4_444} />}
      />
      <Metric
        label={applicationCopy.home.network}
        value={deploymentEnvironment.chainLabel}
      />
      <Metric
        label={applicationCopy.home.launchState}
        value={
          protocolDeploymentManifest === undefined
            ? "Awaiting manifest"
            : applicationCopy.home.launched
        }
      />
      <Metric
        label={applicationCopy.home.liveCounts}
        value={unreadableLiveCounts(protocol, unreadable)}
      />
    </MetricGroup>
  );
}

function CensusBoard({
  model,
  unreadable,
}: {
  readonly model: PublicStatus;
  readonly unreadable: string;
}) {
  const price = model.priceWethPerLiquidTokenWei;
  return (
    <MetricGroup columns={6} label={applicationCopy.home.census}>
      <Metric
        label={applicationCopy.home.launchedCount}
        tone="live"
        value={countValue(model.collection.permanent, unreadable)}
      />
      <Metric
        label={applicationCopy.home.groundedCount}
        value={countValue(model.collection.transient, unreadable)}
      />
      <Metric
        label={applicationCopy.home.pendingCount}
        value={countValue(model.collection.pending, unreadable)}
      />
      <Metric
        label={applicationCopy.home.availableCount}
        value={countValue(model.collection.available, unreadable)}
      />
      <Metric
        label={applicationCopy.home.price}
        value={
          price === undefined ? (
            <Unavailable reason={unreadable} />
          ) : (
            <Rate value={price} />
          )
        }
      />
      <Metric
        label={applicationCopy.home.rewardWaiting}
        value={wethValue(model.funds.rewardPotWeth, unreadable)}
      />
    </MetricGroup>
  );
}

export function ProtocolSummary() {
  const protocol = useProtocolClient();
  const feedback = readState(protocol);
  const model = protocol.publicStatus;
  const unreadable = feedback?.title ?? applicationCopy.common.notObserved;

  return (
    <Section
      description={applicationCopy.home.censusNote}
      headingId="protocol-health-heading"
      meta={
        <>
          {healthBadge(model)}
          <Link
            className="flex min-h-11 items-center text-signal underline decoration-1 underline-offset-4 hover:text-ink"
            href="/status"
          >
            {applicationCopy.home.operationsLink}
          </Link>
        </>
      }
      title={applicationCopy.home.census}
    >
      {feedback === undefined ? null : (
        <div className="mb-3">
          <StateFeedback
            action={
              feedback.tone === "error" || feedback.tone === "stale" ? (
                <Button
                  className="h-auto max-w-full whitespace-normal py-2"
                  onClick={() => void protocol.refresh()}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {applicationCopy.home.retryStatus}
                </Button>
              ) : undefined
            }
            compact
            {...feedback}
          />
        </div>
      )}
      {model === undefined ? (
        <DeploymentBoard protocol={protocol} unreadable={unreadable} />
      ) : (
        <CensusBoard model={model} unreadable={unreadable} />
      )}
    </Section>
  );
}
