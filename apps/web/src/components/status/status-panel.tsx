"use client";

import { ProtocolOverview } from "@/components/status/protocol-overview";
import { StateFeedback } from "@/components/state-feedback";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import { Count } from "@/components/ui/value";
import {
  deploymentEnvironment,
  protocolDeploymentManifest,
} from "@/lib/deployment";
import { applicationCopy } from "@/lib/identity";
import type { PublicStatusModel } from "@/lib/protocol-status-model";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;

/* The same boundary the status model draws: a connected wallet's freeze state
 * and per-track retry detail are operator evidence, not public health. */
const publicChecks = (health: ProtocolClient["health"]) =>
  health?.health.checks.filter(
    (check) =>
      check.id !== "freeze:connected-wallet" && !check.id.startsWith("track:"),
  );

const observedTime = (timestamp: number): string =>
  new Date(timestamp * 1_000).toISOString().replace("T", " ").slice(0, 19) +
  " UTC";

const healthTone: Record<PublicStatusModel["health"], BadgeTone> = {
  healthy: "success",
  degraded: "warning",
  critical: "danger",
};

const launchBlock = () => {
  const launch = protocolDeploymentManifest?.launch;
  return launch === undefined ? (
    <span className="text-ink-soft">
      {applicationCopy.publicStatus.launchBlockUnpublished}
    </span>
  ) : (
    <Count value={BigInt(launch.blockNumber)} />
  );
};

/**
 * The health answer: one badge, then the block and time it was true at.
 *
 * The audited snapshot put its freshness marker in a footer outside the card
 * it described, so the two read as unrelated fragments. Here the answer, its
 * freshness, and its observation point are one board.
 */
function HealthBoard({ model }: { readonly model: PublicStatusModel }) {
  return (
    <div className="mt-5">
      <MetricGroup columns={5} label={applicationCopy.publicStatus.healthLabel}>
        <Metric
          hint={applicationCopy.publicStatus.healthExplanation[model.health]}
          label={applicationCopy.publicStatus.healthLabel}
          value={
            <Badge dot tone={healthTone[model.health]}>
              {applicationCopy.status.health[model.health]}
            </Badge>
          }
        />
        <Metric
          hint={applicationCopy.publicStatus.freshness[model.freshness]}
          label={applicationCopy.publicStatus.observedBlock}
          tone="live"
          value={<Count value={model.observedBlock} />}
        />
        <Metric
          label={applicationCopy.publicStatus.observedAt}
          value={
            <time
              className="text-title-sm"
              dateTime={new Date(model.observedAt * 1_000).toISOString()}
            >
              {observedTime(model.observedAt)}
            </time>
          }
        />
        <Metric
          hint={model.network}
          label={applicationCopy.publicStatus.networkLabel}
          value={deploymentEnvironment.chainLabel}
        />
        <Metric
          label={applicationCopy.publicStatus.launchBlockLabel}
          value={launchBlock()}
        />
      </MetricGroup>
      <p className="mt-2 text-caption text-ink-faint">
        {applicationCopy.publicStatus.snapshotDisclosure}
      </p>
    </div>
  );
}

/** Known deployment facts while no live snapshot exists: never a row of dashes. */
function DeploymentEvidenceBoard() {
  return (
    <Panel
      bodyClassName="p-0"
      className="mt-3"
      footer={
        <p className="text-caption text-ink-faint">
          {applicationCopy.publicStatus.deploymentEvidenceNote}
        </p>
      }
      title={applicationCopy.publicStatus.deploymentEvidenceHeading}
    >
      <MetricGroup
        className="rounded-none border-0"
        columns={3}
        label={applicationCopy.publicStatus.deploymentEvidenceHeading}
      >
        <Metric
          label={applicationCopy.publicStatus.networkLabel}
          value={deploymentEnvironment.chainLabel}
        />
        <Metric
          label={applicationCopy.publicStatus.launchBlockLabel}
          value={launchBlock()}
        />
        <Metric
          label={applicationCopy.publicStatus.collectionSize}
          value={<Count value={4_444} />}
        />
      </MetricGroup>
    </Panel>
  );
}

const unavailableFeedback = (error: Error | null) =>
  error?.message.includes("timed out after 8 seconds") === true
    ? {
        description: applicationCopy.publicStatus.timedOutDescription,
        title: applicationCopy.publicStatus.timedOutTitle,
      }
    : {
        description: applicationCopy.publicStatus.readUnavailable,
        title: applicationCopy.publicStatus.unavailableTitle,
      };

/** The one condition the route needs to state above its boards, if any. */
const feedbackFor = ({
  publicStatus,
  publicStatusError,
  publicStatusPending,
  publicStatusRefreshing,
}: ProtocolClient) => {
  if (publicStatus === undefined) {
    return publicStatusPending
      ? ({
          description: applicationCopy.publicStatus.readPending,
          retry: false,
          title: applicationCopy.common.loading,
          tone: "loading",
        } as const)
      : ({
          ...unavailableFeedback(publicStatusError),
          retry: true,
          tone: "error",
        } as const);
  }
  if (publicStatusError !== null) {
    return {
      description: applicationCopy.publicStatus.lastKnownDescription,
      retry: true,
      title: applicationCopy.publicStatus.lastKnownTitle,
      tone: "stale",
    } as const;
  }
  if (publicStatusRefreshing) {
    return {
      description: applicationCopy.publicStatus.refreshingDescription,
      retry: false,
      title: applicationCopy.publicStatus.refreshingTitle,
      tone: "loading",
    } as const;
  }
  return undefined;
};

export function StatusPanel() {
  const protocol = useProtocolClient();
  const { deploymentAvailable, health, publicStatus, refresh } = protocol;

  if (!deploymentAvailable) {
    return (
      <StateFeedback
        className="mt-5"
        description={`${applicationCopy.publicStatus.deploymentPending} ${applicationCopy.publicStatus.snapshotOnly}`}
        title={applicationCopy.publicStatus.deploymentUnavailableTitle}
        tone="blocked"
      />
    );
  }

  const feedback = feedbackFor(protocol);
  return (
    <>
      {feedback === undefined ? null : (
        <StateFeedback
          action={
            feedback.retry ? (
              <Button
                onClick={() => void refresh()}
                size="sm"
                type="button"
                variant="outline"
              >
                {applicationCopy.publicStatus.retryPublicStatus}
              </Button>
            ) : undefined
          }
          className="mt-5"
          description={feedback.description}
          title={feedback.title}
          tone={feedback.tone}
        />
      )}
      {publicStatus === undefined ? (
        <DeploymentEvidenceBoard />
      ) : (
        <>
          <HealthBoard model={publicStatus} />
          <ProtocolOverview
            checks={publicChecks(health)}
            model={publicStatus}
          />
        </>
      )}
    </>
  );
}
