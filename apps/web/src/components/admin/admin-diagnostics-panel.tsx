"use client";

import { HealthCheckLedger } from "@/components/status/health-check-ledger";
import { StateFeedback } from "@/components/state-feedback";
import { TrackQueueLedger } from "@/components/status/track-queue-ledger";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel, Well } from "@/components/ui/panel";
import { Address } from "@/components/ui/value";
import { useTestnetFundingStatus } from "@/hooks/use-testnet-funding";
import { applicationCopy } from "@/lib/identity";
import {
  deriveAdminDiagnosticsModel,
  type AdminDiagnosticsModel,
  type AdminRoleId,
  type FundingDiagnosticInput,
} from "@/lib/protocol-status-model";
import { useProtocolClient } from "@/providers/protocol-client-provider";

type ProtocolClient = ReturnType<typeof useProtocolClient>;
type FundingStatus = ReturnType<typeof useTestnetFundingStatus>;

const display = (value: bigint | number | string | undefined): string =>
  value === undefined ? applicationCopy.common.notObserved : String(value);

/** A source's state carries a tone as well as its word. */
const stateTone = (state: string): BadgeTone => {
  if (state === "healthy" || state === "complete" || state === "ready") {
    return "success";
  }
  if (state === "critical" || state === "unavailable") return "danger";
  if (state === "degraded" || state === "partial" || state === "stale") {
    return "warning";
  }
  return "neutral";
};

const evidenceCode =
  "font-mono text-body-sm text-ink tabular-nums [overflow-wrap:anywhere]";

const capsHeading =
  "font-mono text-label font-semibold tracking-[0.1em] text-ink uppercase";

const fundingDiagnosticInput = (
  protocol: ProtocolClient,
  funding: FundingStatus,
): FundingDiagnosticInput => {
  const serviceState = funding.response?.service?.state;
  if (protocol.accessState !== "ready") return { state: "not-checked" };
  if (serviceState !== undefined) return { state: "loaded", serviceState };
  if (funding.failed) return { state: "failed" };
  return funding.pending ? { state: "loading" } : { state: "failed" };
};

function EvidenceSources({ model }: { readonly model: AdminDiagnosticsModel }) {
  return (
    <Panel
      className="laptop:col-span-12"
      meta={applicationCopy.operations.viewOnly}
      title={applicationCopy.operations.evidenceSources}
    >
      <p className="mb-3 text-body-sm text-ink-soft">
        {applicationCopy.operations.evidenceSourcesIntroduction}
      </p>
      <div className="grid gap-2 tablet:grid-cols-2 laptop:grid-cols-3">
        {model.sources.map(({ source, state }) => {
          const copy = applicationCopy.operations.diagnosticSources[source];
          return (
            <Well className="grid gap-1" key={source}>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className={capsHeading}>{copy.label}</h3>
                <span className="ml-auto" data-source-state={state}>
                  <Badge dot tone={stateTone(state)}>
                    {applicationCopy.operations.diagnosticState[state]}
                  </Badge>
                </span>
              </div>
              <p className="text-body-sm text-ink-soft">{copy.description}</p>
            </Well>
          );
        })}
      </div>
    </Panel>
  );
}

const keeperTracks = [1, 2, 3, 4] as const;

function KeeperAttemptRow({
  label,
  track,
}: {
  readonly label: string;
  readonly track: AdminDiagnosticsModel["keeperAttemptEvidence"]["tracks"][1];
}) {
  return (
    <Well className="grid gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={capsHeading} data-attempt-state={track.state}>
          {label}
        </h3>
        <Badge className="ml-auto" tone={stateTone(track.state)}>
          {applicationCopy.operations.automationTrackState[track.state]}
        </Badge>
      </div>
      <code className={evidenceCode}>
        {track.actionKind ?? applicationCopy.common.notObserved} /{" "}
        {track.outcome ?? applicationCopy.common.notObserved}
        {track.receipt === undefined
          ? ""
          : ` / block ${track.receipt.blockNumber.toString()}`}
      </code>
      {track.failureClass === undefined ? null : (
        <p className="text-body-sm text-[var(--status-warning-text)]">
          {track.failureClass}
        </p>
      )}
      {track.transactionHash === undefined ? null : (
        <a
          className="flex min-h-11 items-center font-mono text-body-sm text-signal underline decoration-1 underline-offset-4 hover:text-ink"
          href={`https://sepolia.basescan.org/tx/${track.transactionHash}`}
          rel="noreferrer"
          target="_blank"
        >
          {applicationCopy.publicStatus.viewTransaction}
        </a>
      )}
    </Well>
  );
}

function KeeperAttemptEvidence({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  const evidence = model.keeperAttemptEvidence;
  return (
    <Panel
      className="laptop:col-span-7"
      meta={
        <span data-evidence-state={evidence.state}>
          <Badge dot tone={stateTone(evidence.state)}>
            {applicationCopy.operations.diagnosticState[evidence.state]}
          </Badge>
        </span>
      }
      title={applicationCopy.operations.keeperAttemptHeading}
    >
      <p className="mb-3 text-body-sm text-ink-soft">
        {applicationCopy.operations.keeperAttemptIntroduction}
      </p>
      <DataList className="mb-3">
        <DataRow
          label={applicationCopy.operations.sourceGeneration}
          value={display(evidence.generation)}
        />
        <DataRow
          label={applicationCopy.operations.evidenceAge}
          value={
            evidence.freshness.ageSeconds === undefined
              ? applicationCopy.common.notObserved
              : `${evidence.freshness.ageSeconds.toString()}s`
          }
        />
        <DataRow
          label={applicationCopy.operations.evidenceObservedAt}
          value={display(evidence.freshness.observedAt)}
        />
        <DataRow
          label={applicationCopy.operations.evidenceRecordedAt}
          value={display(evidence.freshness.recordedAt)}
        />
      </DataList>
      <div className="grid gap-2 compact:grid-cols-2">
        {keeperTracks.map((trackId) => (
          <KeeperAttemptRow
            key={trackId}
            label={
              model.trackQueues.find((queue) => queue.trackId === trackId)
                ?.track ?? `Track ${trackId}`
            }
            track={evidence.tracks[trackId]}
          />
        ))}
      </div>
    </Panel>
  );
}

function DeploymentEvidence({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  return (
    <Panel
      className="laptop:col-span-5"
      meta={model.deployment.network}
      title={applicationCopy.publicStatus.expectedDeployment}
    >
      <DataList>
        <DataRow
          label={applicationCopy.status.check.expected}
          value={
            <Address value={model.deployment.expectedManifestCommitment} />
          }
        />
        <DataRow
          label={applicationCopy.status.check.observed}
          value={
            model.deployment.manifestCommitment === undefined ? (
              applicationCopy.common.notObserved
            ) : (
              <Address value={model.deployment.manifestCommitment} />
            )
          }
        />
        <DataRow
          label={applicationCopy.operations.expectedChainId}
          value={display(model.deployment.expectedChainId)}
        />
        <DataRow
          label={applicationCopy.operations.observedChainId}
          value={display(model.deployment.observedChainId)}
        />
      </DataList>
    </Panel>
  );
}

const eventTypes = [
  "reward-epoch",
  "conversion",
  "retry",
  "claim",
  "pol-execution",
] as const;

function EventSummaryBoard({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  return (
    <MetricGroup columns={5} label={applicationCopy.publicStatus.eventSummary}>
      {eventTypes.map((type) => {
        const outcome = model.operationSummary[type];
        return (
          <Metric
            hint={`${applicationCopy.publicStatus.failure}: ${
              outcome.lastFailed?.blockNumber.toString() ??
              applicationCopy.publicStatus.notObserved
            }`}
            key={type}
            label={applicationCopy.publicStatus.events[type]}
            value={
              outcome.lastSuccessful?.blockNumber.toString() ??
              applicationCopy.publicStatus.notObserved
            }
          />
        );
      })}
    </MetricGroup>
  );
}

function CollectionEvidence({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  const facts = [
    [applicationCopy.home.launchedCount, model.collection.permanentCount],
    [applicationCopy.home.groundedCount, model.collection.transientCount],
    [
      applicationCopy.home.availableCount,
      model.collection.availableIdentityCount,
    ],
    [applicationCopy.fleet.pending, model.collection.pendingDiscoveryCount],
  ] as const;
  return (
    <div className="min-w-0">
      <h3 className={capsHeading}>
        {applicationCopy.publicStatus.collectionSnapshot}
      </h3>
      <DataList className="mt-2">
        {facts.map(([label, value]) => (
          <DataRow key={label} label={label} value={display(value)} />
        ))}
        <DataRow
          label={applicationCopy.rewards.units}
          value={display(model.collection.liquidSupplyFormatted)}
        />
      </DataList>
    </div>
  );
}

function LiquidityEvidence({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  return (
    <div className="min-w-0">
      <h3 className={capsHeading}>
        {applicationCopy.publicStatus.protocolLiquidity}
      </h3>
      <DataList className="mt-2">
        <DataRow
          label={applicationCopy.publicStatus.queuedWeth}
          value={display(model.liquidity.queuedWethFormatted)}
        />
        <DataRow
          label={applicationCopy.publicStatus.permanentlyLockedWeth}
          value={display(model.liquidity.permanentlyLockedWethFormatted)}
        />
        <DataRow
          label={applicationCopy.publicStatus.liquidityCycles}
          value={display(model.liquidity.cycleCount)}
        />
      </DataList>
    </div>
  );
}

function RewardAccountingEvidence({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  return (
    <div className="min-w-0">
      <h3 className={capsHeading}>
        {applicationCopy.publicStatus.rewardAccounting}
      </h3>
      <div className="mt-2 grid gap-2 tablet:grid-cols-2">
        {model.rewardTracks.map((track) => (
          <Well className="grid gap-1" key={track.track}>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className={capsHeading}>{track.track}</h4>
              <span
                className="ml-auto"
                data-solvent={track.solvent ?? undefined}
              >
                <Badge
                  dot
                  tone={
                    track.solvent === undefined
                      ? "neutral"
                      : track.solvent
                        ? "success"
                        : "danger"
                  }
                >
                  {track.solvent === undefined
                    ? applicationCopy.common.notObserved
                    : track.solvent
                      ? applicationCopy.status.check.healthy
                      : applicationCopy.status.check.failing}
                </Badge>
              </span>
            </div>
            <DataList>
              <DataRow
                label={applicationCopy.publicStatus.tokenBalance}
                value={display(track.rawTokenBalance)}
              />
              <DataRow
                label={applicationCopy.publicStatus.liability}
                value={display(track.rawLiability)}
              />
              <DataRow
                label={applicationCopy.publicStatus.activeWeight}
                value={display(track.activeWeight)}
              />
              <DataRow
                label={applicationCopy.publicStatus.unclaimedPot}
                value={display(track.unclaimedTrackPot)}
              />
              <DataRow
                label={applicationCopy.publicStatus.basketPot}
                value={display(track.basketRelicPot)}
              />
              <DataRow
                label={applicationCopy.publicStatus.indicatorPot}
                value={display(track.indicatorRelicPot)}
              />
            </DataList>
          </Well>
        ))}
      </div>
    </div>
  );
}

const roleLabels = {
  "liquid-token-owner": applicationCopy.operations.liquidTokenOwner,
  "reward-ledger-owner": applicationCopy.operations.rewardsOwner,
  "converter-owner": applicationCopy.operations.converterOwner,
  "liquidity-owner": applicationCopy.operations.liquidityOwner,
  keeper: applicationCopy.operations.keeper,
  "liquidity-executor": applicationCopy.operations.executor,
  guardian: applicationCopy.operations.guardian,
  "recovery-authority-contract": `${applicationCopy.operations.recovery} contract`,
  creator: applicationCopy.operations.creator,
} as const satisfies Readonly<Record<AdminRoleId, string>>;

function RoleEvidence({ model }: { readonly model: AdminDiagnosticsModel }) {
  return (
    <div className="min-w-0">
      <h3 className={capsHeading}>
        {applicationCopy.operations.roleConfiguration}
      </h3>
      <DataList className="mt-2">
        {model.roles.map(({ address, role }) => (
          <DataRow
            key={role}
            label={roleLabels[role]}
            value={
              address === undefined ? (
                applicationCopy.common.notObserved
              ) : (
                <Address value={address} />
              )
            }
          />
        ))}
      </DataList>
      <p className="mt-3 text-body-sm text-ink-soft">
        {applicationCopy.operations.recoveryViewOnly}
      </p>
    </div>
  );
}

function RecentEventEvidence({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  return (
    <div className="min-w-0">
      <h3 className={capsHeading}>
        {applicationCopy.publicStatus.recentEvents}
      </h3>
      {model.recentEvents.length === 0 ? (
        <p className="mt-2 text-body-sm text-ink-soft">
          {applicationCopy.publicStatus.noEvents}
        </p>
      ) : (
        <ol className="mt-2 grid gap-2">
          {model.recentEvents.map((event) => (
            <li
              className="grid gap-1 border-b border-line pb-2 last:border-b-0"
              key={`${event.transactionHash}:${event.type}:${event.track ?? 0}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span data-success={event.successful}>
                  <Badge dot tone={event.successful ? "success" : "danger"}>
                    {event.successful
                      ? applicationCopy.publicStatus.success
                      : applicationCopy.publicStatus.failure}
                  </Badge>
                </span>
                <strong className={capsHeading}>
                  {applicationCopy.publicStatus.events[event.type]}
                </strong>
              </div>
              <p className="text-body-sm text-ink-soft">{event.explanation}</p>
              <code className={evidenceCode}>
                {event.blockNumber.toString()} / {event.transactionHash}
              </code>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** The four health ledgers, in the order an incident is worked through. */
const healthLedgers = (model: AdminDiagnosticsModel) =>
  [
    [
      "accounting-health-checks",
      applicationCopy.publicStatus.accountingChecks,
      model.checks.accounting,
    ],
    [
      "market-health-checks",
      applicationCopy.publicStatus.marketChecks,
      model.checks.market,
    ],
    [
      "operations-health-checks",
      applicationCopy.publicStatus.operationsChecks,
      model.checks.operations,
    ],
    [
      "deployment-health-checks",
      applicationCopy.publicStatus.deploymentChecks,
      model.checks.deployment,
    ],
  ] as const;

export function AdminDiagnosticsContent({
  model,
}: {
  readonly model: AdminDiagnosticsModel;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-3 laptop:grid-cols-12">
        <EvidenceSources model={model} />
        <KeeperAttemptEvidence model={model} />
        <DeploymentEvidence model={model} />
      </div>
      <EventSummaryBoard model={model} />
      <TrackQueueLedger
        ariaLabel={applicationCopy.publicStatus.rewardQueues}
        emptyMessage={applicationCopy.operations.noRecentActions}
        trackOutcomes={model.trackOutcomes}
        trackQueues={model.trackQueues}
      />
      <div>
        <Disclosure
          searchable
          title={applicationCopy.operations.rawAccountingEvidence}
        >
          <div className="grid gap-4">
            <CollectionEvidence model={model} />
            <LiquidityEvidence model={model} />
            <RewardAccountingEvidence model={model} />
          </div>
        </Disclosure>
        <Disclosure
          searchable
          title={applicationCopy.operations.completeHealthLedger}
        >
          <div className="grid gap-3">
            {healthLedgers(model).map(([id, title, checks]) => (
              <HealthCheckLedger
                checks={checks}
                id={id}
                key={id}
                title={title}
              />
            ))}
          </div>
        </Disclosure>
        <Disclosure searchable title={applicationCopy.operations.roleEvidence}>
          <RoleEvidence model={model} />
        </Disclosure>
        <Disclosure
          searchable
          title={applicationCopy.operations.indexedEventEvidence}
        >
          <RecentEventEvidence model={model} />
        </Disclosure>
      </div>
    </div>
  );
}

export function AdminDiagnosticsPanel() {
  const protocol = useProtocolClient();
  const funding = useTestnetFundingStatus(protocol);

  if (!protocol.deploymentAvailable) {
    return (
      <StateFeedback
        description={applicationCopy.publicStatus.deploymentPending}
        title="Deployment evidence unavailable"
        tone="blocked"
      />
    );
  }
  if (protocol.healthPending && protocol.health === undefined) {
    return (
      <StateFeedback
        description={applicationCopy.common.loading}
        title={applicationCopy.operations.evidenceSources}
        tone="loading"
      />
    );
  }
  if (protocol.healthError !== null || protocol.health === undefined) {
    return (
      <StateFeedback
        action={
          <Button
            onClick={() => void protocol.refresh()}
            type="button"
            variant="outline"
          >
            {applicationCopy.operations.retryDiagnostics}
          </Button>
        }
        description={applicationCopy.operations.diagnosticsReadUnavailable}
        title="Diagnostics unavailable"
        tone="error"
      />
    );
  }

  const model = deriveAdminDiagnosticsModel(
    protocol.health,
    fundingDiagnosticInput(protocol, funding),
  );
  return <AdminDiagnosticsContent model={model} />;
}
