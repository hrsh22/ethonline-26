import type { ProtocolHealthCheck } from "@orbit/protocol/health";

import { HealthCheckLedger } from "@/components/status/health-check-ledger";
import { StateFeedback } from "@/components/state-feedback";
import { ButtonLink } from "@/components/ui/button";
import { DataList, DataRow } from "@/components/ui/data-list";
import { Disclosure } from "@/components/ui/disclosure";
import { Metric, MetricGroup } from "@/components/ui/metric";
import { Panel } from "@/components/ui/panel";
import { Amount, Count, Unavailable } from "@/components/ui/value";
import { formatCount, formatTokenAmount } from "@/lib/format";
import { applicationCopy, identity } from "@/lib/identity";
import type { PublicStatusModel } from "@/lib/protocol-status-model";

/*
 * Values go through the shared formatter.
 *
 * This module truncated at six fraction digits, which rendered every nonzero
 * value below 1e-6 as exactly "0" — so a real destination-locked balance read
 * as empty on the public status surface. Significant digits keep small values
 * meaningful, and a value too small for the width reports the bound rather
 * than a false zero.
 */
const weth = (value: bigint | undefined): string =>
  value === undefined
    ? applicationCopy.common.notObserved
    : `${formatTokenAmount(value, { maximumFractionDigits: 8 }).display} WETH`;

const count = (value: bigint | number | undefined): string =>
  value === undefined
    ? applicationCopy.common.notObserved
    : formatCount(value).display;

const stock = (value: bigint | undefined): string =>
  value === undefined
    ? applicationCopy.common.notObserved
    : formatTokenAmount(value, { maximumFractionDigits: 8 }).display;

const unobserved = () => (
  <Unavailable reason={applicationCopy.common.notObserved} />
);

/* A metric board fills its panel edge to edge: the panel already draws the
 * frame, so the board drops its own. */
const boardInPanel = "rounded-none border-0";

const caption = "text-caption text-ink-faint";

type HistoryStatus = PublicStatusModel["rewardActivity"]["historyStatus"];

function CollectionBoard({ model }: { readonly model: PublicStatusModel }) {
  const positions = [
    [applicationCopy.home.launchedCount, model.collection.permanent],
    [applicationCopy.home.groundedCount, model.collection.transient],
    [applicationCopy.home.availableCount, model.collection.available],
    [applicationCopy.fleet.pending, model.collection.pending],
  ] as const;
  return (
    <Panel
      bodyClassName="p-0"
      footer={
        <p className={caption}>
          {applicationCopy.publicStatus.collectionIntroduction}
        </p>
      }
      meta={<span>{formatCount(4_444).display} identities</span>}
      title={applicationCopy.publicStatus.collectionHeading}
      titleId="collection-state-heading"
    >
      <MetricGroup
        className={boardInPanel}
        columns={2}
        label={applicationCopy.publicStatus.collectionHeading}
      >
        {positions.map(([label, value]) => (
          <Metric
            key={label}
            label={label}
            value={value === undefined ? unobserved() : <Count value={value} />}
          />
        ))}
      </MetricGroup>
    </Panel>
  );
}

function ProtocolFundBoard({ model }: { readonly model: PublicStatusModel }) {
  const { funds } = model;
  const positions = [
    {
      description: applicationCopy.publicStatus.rewardsWaitingDescription,
      label: applicationCopy.publicStatus.rewardsWaiting,
      wei: funds.rewardWethWaiting,
    },
    {
      description: applicationCopy.publicStatus.liquidityWaitingDescription,
      label: applicationCopy.publicStatus.liquidityWaiting,
      wei: funds.liquidityWaitingWeth,
    },
    {
      description: applicationCopy.publicStatus.liquidityCommittedDescription,
      label: applicationCopy.publicStatus.liquidityCommitted,
      wei: funds.liquidityLockedWeth,
    },
    {
      description: applicationCopy.publicStatus.creatorFeesDescription,
      label: applicationCopy.publicStatus.creatorFees,
      wei: funds.creatorWeth,
    },
  ];
  return (
    <Panel
      bodyClassName="p-0"
      footer={
        <p className={caption}>
          {applicationCopy.publicStatus.fundSeparationDisclosure}
        </p>
      }
      meta={<span>{applicationCopy.publicStatus.noTreasuryMeta}</span>}
      title={applicationCopy.publicStatus.fundsHeading}
      titleId="protocol-funds-heading"
    >
      <MetricGroup
        className={boardInPanel}
        columns={2}
        label={applicationCopy.publicStatus.fundsHeading}
      >
        {positions.map((position) => (
          <Metric
            hint={position.description}
            key={position.label}
            label={position.label}
            value={
              position.wei === undefined ? (
                unobserved()
              ) : (
                <Amount
                  maximumFractionDigits={8}
                  minimumFractionDigits={4}
                  unit="WETH"
                  value={position.wei}
                />
              )
            }
          />
        ))}
      </MetricGroup>
    </Panel>
  );
}

const explorerTransaction = (transactionHash: `0x${string}`) =>
  `https://sepolia.basescan.org/tx/${transactionHash}`;

type RewardActivityEvent =
  PublicStatusModel["rewardActivity"]["history"][number];

const rewardEventTitle = (event: RewardActivityEvent): string => {
  if (event.type === "reward-epoch") {
    return applicationCopy.publicStatus.rewardOpeningTitle(
      event.epoch.epochNumber.toString(),
    );
  }
  const track = identity.rewardTrackLabels[event.track];
  return event.type === "track-conversion"
    ? applicationCopy.publicStatus.rewardConversionTitle(track)
    : applicationCopy.publicStatus.rewardClaimTitle(track);
};

const rewardEventDetail = (event: RewardActivityEvent): string => {
  if (event.type === "reward-epoch") {
    return applicationCopy.publicStatus.wethEnteredAtOpening(
      weth(event.epoch.openedWeth),
    );
  }
  if (event.type === "track-conversion") {
    return applicationCopy.publicStatus.rewardConversionDetail(
      weth(event.conversion.spentWeth),
      stock(event.conversion.stockReceived),
      weth(event.conversion.remainingQueue),
    );
  }
  return applicationCopy.publicStatus.rewardClaimDetail(
    stock(event.claim.amount),
    event.claim.identityId,
  );
};

function RewardEventRow({ event }: { readonly event: RewardActivityEvent }) {
  return (
    <li className="grid gap-1 border-b border-line py-3 last:border-b-0 tablet:grid-cols-[minmax(0,1fr)_auto] tablet:items-start tablet:gap-x-6">
      <div className="min-w-0">
        <p className="font-mono text-body-sm font-semibold text-ink">
          {rewardEventTitle(event)}
        </p>
        <p className="mt-0.5 text-body-sm text-ink-soft">
          {rewardEventDetail(event)}
        </p>
        <p className={`mt-1 ${caption} tabular-nums`}>
          {applicationCopy.publicStatus.rewardEventBlock(
            count(event.blockNumber),
          )}
        </p>
      </div>
      <a
        className="inline-flex min-h-11 items-center font-mono text-body-sm text-signal underline decoration-1 underline-offset-4 hover:text-ink"
        href={explorerTransaction(event.transactionHash)}
        rel="noreferrer"
        target="_blank"
      >
        {applicationCopy.publicStatus.viewTransaction}
      </a>
    </li>
  );
}

const collectorLiabilityByTrack = (model: PublicStatusModel) =>
  new Map(
    model.rewardActivity.collectorLiability.map(({ amount, track }) => [
      track,
      amount,
    ]),
  );

/** Missing history is stated by coverage, never rendered as zero events. */
function IndexedHistoryFeedback({
  description,
  status,
  titles,
}: {
  readonly description: string;
  readonly status: HistoryStatus;
  readonly titles: Readonly<Record<HistoryStatus, string>>;
}) {
  const tone =
    status === "complete"
      ? ("empty" as const)
      : status === "partial"
        ? ("partial" as const)
        : ("blocked" as const);
  return (
    <StateFeedback
      compact
      description={description}
      title={titles[status]}
      tone={tone}
    />
  );
}

function HistoryCoverage({ status }: { readonly status: HistoryStatus }) {
  if (status === "complete") return null;
  return (
    <div className="mb-3" data-history-coverage={status}>
      <StateFeedback
        compact
        description={applicationCopy.publicStatus.historyCoverage[status]}
        title={applicationCopy.publicStatus.rewardActivityHeading[status]}
        tone={status === "partial" ? "partial" : "blocked"}
      />
    </div>
  );
}

const subheading =
  "font-mono text-label font-medium tracking-[0.1em] text-ink-faint uppercase";

function LatestOpening({
  rewardActivity,
}: {
  readonly rewardActivity: PublicStatusModel["rewardActivity"];
}) {
  const { historyStatus, latestOpening } = rewardActivity;
  if (latestOpening === undefined) {
    return (
      <IndexedHistoryFeedback
        description={applicationCopy.publicStatus.latestRewardUnavailable}
        status={historyStatus}
        titles={applicationCopy.publicStatus.openingFeedback}
      />
    );
  }
  return (
    <DataList>
      <DataRow
        label={applicationCopy.publicStatus.indexedOpeningLabel[historyStatus]}
        note={applicationCopy.publicStatus.wethEnteredAtOpening(
          weth(latestOpening.epoch.openedWeth),
        )}
        tone="live"
        value={applicationCopy.publicStatus.rewardOpeningTitle(
          latestOpening.epoch.epochNumber.toString(),
        )}
      />
    </DataList>
  );
}

function RecentConversions({ model }: { readonly model: PublicStatusModel }) {
  const { historyStatus, recentConversions } = model.rewardActivity;
  const liability = collectorLiabilityByTrack(model);
  return (
    <div className="mt-4">
      <h3 className={subheading}>
        {applicationCopy.publicStatus.recentConversionsLabel[historyStatus]}
      </h3>
      {recentConversions.length === 0 ? (
        <div className="mt-2">
          <IndexedHistoryFeedback
            description={applicationCopy.publicStatus.noConversionsIndexed}
            status={historyStatus}
            titles={applicationCopy.publicStatus.conversionFeedback}
          />
        </div>
      ) : (
        <DataList className="mt-1">
          {recentConversions.map((conversion) => {
            const track = identity.rewardTrackLabels[conversion.track];
            return (
              <DataRow
                key={conversion.transactionHash}
                label={track}
                note={applicationCopy.publicStatus.stockReservedForClaims(
                  stock(liability.get(track)),
                  track,
                )}
                value={`${weth(conversion.conversion.spentWeth)} → ${stock(conversion.conversion.stockReceived)} ${applicationCopy.publicStatus.stockTokenUnits}`}
              />
            );
          })}
        </DataList>
      )}
      <p className={`mt-3 ${caption}`}>
        {applicationCopy.publicStatus.conversionAttributionBoundary}
      </p>
    </div>
  );
}

/**
 * The reward answer: how many epochs, the latest opening, the last few
 * conversions. Openings and conversions are separate lists because a
 * conversion carries no epoch ID.
 */
function RewardActivityBoard({ model }: { readonly model: PublicStatusModel }) {
  const { rewardActivity } = model;
  return (
    <Panel
      footer={
        <div className="flex flex-wrap gap-2">
          <ButtonLink href="/market" size="sm" variant="outline">
            {applicationCopy.publicStatus.marketLink}
          </ButtonLink>
          <ButtonLink href="/rewards" size="sm" variant="outline">
            {applicationCopy.publicStatus.rewardsLink}
          </ButtonLink>
        </div>
      }
      meta={
        <span className="tabular-nums">
          {count(rewardActivity.epochCount)}{" "}
          {applicationCopy.publicStatus.epochCountLabel}
        </span>
      }
      title={
        applicationCopy.publicStatus.rewardActivityHeading[
          rewardActivity.historyStatus
        ]
      }
      titleId="latest-reward-heading"
    >
      <HistoryCoverage status={rewardActivity.historyStatus} />
      <LatestOpening rewardActivity={rewardActivity} />
      <RecentConversions model={model} />
    </Panel>
  );
}

function RewardEventHistory({ model }: { readonly model: PublicStatusModel }) {
  const { history, historyStatus } = model.rewardActivity;
  return (
    <Disclosure
      searchable
      title={
        applicationCopy.publicStatus.rewardHistoryDisclosure[historyStatus]
      }
    >
      <h3 className={subheading} id="reward-evidence-heading">
        {applicationCopy.publicStatus.evidenceHeading} · {count(history.length)}
      </h3>
      {history.length === 0 ? (
        <div className="mt-2">
          <IndexedHistoryFeedback
            description={applicationCopy.publicStatus.latestRewardUnavailable}
            status={historyStatus}
            titles={applicationCopy.publicStatus.historyFeedback}
          />
        </div>
      ) : (
        <ol className="mt-1">
          {history.map((event) => (
            <RewardEventRow
              event={event}
              key={`${event.transactionHash}:${event.logIndex}`}
            />
          ))}
        </ol>
      )}
    </Disclosure>
  );
}

export function ProtocolOverview({
  checks,
  model,
}: {
  /**
   * The public checks behind the health badge, when the caller has them. The
   * status model carries only the verdict, so the ledger is optional and is
   * omitted rather than rendered empty.
   */
  readonly checks?: readonly ProtocolHealthCheck[] | undefined;
  readonly model: PublicStatusModel;
}) {
  const { historyStatus } = model.rewardActivity;
  return (
    <>
      <div className="mt-3 grid gap-3 laptop:grid-cols-2">
        <CollectionBoard model={model} />
        <ProtocolFundBoard model={model} />
      </div>
      <div className="mt-3">
        <RewardActivityBoard model={model} />
      </div>
      {checks === undefined || checks.length === 0 ? null : (
        <div className="mt-3">
          <HealthCheckLedger
            checks={checks}
            id="public-health-checks-heading"
            title={applicationCopy.publicStatus.checksHeading}
          />
        </div>
      )}
      {/* The boards answer; exact receipts and index methodology stay public
          but behind disclosure, so the answer above stays direct. */}
      <div className="mt-6">
        <Disclosure
          searchable
          title={applicationCopy.publicStatus.evidenceDisclosure}
        >
          <div className="grid max-w-[72ch] gap-2 text-body-sm text-ink-soft">
            <p>{applicationCopy.publicStatus.evidenceDisclosureNote}</p>
            <p>{applicationCopy.publicStatus.workerBoundary}</p>
            <p data-history-status={historyStatus}>
              {applicationCopy.publicStatus.historyCoverage[historyStatus]}
            </p>
          </div>
        </Disclosure>
        <RewardEventHistory model={model} />
      </div>
    </>
  );
}
