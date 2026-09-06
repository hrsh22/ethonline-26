"use client";

import { StateFeedback } from "@/components/state-feedback";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { CraftArt } from "@/components/ui/craft-art";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import { Amount, Unavailable } from "@/components/ui/value";
import { DiscoveryOutcomes } from "@/components/fleet/discovery-outcomes";
import { DiscoveryProgress } from "@/components/fleet/discovery-progress";
import { CollectorNextAction } from "@/components/start/collector-next-action";
import { useTestnetFundingStatus } from "@/hooks/use-testnet-funding";
import {
  createCollectorJourneyView,
  type CollectorJourneyMetrics,
  type CollectorJourneyPhase,
  type CollectorJourneyPhaseStatus,
  type CollectorJourneyView,
  type CollectorProgressState,
} from "@/lib/collector-journey";
import { applicationCopy } from "@/lib/identity";
import { useProtocolClient } from "@/providers/protocol-client-provider";

/**
 * The first-run path: a board of where this wallet stands, then the three
 * phases as panels, each carrying its state and — for the current one — the
 * single valid next action. Explanations of Discovery and whole-unit
 * boundaries stay collapsed beneath.
 */

const phaseStateLabel: Record<CollectorJourneyPhaseStatus, string> = {
  complete: applicationCopy.onboarding.complete,
  current: applicationCopy.onboarding.current,
  waiting: applicationCopy.onboarding.waitingLabel,
};

const phaseStateTone: Record<CollectorJourneyPhaseStatus, BadgeTone> = {
  complete: "success",
  current: "live",
  waiting: "neutral",
};

const fundActionDescriptions: Partial<Record<string, string>> = {
  "connect-wallet": applicationCopy.onboarding.access.disconnected,
  "open-trade": applicationCopy.onboarding.phases.fund.trade,
  "switch-network": applicationCopy.onboarding.access["wrong-network"],
  none: applicationCopy.onboarding.access["deployment-pending"],
};

const copyForPhase = (phase: CollectorJourneyPhase) =>
  applicationCopy.onboarding.phases[phase.id];

const descriptionForPhase = (phase: CollectorJourneyPhase): string => {
  const copy = copyForPhase(phase);
  if (phase.status === "complete") return copy.complete;
  if (phase.status === "waiting") return applicationCopy.onboarding.waiting;
  if (phase.id !== "fund") return copy.current;
  return fundActionDescriptions[phase.action] ?? copy.current;
};

function JourneyPhasePanel({
  index,
  phase,
}: {
  readonly index: number;
  readonly phase: CollectorJourneyPhase;
}) {
  const copy = copyForPhase(phase);
  const current = phase.status === "current";

  return (
    <li className="min-w-0" data-state={phase.status}>
      <Panel
        className="h-full"
        bodyClassName="flex flex-col gap-3"
        meta={
          <>
            <span>{String(index).padStart(2, "0")}</span>
            <Badge dot={current} tone={phaseStateTone[phase.status]}>
              {phaseStateLabel[phase.status]}
            </Badge>
          </>
        }
        title={copy.title}
        tone={current ? "live" : "default"}
      >
        <p
          className={
            phase.status === "waiting"
              ? "text-body-sm text-ink-faint"
              : "text-body-sm text-ink-soft"
          }
        >
          {descriptionForPhase(phase)}
        </p>
        {phase.id === "launch" ? (
          <p className="border-l-2 border-[var(--status-warning-text)] pl-3 text-body-sm text-ink">
            <span className="mr-2 font-mono text-label font-semibold tracking-[0.1em] text-[var(--status-warning-text)] uppercase">
              {applicationCopy.onboarding.launchWarningLabel}
            </span>
            {applicationCopy.onboarding.launchWarning}
          </p>
        ) : null}
      </Panel>
    </li>
  );
}

const collectionProgress = (metrics: CollectorJourneyMetrics): string => {
  if (metrics.permanent > 0) {
    return applicationCopy.onboarding.permanentCount(metrics.permanent);
  }
  if (metrics.transient > 0) {
    return applicationCopy.onboarding.transientCount(metrics.transient);
  }
  if (metrics.pending > 0) return applicationCopy.onboarding.pending;
  return applicationCopy.onboarding.noCraft;
};

const fuelValue = (value: bigint | undefined): React.ReactElement =>
  value === undefined ? (
    <Unavailable reason={applicationCopy.common.notObserved} />
  ) : (
    <Amount minimumFractionDigits={4} value={value} />
  );

const phaseCell = (journey: CollectorJourneyView) => {
  if (journey.complete) {
    return {
      hint: applicationCopy.onboarding.phaseOf(3, 3),
      value: applicationCopy.onboarding.journeyDone,
    };
  }
  const current = journey.currentPhase;
  const index = journey.phases.findIndex((entry) => entry === current) + 1;
  return {
    hint: applicationCopy.onboarding.phaseOf(index, 3),
    value:
      current === undefined
        ? applicationCopy.onboarding.waitingLabel
        : copyForPhase(current).title,
  };
};

function JourneyProgressPending({
  state,
}: {
  readonly state: Exclude<CollectorProgressState, "ready">;
}) {
  if (state === "disconnected")
    return (
      <StateFeedback
        compact
        tone="notice"
        title="Connect to see your progress"
        description="Explore freely, then connect a wallet when you want to collect."
      />
    );
  if (state === "partial")
    return (
      <StateFeedback
        compact
        tone="partial"
        title="Collection is updating"
        description="We are checking the rest of your collection. Confirmed collectibles remain available; you do not need to buy again."
      />
    );
  return (
    <StateFeedback
      compact
      description={
        state === "loading"
          ? applicationCopy.onboarding.progressLoadingBody
          : applicationCopy.onboarding.progressUnavailable
      }
      title={
        state === "loading"
          ? applicationCopy.onboarding.progressLoadingTitle
          : applicationCopy.onboarding.progressUnavailableTitle
      }
      tone={state === "loading" ? "loading" : "blocked"}
    />
  );
}

/**
 * The board. Until a wallet read succeeds it states why it is empty instead
 * of rendering placeholder glyphs that read as data.
 */
function JourneyBoard({ journey }: { readonly journey: CollectorJourneyView }) {
  const state = journey.progressState;
  if (
    state !== "ready" &&
    !(state === "partial" && journey.primaryIdentityId !== undefined)
  ) {
    return (
      <div data-progress-state={state}>
        <JourneyProgressPending state={state} />
      </div>
    );
  }
  const { metrics } = journey;
  const phase = phaseCell(journey);
  return (
    <div data-progress-state={state}>
      {state === "partial" ? <JourneyProgressPending state="partial" /> : null}
      <MetricGroup columns={4} label={applicationCopy.onboarding.progressLabel}>
        <Metric
          hint={`${phase.hint} · ${collectionProgress(metrics)}`}
          label={applicationCopy.onboarding.phase}
          tone="live"
          value={phase.value}
        />
        <Metric
          label={applicationCopy.onboarding.balance}
          value={fuelValue(metrics.balanceWei)}
        />
        <Metric
          label={applicationCopy.onboarding.remaining}
          value={fuelValue(metrics.remainingWei)}
        />
        <Metric
          label={applicationCopy.onboarding.nextThreshold}
          value={fuelValue(metrics.nextThresholdWei)}
        />
      </MetricGroup>
    </div>
  );
}

function JourneyDetails() {
  return (
    <Disclosure searchable title={applicationCopy.onboarding.details}>
      <p className="max-w-[62ch] text-body-sm text-ink-soft">
        {applicationCopy.onboarding.discoveryDisclosure}
      </p>
      <p className="mt-3 max-w-[62ch] text-body-sm text-ink-soft">
        {applicationCopy.onboarding.lossDisclosure}
      </p>
    </Disclosure>
  );
}

function CompletedJourney({
  journey,
}: {
  readonly journey: CollectorJourneyView;
}) {
  const identityId = journey.primaryIdentityId;
  if (identityId === undefined) return null;
  return (
    <Panel
      bodyClassName="grid gap-4 compact:grid-cols-[6rem_minmax(0,1fr)] compact:items-center"
      meta={<Badge tone="success">{applicationCopy.onboarding.complete}</Badge>}
      title={applicationCopy.onboarding.journeyCompleteTitle(identityId)}
      tone="live"
    >
      <CraftArt
        className="size-24"
        decorative
        identityId={identityId}
        kind="permanent"
      />
      <div className="min-w-0">
        <p className="text-body-sm text-ink-soft">
          {applicationCopy.onboarding.journeyCompleteBody}
        </p>
        <div className="mt-4">
          <ButtonLink
            href={
              journey.hasClaimableRewards ? "/rewards" : `/fleet/${identityId}`
            }
          >
            {journey.hasClaimableRewards
              ? "Review claimable rewards"
              : applicationCopy.onboarding.journeyCompleteAction(identityId)}
          </ButtonLink>
        </div>
        <Disclosure
          className="mt-4"
          title={applicationCopy.onboarding.completedJourneyDetails}
        >
          <ul className="grid gap-1 text-body-sm text-ink-soft">
            {journey.phases.map((phase) => (
              <li key={phase.id}>{copyForPhase(phase).complete}</li>
            ))}
          </ul>
        </Disclosure>
      </div>
    </Panel>
  );
}

export function OnboardingPanel() {
  const protocol = useProtocolClient();
  const fundingStatus = useTestnetFundingStatus(protocol);
  const journey = createCollectorJourneyView({
    accessState: protocol.accessState,
    fundingResponse: fundingStatus.response,
    nativeBalanceWei:
      protocol.nativeBalanceRead?.status === "loaded"
        ? protocol.nativeBalanceRead.balance.rawWei
        : undefined,
    walletRead: protocol.walletRead,
  });

  return (
    <div className="mt-5 grid gap-3">
      {/* Data first: the board states where the wallet is before the plan. */}
      <JourneyBoard journey={journey} />
      {protocol.walletRead.status === "loaded" &&
      protocol.walletRead.snapshot.collectibles.pendingDiscovery.count > 0 ? (
        <DiscoveryProgress
          pending={protocol.walletRead.snapshot.collectibles.pendingDiscovery}
          observedAt={protocol.walletRead.snapshot.observedAt}
        />
      ) : null}
      {!journey.complete ? (
        <CollectorNextAction journey={journey} returnTo="/start" />
      ) : null}
      {journey.complete ? (
        <CompletedJourney journey={journey} />
      ) : (
        /* One list. The current phase carries the action, so there is no
           separate "next step" block repeating its title and button. */
        <ol className="grid gap-3 tablet:grid-cols-3">
          {journey.phases.map((phase, index) => (
            <JourneyPhasePanel index={index + 1} key={phase.id} phase={phase} />
          ))}
        </ol>
      )}
      <DiscoveryOutcomes />
      <JourneyDetails />
    </div>
  );
}
